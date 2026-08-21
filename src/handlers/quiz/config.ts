import { FORMS, type Form, type WordType } from "./forms.js";
import type { Filters } from "./question.js";
import { DEFAULT_CONFIG, type SessionConfig } from "./machine.js";
import type { VerbClass } from "./wordClass.js";

/**
 * Reading a session's settings out of what someone typed.
 *
 * Pure, and separate from the command handler on purpose: the parsing rules are
 * where a typo turns into a confusing session, so they are worth testing
 * without a Discord interaction to construct. The handler receives already
 * parsed values.
 *
 * Every option is optional and every one has a default, because `/quiz start`
 * with no arguments has to work — that is the common case in a club channel.
 */

/** What a `/quiz start` or `/quiz config` resolves to. */
export interface QuizSettings {
  filters: Filters;
  session: SessionConfig;
}

/** Why a setting could not be read. */
export interface SettingError {
  option: string;
  /** Shown to the user, so it names what they typed and what is allowed. */
  message: string;
}

const WORD_TYPES: Record<string, WordType | undefined> = {
  verb: `verb`,
  "adj-i": `adj-i`,
  adji: `adj-i`,
  i: `adj-i`,
  "adj-na": `adj-na`,
  adjna: `adj-na`,
  na: `adj-na`,
  noun: `noun`
};

/**
 * Verb-class names a player might reasonably type.
 *
 * `godan` expands to every godan row rather than being rejected: someone
 * filtering for godan practice means all of them, and asking them to name nine
 * consonant rows would be a worse experience than accepting the shorthand.
 */
const GODAN_ROWS: VerbClass[] = [
  `godan-u`,
  `godan-k`,
  `godan-g`,
  `godan-s`,
  `godan-t`,
  `godan-n`,
  `godan-b`,
  `godan-m`,
  `godan-r`,
  `godan-iku`
];

const VERB_CLASSES: Record<string, VerbClass[] | undefined> = {
  ichidan: [`ichidan`],
  godan: GODAN_ROWS,
  suru: [`irregular-suru`],
  kuru: [`irregular-kuru`],
  irregular: [`irregular-suru`, `irregular-kuru`]
};

/** The four tense × polarity forms, which `basics` selects. */
const BASICS: Form[] = [
  `non-past-affirmative`,
  `non-past-negative`,
  `past-affirmative`,
  `past-negative`
];

/**
 * Split a comma-separated option into its parts.
 *
 * Each part keeps what the player typed alongside a lowercased form for
 * matching. Error messages quote the original: telling someone `n7` is invalid
 * when they typed `N7` makes them doubt what they wrote, which is the opposite
 * of what an actionable message does.
 */
const parts = (raw: string): Array<{ typed: string; key: string }> =>
  raw
    .split(`,`)
    .map((p) => p.trim())
    .filter((p) => p !== ``)
    .map((typed) => ({ typed, key: typed.toLowerCase() }));

const parseLevels = (raw: string): number[] | SettingError => {
  const levels: number[] = [];
  for (const { typed, key } of parts(raw)) {
    if (key === `any` || key === `all`) return [];
    const match = /^n?([1-5])$/u.exec(key);
    if (match === null) {
      return {
        option: `level`,
        message: `\`${typed}\` is not a JLPT level. Use N5 to N1, or \`any\`.`
      };
    }
    levels.push(Number(match[1]));
  }
  return levels;
};

const parseTypes = (raw: string): WordType[] | SettingError => {
  const types: WordType[] = [];
  for (const { typed, key } of parts(raw)) {
    const type = WORD_TYPES[key];
    if (type === undefined) {
      return {
        option: `type`,
        message: `\`${typed}\` is not a word type. Use verb, adj-i, adj-na or noun.`
      };
    }
    types.push(type);
  }
  return types;
};

const parseClasses = (raw: string): VerbClass[] | SettingError => {
  const classes: VerbClass[] = [];
  for (const { typed, key } of parts(raw)) {
    const expanded = VERB_CLASSES[key];
    if (expanded === undefined) {
      return {
        option: `class`,
        message: `\`${typed}\` is not a verb class. Use ichidan, godan, suru or kuru.`
      };
    }
    classes.push(...expanded);
  }
  return classes;
};

const parseForms = (raw: string): Form[] | SettingError => {
  const forms: Form[] = [];
  for (const { typed, key } of parts(raw)) {
    if (key === `all`) return [];
    if (key === `basics`) {
      forms.push(...BASICS);
      continue;
    }
    const form = FORMS.find((f) => f === key);
    if (form === undefined) {
      return {
        option: `forms`,
        message: `\`${typed}\` is not a form. Use \`basics\`, \`all\`, or one of: ${FORMS.join(`, `)}.`
      };
    }
    forms.push(form);
  }
  return forms;
};

/**
 * Session length: a number of questions, or endless.
 *
 * Bounded because a session is a shared channel activity — a 500-question
 * session would hold the channel hostage, and `endless` already covers "keep
 * going until we stop".
 */
const parseLength = (raw: string): number | null | SettingError => {
  const value = raw.trim().toLowerCase();
  if (value === `endless` || value === `infinite`) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 50) {
    return {
      option: `length`,
      message: `\`${raw}\` is not a session length. Use 1 to 50, or \`endless\`.`
    };
  }
  return n;
};

/**
 * A timeout, written the way people write durations.
 *
 * Accepts `90s`, `2m`, or a bare number of seconds. Bounded at both ends: under
 * thirty seconds nobody can type a conjugation in time, and over ten minutes
 * the session has stalled rather than being slow.
 */
const parseTimeout = (raw: string): number | SettingError => {
  const value = raw.trim().toLowerCase();
  const match = /^(\d+)(s|m|)$/u.exec(value);
  const amount = match === null ? Number.NaN : Number(match[1]);
  const ms = match?.[2] === `m` ? amount * 60_000 : amount * 1000;

  if (!Number.isFinite(ms) || ms < 30_000 || ms > 600_000) {
    return {
      option: `timeout`,
      message: `\`${raw}\` is not a timeout. Use 30s to 10m.`
    };
  }
  return ms;
};

/**
 * How many attempts each player gets per question.
 *
 * Bounded above because more attempts than there are plausible conjugations
 * turns the race into brute force, and the point taper would bottom out anyway.
 */
const parseGuesses = (raw: string): number | SettingError => {
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < 1 || n > 10) {
    return {
      option: `guesses`,
      message: `\`${raw}\` is not a guess count. Use 1 to 10.`
    };
  }
  return n;
};

const isError = (value: unknown): value is SettingError =>
  typeof value === `object` && value !== null && `option` in value;

/** The options a command can carry, as raw strings. */
export interface RawOptions {
  level?: string;
  type?: string;
  class?: string;
  forms?: string;
  length?: string;
  timeout?: string;
  guesses?: string;
}

/**
 * The settings a session starts with when nothing is specified.
 *
 * N5 because that is what the club practises, and nouns are left out because
 * they only conjugate the copula — a session full of 犬だ / 犬でした is not the
 * drill anyone came for. Both are reachable by asking.
 */
export const DEFAULT_SETTINGS: QuizSettings = {
  filters: {
    levels: [5],
    types: [`verb`, `adj-i`, `adj-na`],
    classes: [],
    forms: BASICS
  },
  session: DEFAULT_CONFIG
};

/**
 * Read a set of options over a base.
 *
 * `base` is what the settings currently are — the defaults for `/quiz start`,
 * the running session's settings for `/quiz config` — so an option nobody
 * mentioned keeps its value rather than resetting.
 *
 * Returns every error rather than the first, since a player who mistyped two
 * options should be told both at once.
 */
export const parseSettings = (
  raw: RawOptions,
  base: QuizSettings = DEFAULT_SETTINGS
): QuizSettings | { errors: SettingError[] } => {
  const errors: SettingError[] = [];
  const settings: QuizSettings = {
    filters: { ...base.filters },
    session: { ...base.session }
  };

  if (raw.level !== undefined) {
    const levels = parseLevels(raw.level);
    if (isError(levels)) errors.push(levels);
    else settings.filters = { ...settings.filters, levels };
  }
  if (raw.type !== undefined) {
    const types = parseTypes(raw.type);
    if (isError(types)) errors.push(types);
    else settings.filters = { ...settings.filters, types };
  }
  if (raw.class !== undefined) {
    const classes = parseClasses(raw.class);
    if (isError(classes)) errors.push(classes);
    else settings.filters = { ...settings.filters, classes };
  }
  if (raw.forms !== undefined) {
    const forms = parseForms(raw.forms);
    if (isError(forms)) errors.push(forms);
    else settings.filters = { ...settings.filters, forms };
  }
  if (raw.length !== undefined) {
    const length = parseLength(raw.length);
    if (isError(length)) errors.push(length);
    else settings.session = { ...settings.session, length };
  }
  if (raw.timeout !== undefined) {
    const timeoutMs = parseTimeout(raw.timeout);
    if (isError(timeoutMs)) errors.push(timeoutMs);
    else settings.session = { ...settings.session, timeoutMs };
  }
  if (raw.guesses !== undefined) {
    const guesses = parseGuesses(raw.guesses);
    if (isError(guesses)) errors.push(guesses);
    else settings.session = { ...settings.session, guesses };
  }

  return errors.length > 0 ? { errors } : settings;
};

/** Narrow {@link parseSettings}'s return. */
export const isSettings = (
  result: QuizSettings | { errors: SettingError[] }
): result is QuizSettings => !(`errors` in result);

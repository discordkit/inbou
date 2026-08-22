import * as v from "valibot";
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

/**
 * A comma-separated option, mapped one part at a time.
 *
 * `expand` returns the values a part means, or null if it is not one — `godan`
 * expands to nine classes, and an empty result means "no filter", which is how
 * `any` and `all` are expressed.
 *
 * A schema rather than a hand-rolled function because these options *parse*
 * rather than merely validate: a string goes in and a different shape comes
 * out. `pipe(string, rawTransform)` says exactly that, and keeps each failure
 * message beside the rule that produced it.
 */
const listOf = <T>(
  expand: (key: string) => readonly T[] | null,
  allowed: string
): v.GenericSchema<string, T[]> =>
  v.pipe(
    v.string(),
    v.rawTransform<string, T[]>(({ dataset, addIssue, NEVER }) => {
      const out: T[] = [];
      for (const { typed, key } of parts(dataset.value)) {
        const values = expand(key);
        if (values === null) {
          addIssue({ message: `\`${typed}\` is not valid. ${allowed}` });
          return NEVER;
        }
        // An empty expansion means "everything", which is the empty filter.
        if (values.length === 0) return [];
        out.push(...values);
      }
      return out;
    })
  );

/** JLPT levels. `any` clears the filter, which is how unlevelled words become reachable. */
const levelSchema = listOf<number>((key) => {
  if (key === `any` || key === `all`) return [];
  const match = /^n?([1-5])$/u.exec(key);
  return match === null ? null : [Number(match[1])];
}, `Use N5 to N1, or \`any\`.`);

const typeSchema = listOf<WordType>((key) => {
  const type = WORD_TYPES[key];
  return type === undefined ? null : [type];
}, `Use verb, adj-i, adj-na or noun.`);

const classSchema = listOf<VerbClass>(
  (key) => VERB_CLASSES[key] ?? null,
  `Use ichidan, godan, suru or kuru.`
);

const formsSchema = listOf<Form>(
  (key) => {
    if (key === `all`) return [];
    if (key === `basics`) return BASICS;
    const form = FORMS.find((f) => f === key);
    return form === undefined ? null : [form];
  },
  `Use \`basics\`, \`all\`, or one of: ${FORMS.join(`, `)}.`
);

/**
 * Session length: a number of questions, or endless.
 *
 * Bounded because a session is a shared channel activity — a 500-question
 * session would hold the channel hostage, and `endless` already covers "keep
 * going until we stop".
 */
const lengthSchema = v.pipe(
  v.string(),
  v.rawTransform<string, number | null>(({ dataset, addIssue, NEVER }) => {
    const value = dataset.value.trim().toLowerCase();
    if (value === `endless` || value === `infinite`) return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 50) {
      addIssue({
        message: `\`${dataset.value}\` is not a session length. Use 1 to 50, or \`endless\`.`
      });
      return NEVER;
    }
    return n;
  })
);

/**
 * A timeout, written the way people write durations.
 *
 * Accepts `90s`, `2m`, or a bare number of seconds. Bounded at both ends: under
 * thirty seconds nobody can type a conjugation in time, and over ten minutes
 * the session has stalled rather than being slow.
 */
const timeoutSchema = v.pipe(
  v.string(),
  v.rawTransform<string, number>(({ dataset, addIssue, NEVER }) => {
    const match = /^(\d+)(s|m|)$/u.exec(dataset.value.trim().toLowerCase());
    const amount = match === null ? Number.NaN : Number(match[1]);
    const ms = match?.[2] === `m` ? amount * 60_000 : amount * 1000;

    if (!Number.isFinite(ms) || ms < 30_000 || ms > 600_000) {
      addIssue({
        message: `\`${dataset.value}\` is not a timeout. Use 30s to 10m.`
      });
      return NEVER;
    }
    return ms;
  })
);

/**
 * How many attempts each player gets per question.
 *
 * Bounded above because more attempts than there are plausible conjugations
 * turns the race into brute force, and the point taper would bottom out anyway.
 */
const guessesSchema = v.pipe(
  v.string(),
  v.rawTransform<string, number>(({ dataset, addIssue, NEVER }) => {
    const n = Number(dataset.value.trim());
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      addIssue({
        message: `\`${dataset.value}\` is not a guess count. Use 1 to 10.`
      });
      return NEVER;
    }
    return n;
  })
);

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
  const filters: Filters = { ...base.filters };
  const session: SessionConfig = { ...base.session };

  /**
   * Parse one option, or record why it could not be.
   *
   * Every option is attempted even after one fails, so a player who mistyped
   * two of them is told both at once rather than discovering the second after
   * fixing the first.
   */
  const read = <T>(
    option: keyof RawOptions,
    schema: v.GenericSchema<string, T>,
    apply: (value: T) => void
  ): void => {
    const value = raw[option];
    if (value === undefined) return;

    const result = v.safeParse(schema, value);
    if (result.success) {
      apply(result.output);
      return;
    }
    errors.push({
      option,
      message: result.issues[0]?.message ?? `\`${value}\` is not valid.`
    });
  };

  read(`level`, levelSchema, (levels) => {
    filters.levels = levels;
  });
  read(`type`, typeSchema, (types) => {
    filters.types = types;
  });
  read(`class`, classSchema, (classes) => {
    filters.classes = classes;
  });
  read(`forms`, formsSchema, (forms) => {
    filters.forms = forms;
  });
  read(`length`, lengthSchema, (length) => {
    session.length = length;
  });
  read(`timeout`, timeoutSchema, (timeoutMs) => {
    session.timeoutMs = timeoutMs;
  });
  read(`guesses`, guessesSchema, (guesses) => {
    session.guesses = guesses;
  });

  return errors.length > 0 ? { errors } : { filters, session };
};

/** Narrow {@link parseSettings}'s return. */
export const isSettings = (
  result: QuizSettings | { errors: SettingError[] }
): result is QuizSettings => !(`errors` in result);

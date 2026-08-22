import { boundedInteger } from "@discordkit/core/validations/boundedInteger";
import * as v from "valibot";
import { COMPOUNDS } from "./compound.js";
import { FORMS, type Askable, type Form, type WordType } from "./forms.js";
import type { Filters } from "./question.js";
import { DEFAULT_CONFIG, type SessionConfig } from "./machine.js";
import type { VerbClass } from "./wordClass.js";

/**
 * Reading a session's settings out of what someone typed.
 *
 * Every option is optional with a default: `/quiz start` bare is the common
 * case in a club channel.
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

/** `godan` expands to all nine rows rather than making anyone name them. */
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

/** Keeps the original spelling so an error can quote what they actually typed. */
const parts = (raw: string): Array<{ typed: string; key: string }> =>
  raw
    .split(`,`)
    .map((p) => p.trim())
    .filter((p) => p !== ``)
    .map((typed) => ({ typed, key: typed.toLowerCase() }));

/**
 * A comma-separated option, mapped one part at a time.
 *
 * `expand` returns what a part means, null if it is not valid, or an empty
 * array for "no filter" — which is how `any` and `all` are expressed.
 */
const listOf = <T>(
  expand: (key: string) => readonly T[] | null,
  allowed: string
): v.GenericSchema<string, T[]> =>
  v.pipe(
    v.string(),
    // On the schema so the error text and Discord's option description are
    // one string. See OPTION_HELP.
    v.description(allowed),
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

const formsSchema = listOf<Askable>((key) => {
  // `all` clears the filter, which leaves inflections only — constructions
  // are N3+ material and are asked for by name or with `compounds`.
  if (key === `all`) return [];
  if (key === `basics`) return BASICS;
  if (key === `compounds`) return [...COMPOUNDS];
  const form = FORMS.find((f) => f === key);
  if (form !== undefined) return [form];
  const compound = COMPOUNDS.find((c) => c === key);
  return compound === undefined ? null : [compound];
}, `Use \`basics\`, \`all\`, \`compounds\`, or a form name.`);

/** Bounded: a 500-question session would hold the channel hostage. */
const lengthSchema = v.pipe(
  v.string(),
  v.rawTransform<string, number | null>(({ dataset, addIssue, NEVER }) => {
    const value = dataset.value.trim().toLowerCase();
    if (value === `endless` || value === `infinite`) return null;

    // `boundedInteger` from @discordkit/core does the bound; its own message is
    // wrapped away because it surfaces straight into a Discord reply, and it
    // reports the input's string length rather than its value (99 renders as
    // "2"). Reported upstream; the bound itself is correct.
    const parsed = v.safeParse(
      boundedInteger({ min: 1, max: 50 }),
      Number(value)
    );
    if (!parsed.success) {
      addIssue({
        message: `\`${dataset.value}\` is not a session length. Use 1 to 50, or \`endless\`.`
      });
      return NEVER;
    }
    return parsed.output;
  })
);

/**
 * `90s`, `2m`, or a bare number of seconds.
 *
 * Bounded both ways: under 30s nobody can type a conjugation, over 10m the
 * session has stalled rather than being slow.
 */
const timeoutSchema = v.pipe(
  v.string(),
  v.rawTransform<string, number>(({ dataset, addIssue, NEVER }) => {
    const match = /^(\d+)(s|m|)$/u.exec(dataset.value.trim().toLowerCase());
    const amount = match === null ? Number.NaN : Number(match[1]);
    const ms = match?.[2] === `m` ? amount * 60_000 : amount * 1000;

    const parsed = v.safeParse(
      boundedInteger({ min: 30_000, max: 600_000 }),
      ms
    );
    if (!parsed.success) {
      addIssue({
        message: `\`${dataset.value}\` is not a timeout. Use 30s to 10m.`
      });
      return NEVER;
    }
    return parsed.output;
  })
);

/** Bounded above, or the race becomes brute force. */
const guessesSchema = v.pipe(
  v.string(),
  v.rawTransform<string, number>(({ dataset, addIssue, NEVER }) => {
    const parsed = v.safeParse(
      boundedInteger({ min: 1, max: 10 }),
      Number(dataset.value.trim())
    );
    if (!parsed.success) {
      addIssue({
        message: `\`${dataset.value}\` is not a guess count. Use 1 to 10.`
      });
      return NEVER;
    }
    return parsed.output;
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
 * N5 because that is what the club practises. Nouns are off by default: they
 * only conjugate the copula, so 犬だ / 犬でした is not the drill anyone wants.
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
 * Read a set of options over a base, so an unmentioned option keeps its value.
 *
 * Returns every error rather than the first: two typos should be told at once.
 */
export const parseSettings = (
  raw: RawOptions,
  base: QuizSettings = DEFAULT_SETTINGS
): QuizSettings | { errors: SettingError[] } => {
  const errors: SettingError[] = [];
  const filters: Filters = { ...base.filters };
  const session: SessionConfig = { ...base.session };

  /** Every option is attempted even after one fails. */
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

/**
 * What each option accepts, in the words the player is shown.
 *
 * Read off the schemas so the description, the error text and the rule cannot
 * drift. `commands.spec.ts` checks the registration script against it.
 */
export const OPTION_HELP: Record<keyof RawOptions, string> = {
  level: v.getDescription(levelSchema) ?? ``,
  type: v.getDescription(typeSchema) ?? ``,
  class: v.getDescription(classSchema) ?? ``,
  forms: v.getDescription(formsSchema) ?? ``,
  length: `Questions per session, 1 to 50, or \`endless\`.`,
  timeout: `How long each question stays open, 30s to 10m.`,
  guesses: `Attempts per player per question, 1 to 10.`
};

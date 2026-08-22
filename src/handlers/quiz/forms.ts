import { COMPOUNDS, type Compound } from "./compound.js";
import { conjugate, type ConjugationRow } from "./conjugate.js";

/**
 * The quiz's view of a conjugation table.
 *
 * `conjugate.ts` is copied verbatim from vscode-jisho and pairs polarity per
 * row — `{ form: "Past", affirmative, negative }` — because it renders a
 * two-column table. The quiz asks for one specific form at a time ("past
 * negative"), so it needs those pairs flattened into individually addressable
 * keys, split by politeness because the prompt rule depends on that split.
 *
 * Keeping the reshape here rather than editing `conjugate.ts` means upstream
 * fixes can be copied across unchanged, and the quiz's needs never leak into
 * the primitive.
 */

/**
 * The forms the quiz can ask for.
 *
 * Named as Discord will display them. The four "basic" forms come first
 * because {@link isBasic} depends on membership, not on order — but reading
 * them together makes the grouping obvious.
 */
export const FORMS = [
  `non-past-affirmative`,
  `non-past-negative`,
  `past-affirmative`,
  `past-negative`,
  `te-form`,
  `potential`,
  `volitional`,
  `imperative`,
  `conditional-tara`,
  `provisional-eba`,
  `conditional-nara`,
  `passive`,
  `causative`,
  `causative-passive`
] as const;

export type Form = (typeof FORMS)[number];

/**
 * Everything the quiz can ask for: a single inflection or a construction.
 *
 * One union rather than two parallel types, so the scorer, the session and the
 * embeds treat a compound exactly like any other question.
 */
export type Askable = Form | Compound;

export const isCompound = (form: Askable): form is Compound =>
  (COMPOUNDS as readonly string[]).includes(form);

/**
 * The four tense × polarity forms that also exist in a polite register.
 *
 * Load-bearing twice over: it gates which forms have a `polite` entry, and it
 * decides the shape of the question. A basic form is asked by showing its
 * polite counterpart and having the player convert register; every other form
 * is asked from the dictionary form. See `docs/specs/conjugation-quiz.md`.
 */
const BASIC_FORMS = [
  `non-past-affirmative`,
  `non-past-negative`,
  `past-affirmative`,
  `past-negative`
] as const;

export type BasicForm = (typeof BASIC_FORMS)[number];

const BASIC: ReadonlySet<Form> = new Set(BASIC_FORMS);

export const isBasic = (form: Form): form is BasicForm => BASIC.has(form);

/**
 * Which forms a word type can be asked about.
 *
 * Adjectives and nouns have no voice or modality — there is no passive of 高い.
 *
 * The conditionals differ by a real grammatical split, not a data gap: verbs
 * and い-adjectives take 〜たら and 〜ば, while な-adjectives and nouns take
 * なら. Promising a な-adjective a 〜ば form would ask for something the
 * conjugator cannot produce.
 */
export const formsFor = (wordType: WordType): readonly Form[] => {
  // Not `FORMS`: that list is every form the quiz knows, including なら, which
  // belongs to な-adjectives and nouns rather than verbs.
  if (wordType === `verb`) {
    return FORMS.filter((f) => f !== `conditional-nara`);
  }
  if (wordType === `adj-i`) {
    return [
      `non-past-affirmative`,
      `non-past-negative`,
      `past-affirmative`,
      `past-negative`,
      `te-form`,
      `conditional-tara`,
      `provisional-eba`
    ] as const;
  }
  return [
    `non-past-affirmative`,
    `non-past-negative`,
    `past-affirmative`,
    `past-negative`,
    `te-form`,
    `conditional-nara`
  ] as const;
};

export type WordType = `verb` | `adj-i` | `adj-na` | `noun`;

/**
 * A conjugation table keyed by form.
 *
 * `casual` holds every form the word supports. `polite` holds only the four
 * basics, which is the whole set that has a distinct polite register — there
 * is no polite imperative or polite volitional in this drill's scope.
 *
 * A form the word does not support is simply absent rather than empty: the
 * generator picks from the keys present, so an absent key cannot be chosen,
 * while an empty string could be asked and never answered.
 */
export interface FormTable {
  casual: Partial<Record<Form, string>>;
  polite: Partial<Record<BasicForm, string>>;
}

/**
 * Where each flat form reads from in a {@link ConjugationRow} table.
 *
 * `causative-passive` is absent on purpose: the conjugator has no such row, so
 * it is derived in {@link formTable} rather than looked up. Excluding it from
 * the key type is what makes that a compile-time fact.
 */
const SOURCE: Record<
  Exclude<Form, `causative-passive`>,
  { row: string; polarity: `affirmative` | `negative` }
> = {
  "non-past-affirmative": { row: `Non-past`, polarity: `affirmative` },
  "non-past-negative": { row: `Non-past`, polarity: `negative` },
  "past-affirmative": { row: `Past`, polarity: `affirmative` },
  "past-negative": { row: `Past`, polarity: `negative` },
  "te-form": { row: `Te-form`, polarity: `affirmative` },
  potential: { row: `Potential`, polarity: `affirmative` },
  volitional: { row: `Volitional`, polarity: `affirmative` },
  imperative: { row: `Imperative`, polarity: `affirmative` },
  "conditional-tara": { row: `Conditional (〜たら)`, polarity: `affirmative` },
  "provisional-eba": { row: `Conditional (〜ば)`, polarity: `affirmative` },
  // な-adjectives and nouns take なら, which the conjugator emits under the
  // unqualified name because it is their only conditional.
  "conditional-nara": { row: `Conditional`, polarity: `affirmative` },
  passive: { row: `Passive`, polarity: `affirmative` },
  causative: { row: `Causative`, polarity: `affirmative` }
};

/**
 * The polite rows, which the conjugator names separately from their plain
 * counterparts.
 *
 * Keyed by the basic forms specifically, not by `Form`: that is what lets the
 * loop below assign into `polite` without a cast, and it makes the "only
 * basics have a polite register" rule a type error to break rather than a
 * comment to remember.
 */
const POLITE_SOURCE: Record<
  BasicForm,
  { row: string; polarity: `affirmative` | `negative` }
> = {
  "non-past-affirmative": { row: `Non-past (polite)`, polarity: `affirmative` },
  "non-past-negative": { row: `Non-past (polite)`, polarity: `negative` },
  "past-affirmative": { row: `Past (polite)`, polarity: `affirmative` },
  "past-negative": { row: `Past (polite)`, polarity: `negative` }
};

const pick = (
  rows: ConjugationRow[],
  source: { row: string; polarity: `affirmative` | `negative` }
): string | undefined => {
  const match = rows.find((r) => r.form === source.row);
  if (match === undefined) return undefined;
  const value = match[source.polarity];
  // The conjugator uses "" for a form with no standard counterpart (the
  // volitional has no negative). Absent beats empty — see FormTable.
  return value === `` ? undefined : value;
};

/**
 * Build the quiz's form table for a word, or null if it does not conjugate.
 *
 * `causative-passive` is derived rather than looked up: the conjugator has no
 * such row, but the causative of any verb is itself an ichidan verb ending in
 * せる/させる, so its passive is a second pass through the same function. This
 * is the same composition the spec calls for at higher levels — the primitive
 * recursing on its own output.
 */
export const formTable = (
  surface: string,
  posCodes: string[]
): FormTable | null => {
  const rows = conjugate(surface, posCodes);
  if (rows === null) return null;

  const casual: Partial<Record<Form, string>> = {};
  const polite: Partial<Record<BasicForm, string>> = {};

  // Every form but the causative-passive reads straight off a row; that one is
  // derived below, since the conjugator has no row for it.
  for (const form of FORMS) {
    if (form !== `causative-passive`) {
      const value = pick(rows, SOURCE[form]);
      if (value !== undefined) casual[form] = value;
    }
  }

  const causative = casual.causative;
  if (causative !== undefined) {
    // 食べさせる → 食べさせられる. The causative always ends in る and behaves
    // as ichidan, so `v1` is correct regardless of the original verb's class.
    const passiveOfCausative = conjugate(causative, [`v1`])?.find(
      (r) => r.form === `Passive`
    )?.affirmative;
    if (passiveOfCausative !== undefined) {
      casual[`causative-passive`] = passiveOfCausative;
    }
  }

  for (const form of BASIC_FORMS) {
    const value = pick(rows, POLITE_SOURCE[form]);
    if (value !== undefined) polite[form] = value;
  }

  return { casual, polite };
};

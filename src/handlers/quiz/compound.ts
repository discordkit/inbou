import { conjugate } from "./conjugate.js";

/**
 * Multi-word constructions, built from the same primitive.
 *
 * Difficulty above N5 should come from grammar rather than rarer vocabulary, so
 * these ask for a construction with a specific meaning — "must do", "do in
 * advance" — rather than another inflection of the same verb.
 *
 * Every one composes: read a row the conjugator already produces, then append a
 * fixed tail or conjugate the result again. Nothing here re-implements
 * inflection, which is what keeps 飲む → 飲んで (not 飲みて) correct without
 * this module knowing the euphonic rules.
 */

export const COMPOUNDS = [
  `must-do`,
  `do-completely`,
  `do-in-advance`,
  `be-made-to`,
  `do-not-want-to`
] as const;

export type Compound = (typeof COMPOUNDS)[number];

/**
 * How each construction is built.
 *
 * `row` and `polarity` name the conjugator output to start from; `tail` is what
 * follows it. `conjugatesAs` is the part-of-speech the whole thing behaves as,
 * for a future layer that inflects a compound further.
 */
interface Recipe {
  row: string;
  polarity: `affirmative` | `negative`;
  tail: string;
  /** What the finished construction means, shown when the answer is revealed. */
  gist: string;
  /** The part-of-speech the result inflects as. */
  conjugatesAs: string;
}

const RECIPES: Record<Compound, Recipe> = {
  // 食べなければ + ならない. The negative provisional already carries the
  // ければ, so this appends only the fixed tail.
  "must-do": {
    row: `Conditional (〜ば)`,
    polarity: `negative`,
    tail: `ならない`,
    gist: `must do / have to do`,
    conjugatesAs: `adj-i`
  },
  // て-form + しまう. The conjugator handles the euphonic change, so 飲む gives
  // 飲んでしまう rather than 飲みてしまう.
  "do-completely": {
    row: `Te-form`,
    polarity: `affirmative`,
    tail: `しまう`,
    gist: `do completely, or do regrettably`,
    conjugatesAs: `v5u`
  },
  "do-in-advance": {
    row: `Te-form`,
    polarity: `affirmative`,
    tail: `おく`,
    gist: `do in advance, for later`,
    conjugatesAs: `v5k`
  },
  // Derived rather than appended: the causative is itself an ichidan verb, so
  // its passive is a real conjugation. Same mechanism `formTable` uses.
  "be-made-to": {
    row: `Causative`,
    polarity: `affirmative`,
    tail: ``,
    gist: `be made to do, or be let do`,
    conjugatesAs: `v1`
  },
  // The conjugator's own 〜たい row, negated. 〜たい inflects as an
  // い-adjective, which is why its negative is 〜たくない and not 〜たいない.
  "do-not-want-to": {
    row: `Desire (〜たい)`,
    polarity: `negative`,
    tail: ``,
    gist: `do not want to do`,
    conjugatesAs: `adj-i`
  }
};

/** What each construction means, for the teaching embed. */
export const compoundGist = (compound: Compound): string =>
  RECIPES[compound].gist;

/** How a construction is written, for the prompt: 〜てしまう and so on. */
export const COMPOUND_LABELS: Record<Compound, string> = {
  "must-do": `〜なければならない`,
  "do-completely": `〜てしまう`,
  "do-in-advance": `〜ておく`,
  "be-made-to": `〜させられる`,
  "do-not-want-to": `〜たくない`
};

const rowValue = (
  surface: string,
  posCodes: string[],
  recipe: Pick<Recipe, `row` | `polarity`>
): string | undefined => {
  const found = conjugate(surface, posCodes)?.find(
    (row) => row.form === recipe.row
  ) as { affirmative?: string; negative?: string } | undefined;
  return recipe.polarity === `negative` ? found?.negative : found?.affirmative;
};

/**
 * Build one construction for a word, or null if the word cannot form it.
 *
 * Null rather than a partial answer: a compound the conjugator cannot produce
 * is a question with no correct answer, and asking it would be worse than
 * asking one fewer.
 */
export const buildCompound = (
  surface: string,
  posCodes: string[],
  compound: Compound
): string | null => {
  const recipe = RECIPES[compound];

  if (compound === `be-made-to`) {
    // The causative behaves as ichidan regardless of the original class, so
    // `v1` is right for every verb: 食べさせる → 食べさせられる.
    const causative = rowValue(surface, posCodes, recipe);
    if (causative === undefined) return null;
    return (
      rowValue(causative, [`v1`], {
        row: `Passive`,
        polarity: `affirmative`
      }) ?? null
    );
  }

  const base = rowValue(surface, posCodes, recipe);
  return base === undefined ? null : `${base}${recipe.tail}`;
};

/** The part-of-speech a finished construction inflects as. */
export const compoundPos = (compound: Compound): string =>
  RECIPES[compound].conjugatesAs;

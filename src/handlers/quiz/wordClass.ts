import type { WordType } from "./forms.js";

/**
 * Resolving a JMdict entry's part-of-speech tags into one quiz word class.
 *
 * A JMdict entry carries several POS codes across its senses — 勉強 is tagged
 * `n`, `vs`, `vt` — and the conjugator takes the first code that yields a
 * table. That is the right behaviour at render time, but the quiz needs the
 * answer *before* it picks a question, so it can filter by verb class and word
 * type. Resolving it once in the build pipeline turns a per-question scan into
 * a stored field.
 *
 * The classes are named as a learner names them, which is also how the filters
 * read: ichidan, godan by its consonant row, and the two irregulars.
 */
export type VerbClass =
  | `ichidan`
  | `godan-u`
  | `godan-k`
  | `godan-g`
  | `godan-s`
  | `godan-t`
  | `godan-n`
  | `godan-b`
  | `godan-m`
  | `godan-r`
  | `godan-iku`
  | `irregular-suru`
  | `irregular-kuru`;

/**
 * Which POS code produces which class.
 *
 * Only codes the conjugator actually handles appear here — its `forPos` accepts
 * exactly this set. A code it cannot conjugate must not become a quiz word,
 * because the question would have no answer to check against.
 *
 * The lexical irregulars fold into their base class: `v5k-s` (行く) is still
 * godan, and the conjugator applies the gemination exception itself. Only
 * 行く is kept distinct, because its te-form is the single most commonly
 * mistaught conjugation in Japanese and a learner filtering for it deserves it
 * named.
 */
const VERB_CLASS: Record<string, VerbClass | undefined> = {
  v1: `ichidan`,
  "v1-s": `ichidan`,
  v5u: `godan-u`,
  "v5u-s": `godan-u`,
  v5k: `godan-k`,
  "v5k-s": `godan-iku`,
  v5g: `godan-g`,
  v5s: `godan-s`,
  v5t: `godan-t`,
  v5n: `godan-n`,
  v5b: `godan-b`,
  v5m: `godan-m`,
  v5r: `godan-r`,
  "v5r-i": `godan-r`,
  v5aru: `godan-r`,
  vs: `irregular-suru`,
  "vs-i": `irregular-suru`,
  "vs-s": `irregular-suru`,
  vk: `irregular-kuru`
};

/** Adjective and noun POS codes the conjugator can inflect. */
const NON_VERB: Record<string, WordType | undefined> = {
  "adj-i": `adj-i`,
  "adj-ix": `adj-i`,
  "adj-na": `adj-na`
};

/** What the quiz needs to know about a word before it can pose a question. */
export interface WordClass {
  type: WordType;
  /** Absent for adjectives and nouns, which have no verb class. */
  verbClass?: VerbClass;
  /**
   * The POS code to hand the conjugator.
   *
   * Kept rather than recomputed from `verbClass`, because the mapping is
   * lossy on purpose: `v5r` and `v5r-i` both classify as godan-r, but only the
   * original code tells the conjugator that ある's negative is ない.
   */
  pos: string;
}

/**
 * Classify an entry from its POS codes, or null if nothing here conjugates.
 *
 * Order matters. A する-noun like 勉強 is tagged `n` before `vs`, and the noun
 * reading is the more common one — but a quiz that classified it as a noun
 * would only ever ask for the copula, when the interesting drill is 勉強する.
 * So verbs win over adjectives, and both win over nouns.
 */
export const classify = (posCodes: readonly string[]): WordClass | null => {
  for (const pos of posCodes) {
    const verbClass = VERB_CLASS[pos];
    if (verbClass !== undefined) return { type: `verb`, verbClass, pos };
  }

  for (const pos of posCodes) {
    const type = NON_VERB[pos];
    if (type !== undefined) return { type, pos };
  }

  return null;
};

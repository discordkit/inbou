import { toHiragana } from "wanakana";

/**
 * Deciding whether a typed message is the right conjugation.
 *
 * A channel is not an input box. The reference implementation converts romaji
 * to kana in the field before anything is scored, so its checker only ever
 * sees kana; ours receives whatever the player typed — romaji, kana, kanji,
 * katakana, with stray spaces and trailing punctuation. Everything below
 * exists to make those spellings agree without accepting an answer that is
 * genuinely a different word.
 */

/**
 * Trim what a chat message adds and a conjugation never contains.
 *
 * NFKC first, so full-width letters and digits collapse onto their ASCII
 * forms. Whitespace goes entirely rather than being collapsed: Japanese does
 * not write word boundaries, so a space inside an answer is always noise.
 * Trailing sentence punctuation is stripped because people finish messages
 * that way — but only trailing, since nothing in a conjugation ends on it.
 */
export const normalize = (text: string): string =>
  text
    .normalize(`NFKC`)
    .replace(/\s+/gu, ``)
    .replace(/[。、.,!?！？]+$/u, ``);

/**
 * Is this plausibly romaji rather than Japanese?
 *
 * Only ASCII letters count. The test gates conversion, so it has to be
 * conservative in one direction: converting something that was already kana
 * would corrupt it, while declining to convert real romaji only costs the
 * player a rejected answer they can retype.
 */
const looksRomaji = (text: string): boolean => /^[a-z]+$/iu.test(text);

/**
 * Collapse the IME spelling of ん before converting.
 *
 * wanakana resolves a lone `n` to ん eagerly, so it reads `nn` as two of them
 * — `yonnda` becomes よんんだ. Japanese IMEs behave the other way round:
 * because they cannot commit `n` until the next key arrives, typing it twice
 * is the standard way to force a single ん, and anyone trained on one types
 * `yonnda` by reflex. Rewriting `nn` to `n` before conversion accepts that
 * habit.
 *
 * Only where a vowel cannot follow, so `nna` — which must stay んな — is left
 * alone.
 */
const collapseDoubledN = (text: string): string =>
  text.replace(/nn(?![aiueoy])/giu, `n`);

/**
 * Fold every spelling of the same sounds onto one string.
 *
 * Romaji becomes kana first — `toHiragana` handles the ambiguities a naive
 * table gets wrong (`shi` and `si`, doubled consonants for っ, long vowels).
 * Katakana then folds to hiragana so ウラナイ and うらない compare equal.
 */
const fold = (text: string): string =>
  looksRomaji(text)
    ? toHiragana(collapseDoubledN(text), { passRomaji: false })
    : toHiragana(text);

/** What the checker concluded, and why — the teaching embed needs the detail. */
export interface Judgement {
  correct: boolean;
  /** The kana form the answer was compared against. */
  expected: string;
  /** What the player's input folded to, for showing them their attempt. */
  normalized: string;
}

/**
 * Check an answer against the expected conjugation.
 *
 * Two ways to be right, mirroring how people actually write Japanese:
 *
 *  - the **kana** reading, folded, which accepts romaji and katakana too;
 *  - the **kanji** surface, compared unfolded, because 呼ばなかった and
 *    よばなかった are both correct but folding the former would not produce
 *    the latter — the kanji carries a reading the string does not spell out.
 *
 * `kanji` is optional because a word written only in kana has no separate
 * surface to accept.
 */
export const judge = (
  input: string,
  expected: { kana: string; kanji?: string }
): Judgement => {
  const cleaned = normalize(input);
  const folded = fold(cleaned);
  const target = fold(normalize(expected.kana));

  const matchesKana = folded === target;
  const matchesKanji =
    expected.kanji !== undefined && cleaned === normalize(expected.kanji);

  return {
    correct: matchesKana || matchesKanji,
    expected: expected.kana,
    normalized: folded
  };
};

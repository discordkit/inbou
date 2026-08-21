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

/** Is this character kana (hiragana, katakana, or the long-vowel mark)? */
const isKanaChar = (ch: string): boolean => {
  const code = ch.codePointAt(0) ?? 0;
  return (code >= 0x30_40 && code <= 0x30_ff) || code === 0x30_fc;
};

/**
 * Is this message even trying to be an answer?
 *
 * Every message in a channel with a running session reaches the handler, so
 * without this ordinary conversation scores as a wrong guess — burning an
 * attempt and littering the channel with ❌. The race is supposed to happen
 * *alongside* the chat, not instead of it.
 *
 * The test is a shared stem: a real attempt at 売らない starts うら, even when
 * it is wrong (うらなかった, うらん). Chatter almost never does. It is
 * deliberately generous — a wrong guess that shares nothing with the answer is
 * ignored rather than scored, which costs a player nothing, while scoring
 * someone's "lol same" costs them an attempt they never spent.
 *
 * `stem` is the shared prefix of the expected answer and the word it came from,
 * which is the part every conjugation of that word keeps.
 */
export const looksLikeAnswer = (
  input: string,
  expected: { kana: string; kanji?: string; stem: string }
): boolean => {
  const cleaned = normalize(input);
  if (cleaned === ``) return false;

  // Correct answers always count, however short. A one-mora answer like する
  // may share almost nothing with its stem.
  if (judge(input, expected).correct) return true;

  const folded = fold(cleaned);
  const stem = fold(normalize(expected.stem));
  if (stem === ``) return false;
  if (folded.startsWith(stem)) return true;

  // A guess written in kanji shares no prefix with a kana stem — 売らなかった
  // against う matches nothing — so the kanji spelling needs its own stem. It
  // is the expected kanji answer minus its trailing kana, which is exactly the
  // part every conjugation of that word keeps: 売らない → 売.
  const kanji = expected.kanji;
  if (kanji === undefined) return false;

  let tail = 0;
  while (
    tail < kanji.length &&
    isKanaChar(kanji[kanji.length - 1 - tail] ?? ``)
  ) {
    tail += 1;
  }
  const kanjiStem = kanji.slice(0, kanji.length - tail);
  return kanjiStem !== `` && cleaned.startsWith(kanjiStem);
};

import { toHiragana } from "wanakana";

/**
 * Deciding whether a typed message is the right conjugation.
 *
 * A channel is not an input box: answers arrive as romaji, kana, kanji or
 * katakana, with stray spaces and trailing punctuation. Everything here makes
 * those spellings agree without accepting a genuinely different word.
 */

/**
 * Trim what a chat message adds and a conjugation never contains.
 *
 * Japanese does not write word boundaries, so an internal space is always
 * noise and is removed rather than collapsed. Punctuation is stripped only at
 * the end, since nothing in a conjugation ends on it.
 */
export const normalize = (text: string): string =>
  text
    .normalize(`NFKC`)
    .replace(/\s+/gu, ``)
    .replace(/[。、.,!?！？]+$/u, ``);

/**
 * Is this plausibly romaji rather than Japanese?
 *
 * Conservative on purpose: converting something already kana would corrupt it,
 * while declining to convert real romaji only costs a retype.
 */
const looksRomaji = (text: string): boolean => /^[a-z]+$/iu.test(text);

/**
 * Collapse the IME spelling of ん before converting.
 *
 * wanakana reads `nn` as two ん, so `yonnda` becomes よんんだ. Japanese IMEs
 * treat a doubled `n` as the way to commit a single ん, so anyone trained on
 * one types it by reflex.
 *
 * Not before a vowel, where `nna` must stay んな.
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
 * Levenshtein distance, bounded so a long message exits early.
 *
 * Only used to recognise a typo, so anything past `limit` is "far" and the
 * exact figure does not matter — which keeps this O(limit x n) rather than
 * O(m x n) on a paragraph of chat.
 */
const editDistance = (a: string, b: string, limit: number): number => {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost
      );
      current.push(value);
      best = Math.min(best, value);
    }
    // Every cell in this row is already past the limit, so the final distance
    // can only be worse.
    if (best > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length] ?? limit + 1;
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
  const target = fold(normalize(expected.kana));

  // A typo is an attempt, even one that lands on the first mora. かたえない
  // against こたえない shares no prefix at all, so the stem test alone read it
  // as conversation and ignored a guess that was plainly aimed at the
  // question. Distance answers what the stem was standing in for.
  //
  // Scaled to the answer's length so a two-mora word does not accept anything
  // two edits away, which would be most of the kana syllabary.
  const budget = Math.min(2, Math.floor(target.length / 3) + 1);
  if (editDistance(folded, target, budget) <= budget) return true;

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

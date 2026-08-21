import {
  formsFor,
  formTable,
  isBasic,
  type Form,
  type WordType
} from "./forms.js";
import type { VerbClass } from "./wordClass.js";

/**
 * Choosing what to ask, and phrasing it.
 *
 * Deliberately pure and outside the Durable Object. The corpus is ~1.8 MB of
 * JSON, and a Durable Object runs its constructor on every wake from
 * hibernation — parsing that on each wake would spend the 10 ms CPU budget and
 * undo the hibernation savings the session design depends on. So selection
 * happens in the Worker's request path, which is already warm, and the session
 * object stores only the resolved question: a few hundred bytes.
 */

/** One corpus entry, as `corpus.json` stores it. */
export interface Word {
  id: string;
  kana: string;
  kanji?: string;
  pos: string;
  type: WordType;
  verbClass?: VerbClass;
  jlpt?: number;
  gloss: string;
  example?: { jpn: string; eng: string };
}

/** What a session filters the corpus down to. */
export interface Filters {
  /** JLPT levels to draw from, 5 (easiest) to 1. Empty means any level. */
  levels: readonly number[];
  types: readonly WordType[];
  /** Verb classes to include. Ignored for non-verbs. Empty means all. */
  classes: readonly VerbClass[];
  /** Which forms may be asked. Empty means every form the word supports. */
  forms: readonly Form[];
}

/**
 * A posed question, resolved down to strings.
 *
 * Everything the round needs is here, so the session object never has to reach
 * back into the corpus — which is what keeps it cheap to wake.
 */
export interface Question {
  wordId: string;
  /** What the channel is shown. */
  prompt: string;
  /** The form being asked for. */
  form: Form;
  /** The kana answer, which is what typed answers are folded onto. */
  answer: string;
  /** The kanji spelling of the answer, when the word has one. */
  answerKanji?: string;
  /**
   * The part every conjugation of this word keeps.
   *
   * Used to tell an attempt from ordinary conversation: a real guess at
   * 売らない starts うら even when it is wrong, while "lol same" does not. See
   * `looksLikeAnswer`.
   */
  stem: string;
  /** For the teaching embed and `/hint`. */
  dictionary: string;
  reading: string;
  gloss: string;
  type: WordType;
  verbClass?: VerbClass;
  example?: { jpn: string; eng: string };
}

/**
 * Why no question could be produced.
 *
 * A plain union rather than a Result wrapper: the caller narrows it with an
 * `in` check and pays nothing on the success path, which matters because this
 * runs once per question and 85,004 times in the corpus test.
 *
 * The two reasons need different responses, which is the whole point of
 * distinguishing them. `no-words` is a filter the channel chose that matches
 * nothing — easy to hit by accident, since N4 + godan-n is zero words and
 * adjectives have no verb class at all — so the bot tells them to widen it.
 * `no-forms` means words matched but none could produce an askable form, which
 * the corpus test says is impossible; if it ever happens it is a data bug worth
 * logging, not advice to give a player.
 */
export interface NoQuestion {
  empty: `no-words` | `no-forms`;
}

/** Narrow {@link generate}'s return. */
export const isQuestion = (result: Question | NoQuestion): result is Question =>
  !(`empty` in result);

/** Does this word pass the session's filters? */
export const matches = (word: Word, filters: Filters): boolean => {
  if (filters.levels.length > 0) {
    if (word.jlpt === undefined) return false;
    if (!filters.levels.includes(word.jlpt)) return false;
  }
  if (filters.types.length > 0 && !filters.types.includes(word.type)) {
    return false;
  }
  // Verb classes only constrain verbs. An adjective has no class, so a class
  // filter must not silently exclude every adjective the type filter allowed.
  if (
    filters.classes.length > 0 &&
    word.type === `verb` &&
    (word.verbClass === undefined || !filters.classes.includes(word.verbClass))
  ) {
    return false;
  }
  return true;
};

/**
 * Which forms can actually be asked of this word.
 *
 * Intersects what the word type supports with what the session asked for, then
 * keeps only forms the conjugator really produced. That last step is what makes
 * an unanswerable question impossible rather than merely unlikely.
 */
const askableForms = (word: Word, filters: Filters): Form[] => {
  const table = formTable(word.kana, [word.pos]);
  if (table === null) return [];

  const supported = formsFor(word.type);
  const wanted =
    filters.forms.length === 0
      ? supported
      : supported.filter((f) => filters.forms.includes(f));

  return wanted.filter((form) => table.casual[form] !== undefined);
};

/**
 * Build the question for a specific word and form.
 *
 * The prompt follows the rule in the spec: a basic tense/polarity form is asked
 * by showing its **polite** counterpart, so the player converts register; every
 * other form is asked from the dictionary form. Returns null if the word cannot
 * produce that form, which the caller treats as "pick again".
 */
export const pose = (word: Word, form: Form): Question | null => {
  const table = formTable(word.kana, [word.pos]);
  const answer = table?.casual[form];
  if (table === null || answer === undefined) return null;

  // A basic form's prompt is its own polite counterpart; anything else is asked
  // from the dictionary form, which for these entries is the reading itself.
  const prompt = isBasic(form) ? table.polite[form] : word.kana;
  if (prompt === undefined) return null;

  // The kanji spelling of the answer, built by splicing the entry's kanji
  // prefix onto the conjugated tail. Only meaningful when the kanji and the
  // reading share a trailing kana run — 売る/うる both end in る, so 売+らない
  // is right, while a word written entirely in kanji has nothing to splice.
  const answerKanji =
    word.kanji === undefined ? undefined : spliceKanji(word, answer);

  // The part every conjugation of this word keeps.
  //
  // Taken as the shared prefix of the dictionary form and this conjugation,
  // then capped one mora short of the dictionary form — the final mora is
  // exactly what conjugating replaces (うる → うらない, うって), so a stem that
  // included it would only ever match the dictionary form itself. That case is
  // real: the non-past affirmative IS the dictionary form, so the raw shared
  // prefix is the whole word.
  let shared = 0;
  while (
    shared < word.kana.length &&
    shared < answer.length &&
    word.kana[shared] === answer[shared]
  ) {
    shared += 1;
  }
  shared = Math.min(shared, Math.max(1, word.kana.length - 1));

  return {
    wordId: word.id,
    prompt,
    form,
    answer,
    stem: word.kana.slice(0, shared),
    ...(answerKanji === undefined ? {} : { answerKanji }),
    dictionary: word.kanji ?? word.kana,
    reading: word.kana,
    gloss: word.gloss,
    type: word.type,
    ...(word.verbClass === undefined ? {} : { verbClass: word.verbClass }),
    ...(word.example === undefined ? {} : { example: word.example })
  };
};

/** Is this character kana (hiragana, katakana, or the long-vowel mark)? */
const isKana = (ch: string): boolean => {
  const code = ch.codePointAt(0) ?? 0;
  return (code >= 0x3040 && code <= 0x30ff) || code === 0x30fc;
};

/**
 * Write a conjugated form in kanji, if the word has a kanji spelling.
 *
 * The conjugator works on the reading, so 売る + non-past-negative gives
 * うらない. The kanji form replaces the leading kana that the kanji spells:
 * 売る's reading is うる and its kanji is 売る, so the shared trailing kana is
 * る, the kanji covers う, and 売 + らない is the answer.
 *
 * Returns undefined when the split cannot be made confidently, since a wrong
 * kanji answer would reject a correct one.
 */
const spliceKanji = (word: Word, conjugated: string): string | undefined => {
  const kanji = word.kanji;
  if (kanji === undefined) return undefined;

  // The okurigana: the trailing kana run of the kanji spelling.
  let tail = 0;
  while (tail < kanji.length && isKana(kanji[kanji.length - 1 - tail] ?? ``)) {
    tail += 1;
  }
  const stem = kanji.slice(0, kanji.length - tail);
  if (stem === ``) return undefined;

  // The reading's matching prefix is everything before its own okurigana.
  const readingStem = word.kana.slice(0, word.kana.length - tail);
  if (readingStem === `` || !conjugated.startsWith(readingStem)) {
    return undefined;
  }

  return stem + conjugated.slice(readingStem.length);
};

/**
 * Pick a question from the corpus.
 *
 * `random` is injected rather than called directly so tests can drive
 * selection deterministically — a generator that can only be tested by
 * sampling is a generator whose edge cases go unexercised.
 *
 * Returns null when no word passes the filters, which the caller reports as a
 * misconfigured session rather than an empty round.
 */
export const generate = (
  words: readonly Word[],
  filters: Filters,
  random: () => number = Math.random
): Question | NoQuestion => {
  const pool = words.filter((w) => matches(w, filters));
  if (pool.length === 0) return { empty: `no-words` };

  // Try a few words before giving up: a word can pass the filters and still
  // have no askable form left once the form filter is applied, and scanning
  // the whole pool for one question would be wasteful on every question.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const word = pool[Math.floor(random() * pool.length)];
    if (word === undefined) continue;
    const forms = askableForms(word, filters);
    if (forms.length === 0) continue;
    const form = forms[Math.floor(random() * forms.length)];
    if (form === undefined) continue;
    const question = pose(word, form);
    if (question !== null) return question;
  }

  // Every random attempt missed. Fall back to a deterministic scan so a narrow
  // but valid filter combination still produces a question.
  for (const word of pool) {
    const [form] = askableForms(word, filters);
    if (form === undefined) continue;
    const question = pose(word, form);
    if (question !== null) return question;
  }

  return { empty: `no-forms` };
};

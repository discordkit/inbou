import {
  BLUEPRINTS,
  type MixPlan,
  type Mondai,
  type PassagePlan,
  type TestId
} from "./blueprint.js";
import {
  chunksOf,
  fill,
  joinChunks,
  parse,
  partsOf,
  plain,
  WINDOW_SIZE,
  type ComposeItem,
  type Difficulty,
  type FormItem,
  type Item,
  type PassageItem,
  type Slot
} from "./items.js";

/**
 * Drawing a mock test from the corpus.
 *
 * Each question type is a deck. A test draws a fixed number of cards from each
 * deck, at most once each, and nothing is remembered afterwards: every card is
 * back in its deck for the next test. Repeated exposure is the point, and the
 * random choices below — which distractors, where the ★ falls, which order —
 * keep a repeated card from looking identical.
 *
 * Pure, with the randomness injected, so a test can pin every choice.
 */

/** Injected so tests can pin every random choice. */
export type Random = () => number;

/** How many options every question offers, as on the paper. */
export const OPTION_COUNT = 4;

/** One question, fully resolved, as the session stores it. */
export interface ExamQuestion {
  /** The item it came from, for results and statistics. */
  itemId: string;
  /** Which slot, window or blank of the item was asked, 1-based. */
  slot: number;
  mondai: Mondai;
  /** 1-based, numbered straight through the test, as on the paper. */
  number: number;
  /** Markup the card shows: a sentence with its blank, a ★ line, or a passage. */
  prompt: string;
  /** Markup the reveal shows: the answer in place, underlined. */
  answered: string;
  /** A passage's situation line, shown above it. */
  intro?: string;
  /** Markup, shuffled. */
  options: string[];
  /**
   * Where the right answer landed.
   *
   * Lives here and in the session, never in a button's `customId` — a client
   * can read those.
   */
  correct: number;
  difficulty: Difficulty;
  points: string[];
  /** The English, or `` for a passage question before its last. */
  en: string;
  note: string;
  /** Routes a vote to this exact question; a press on any other is stale. */
  token: string;
  timeoutMs: number;
}

/**
 * Time to answer, by type, before reading time is added.
 *
 * Open in the spec (section 10): first guesses to tune in play. 問題2 starts
 * higher because arranging takes longer than choosing; 問題3 lower because its
 * passage adds most of the time.
 */
export const BASE_MS: Readonly<Record<Mondai, number>> = {
  1: 40_000,
  2: 60_000,
  3: 30_000
};

/** Reading time per character of text the player has to read. */
export const PER_CHAR_MS = 500;

/** How a ★ line shows its four blanks, with the star in one. */
const BLANK_LINE = `＿＿`;
const STAR_BLANK = `＿★＿`;

/** Fisher–Yates, on a copy. */
export const shuffle = <T>(items: readonly T[], random: Random): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
};

/** Six base-36 characters: enough to tell this test's questions apart. */
const tokenFrom = (random: Random): string =>
  Math.floor(random() * 36 ** 6)
    .toString(36)
    .padStart(6, `0`);

/**
 * How long a question stays open.
 *
 * A base per type plus time per character the player must read — the text and
 * all four options — so a long question gets longer. Rounded up to whole
 * seconds, which is all the countdown shows.
 */
export const timeoutFor = (
  mondai: Mondai,
  text: string,
  options: readonly string[]
): number => {
  const chars =
    plain(text).length +
    options.reduce((sum, option) => sum + plain(option).length, 0);
  return Math.ceil((BASE_MS[mondai] + chars * PER_CHAR_MS) / 1000) * 1000;
};

/** Underline each part of an answer: a pair (は／は) is two parts, two blanks. */
const underlined = (answer: string): string =>
  partsOf(answer)
    .map((part) => `__${part}__`)
    .join(`／`);

/** The answer and three wrong options drawn from the pool, shuffled. */
const optionsFor = (
  slot: Slot,
  random: Random
): { options: string[]; correct: number } => {
  const wrong = shuffle(slot.wrong, random).slice(0, OPTION_COUNT - 1);
  const options = shuffle([slot.answer, ...wrong], random);
  return { options, correct: options.indexOf(slot.answer) };
};

/** A question waiting to be drawn: one slot or window of one item. */
interface Card {
  item: Item;
  /** 0-based index into the item's slots or windows. */
  index: number;
  difficulty: Difficulty;
  points: readonly string[];
}

/** 問題1's cards are slots; 問題2's are windows. */
const cardsOf = (items: readonly Item[], mondai: MixPlan[`mondai`]): Card[] =>
  items.flatMap((item): Card[] => {
    const units =
      mondai === 1 && item.type === `form`
        ? item.slots
        : mondai === 2 && item.type === `compose`
          ? item.windows
          : [];
    return units.map((unit, index) => ({
      item,
      index,
      difficulty: unit.difficulty,
      points: unit.points
    }));
  });

const LEVELS: readonly Difficulty[] = [1, 2, 3];

/**
 * Draw one deck's share, by difficulty.
 *
 * Three preferences, strongest first:
 *
 *  1. **One card per item.** Two slots of the same sentence in one test would
 *     show the sentence twice, with the second answer already given away.
 *  2. **The difficulty the blueprint asks for.** When that level runs short,
 *     the nearest level stands in rather than the draw failing — a thin deck
 *     should give a slightly easier or harder test, not no test.
 *  3. **A grammar point not yet asked.** The real paper does not test one point
 *     twice. A preference, not a rule, so a small deck still fills its share.
 *
 * The result is shuffled, because the paper does not sort by difficulty.
 */
export const drawDeck = (
  items: readonly Item[],
  plan: MixPlan,
  random: Random
): Array<{ item: Item; index: number }> => {
  const cards = cardsOf(items, plan.mondai);
  const wanted = LEVELS.flatMap((level) =>
    Array.from({ length: plan.mix[level] }, () => level)
  );

  const chosen: Card[] = [];
  const usedItems = new Set<string>();
  const usedPoints = new Set<string>();

  for (const want of wanted) {
    const open = cards.filter((card) => !usedItems.has(card.item.id));
    if (open.length === 0) break;

    const nearest = Math.min(
      ...open.map((card) => Math.abs(card.difficulty - want))
    );
    const level = open.filter(
      (card) => Math.abs(card.difficulty - want) === nearest
    );
    const fresh = level.filter(
      (card) => !card.points.some((point) => usedPoints.has(point))
    );
    const pool = fresh.length > 0 ? fresh : level;
    const card = pool.at(Math.floor(random() * pool.length));
    if (card === undefined) break;

    chosen.push(card);
    usedItems.add(card.item.id);
    for (const point of card.points) usedPoints.add(point);
  }

  return shuffle(chosen, random).map(({ item, index }) => ({ item, index }));
};

/** 問題1: one slot of a sentence, its other blanks filled in. */
export const formQuestion = (
  item: FormItem,
  slotIndex: number,
  number: number,
  random: Random
): ExamQuestion => {
  const slot = item.slots.at(slotIndex);
  if (slot === undefined) {
    throw new Error(`${item.id} has no slot ${String(slotIndex + 1)}`);
  }
  const asked = slotIndex + 1;

  // Every other blank is shown filled, so the sentence reads as one question.
  const others = new Map(
    item.slots
      .map((other, index) => [index + 1, other.answer] as const)
      .filter(([n]) => n !== asked)
  );
  const prompt = fill(item.sentence, others);
  const { options, correct } = optionsFor(slot, random);

  return {
    itemId: item.id,
    slot: asked,
    mondai: 1,
    number,
    prompt,
    answered: fill(prompt, new Map([[asked, underlined(slot.answer)]])),
    options,
    correct,
    difficulty: slot.difficulty,
    points: [...slot.points],
    en: item.en,
    note: slot.note,
    token: tokenFrom(random),
    timeoutMs: timeoutFor(1, prompt, options)
  };
};

/**
 * 問題2: one window of a sentence, with the ★ at a random position.
 *
 * The window has exactly one valid order — the reviewer's promise — so the
 * star can fall on any of its four chunks and each is a fair question. One
 * window gives four questions; a repeated card rarely asks the same thing.
 */
export const composeQuestion = (
  item: ComposeItem,
  windowIndex: number,
  number: number,
  random: Random
): ExamQuestion => {
  const window = item.windows.at(windowIndex);
  if (window === undefined) {
    throw new Error(`${item.id} has no window ${String(windowIndex + 1)}`);
  }
  const chunks = chunksOf(item.sentence);
  const before = chunks.slice(0, window.start);
  const inside = chunks.slice(window.start, window.start + WINDOW_SIZE);
  const after = chunks.slice(window.start + WINDOW_SIZE);

  const star = Math.floor(random() * WINDOW_SIZE);
  const answer = inside.at(star)?.text ?? ``;

  // The paper sets the four blanks apart with spaces, whatever the sentence's
  // own spacing there.
  const blanks = inside
    .map((_, index) => (index === star ? STAR_BLANK : BLANK_LINE))
    .join(` `);
  const prompt = [joinChunks(before).trimEnd(), blanks, joinChunks(after)]
    .filter((text) => text !== ``)
    .join(` `);

  // The whole window underlined: the order is the lesson, and the ★ answer
  // is named beside it.
  const middle = joinChunks(inside);
  const answered = `${joinChunks(before)}__${middle.trimEnd()}__${
    middle.endsWith(` `) ? ` ` : ``
  }${joinChunks(after)}`;

  const options = shuffle(
    inside.map((chunk) => chunk.text),
    random
  );

  return {
    itemId: item.id,
    slot: windowIndex + 1,
    mondai: 2,
    number,
    prompt,
    answered,
    options,
    correct: options.indexOf(answer),
    difficulty: window.difficulty,
    points: [...window.points],
    en: item.en,
    note: window.note,
    token: tokenFrom(random),
    timeoutMs: timeoutFor(2, prompt, options)
  };
};

/** The passage's blanks, in the order a reader meets them. */
const blankOrder = (text: string): number[] => {
  const order: number[] = [];
  for (const segment of parse(text)) {
    if (segment.kind === `blank` && !order.includes(segment.slot)) {
      order.push(segment.slot);
    }
  }
  return order;
};

/** The sentence holding the underlined answer, for the reveal. */
const sentenceWith = (text: string, marker: string): string =>
  (text.match(/[^。！？\n]+[。！？]?/gu) ?? [])
    .find((sentence) => sentence.includes(marker))
    ?.trim() ?? text;

/**
 * 問題3: one passage, asked blank by blank, in reading order.
 *
 * Blanks not asked are shown filled from the start. An asked blank shows its
 * question number until its turn — ［15］ — and its answer once revealed, so
 * the passage completes as the group goes on.
 *
 * The passage counts toward the first question's time and not again: by the
 * second blank it has been read.
 */
export const passageQuestions = (
  item: PassageItem,
  count: number,
  firstNumber: number,
  random: Random
): ExamQuestion[] => {
  const order = blankOrder(item.text);
  const asked = shuffle(order, random)
    .slice(0, count)
    .sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const numberOf = (slot: number): number => firstNumber + asked.indexOf(slot);
  const answerOf = (slot: number): string =>
    item.blanks.at(slot - 1)?.answer ?? ``;

  return asked.map((slot, position) => {
    const blank = item.blanks.at(slot - 1);
    if (blank === undefined)
      throw new Error(`${item.id} has no blank ${String(slot)}`);

    const shown = (current: string): Map<number, string> =>
      new Map(
        order.map((other) => {
          const turn = asked.indexOf(other);
          if (other === slot) return [other, current];
          // Not asked, or already revealed: its answer.
          if (turn === -1 || turn < position) return [other, answerOf(other)];
          return [other, `［${String(numberOf(other))}］`];
        })
      );

    const prompt = fill(item.text, shown(`**［${String(numberOf(slot))}］**`));
    const { options, correct } = optionsFor(blank, random);
    const last = position === asked.length - 1;

    return {
      itemId: item.id,
      slot,
      mondai: 3,
      number: numberOf(slot),
      prompt,
      answered: sentenceWith(
        fill(item.text, shown(underlined(blank.answer))),
        `__`
      ),
      ...(item.intro === undefined ? {} : { intro: item.intro }),
      options,
      correct,
      difficulty: blank.difficulty,
      points: [...blank.points],
      en: last ? item.en : ``,
      note: blank.note,
      token: tokenFrom(random),
      timeoutMs: timeoutFor(3, position === 0 ? prompt : ``, options)
    };
  });
};

/** One passage with enough blanks, or none if the deck has none. */
const drawPassage = (
  items: readonly Item[],
  plan: PassagePlan,
  random: Random
): PassageItem | null => {
  const passages = items.filter(
    (item): item is PassageItem =>
      item.type === `passage` && item.blanks.length >= plan.blanks
  );
  return passages.at(Math.floor(random() * passages.length)) ?? null;
};

/**
 * Draw a whole test, once, when it starts.
 *
 * The session stores the result, so nothing about the draw needs to survive
 * the test — which is what puts every card back in its deck afterwards.
 */
export const drawTest = (
  test: TestId,
  items: readonly Item[],
  random: Random
): ExamQuestion[] => {
  const questions: ExamQuestion[] = [];
  for (const plan of BLUEPRINTS[test]) {
    if (plan.mondai === 3) {
      const passage = drawPassage(items, plan, random);
      if (passage !== null) {
        questions.push(
          ...passageQuestions(
            passage,
            plan.blanks,
            questions.length + 1,
            random
          )
        );
      }
      continue;
    }
    for (const { item, index } of drawDeck(items, plan, random)) {
      const number = questions.length + 1;
      if (item.type === `form`) {
        questions.push(formQuestion(item, index, number, random));
      } else if (item.type === `compose`) {
        questions.push(composeQuestion(item, index, number, random));
      }
    }
  }
  return questions;
};

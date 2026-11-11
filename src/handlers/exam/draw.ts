import {
  BLUEPRINTS,
  type DeckPlan,
  type Mondai,
  type TestId
} from "./blueprint.js";
import {
  fill,
  plain,
  type Difficulty,
  type FormItem,
  type Item
} from "./items.js";

/**
 * Drawing a mock test from the corpus.
 *
 * Each question type is a deck. A test draws a fixed number of cards from each
 * deck, at most once each, and nothing is remembered afterwards: every card is
 * back in its deck for the next test. Repeated exposure is the point, and the
 * random choices below — which distractors, which order — keep a repeated card
 * from looking identical.
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
  /** Which slot of the item was asked, 1-based. */
  slot: number;
  mondai: Mondai;
  /** 1-based, numbered straight through the test, as on the paper. */
  number: number;
  /** Markup: the sentence with the asked blank open and any others filled in. */
  prompt: string;
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
  en: string;
  note: string;
  /** Routes a vote to this exact question; a press on any other is stale. */
  token: string;
  timeoutMs: number;
}

/**
 * Time to answer, by type, before reading time is added.
 *
 * Open in the spec (section 10): these are first guesses to tune in play.
 */
export const BASE_MS: Readonly<Record<Mondai, number>> = { 1: 40_000 };

/** Reading time per character of text the player has to read. */
export const PER_CHAR_MS = 500;

/** A question waiting to be drawn: one slot of one item. */
interface Card {
  item: FormItem;
  /** 0-based index into `item.slots`. */
  slot: number;
  difficulty: Difficulty;
  points: readonly string[];
}

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
 * A base per type plus time per character the player must read — the sentence
 * and all four options — so a long question gets longer. Rounded up to whole
 * seconds, which is all the countdown shows.
 */
export const timeoutFor = (
  mondai: Mondai,
  prompt: string,
  options: readonly string[]
): number => {
  const chars =
    plain(prompt).length +
    options.reduce((sum, option) => sum + plain(option).length, 0);
  return Math.ceil((BASE_MS[mondai] + chars * PER_CHAR_MS) / 1000) * 1000;
};

/**
 * Every slot of every item, as a card.
 *
 * Not filtered by type yet, because 問題1 is the only type. When 問題2 and 3
 * join `Item`, `item.slots` stops existing on every member and this fails to
 * compile until it filters by the plan's type.
 */
const cardsOf = (items: readonly Item[]): Card[] =>
  items.flatMap((item) =>
    item.slots.map((slot, index) => ({
      item,
      slot: index,
      difficulty: slot.difficulty,
      points: slot.points
    }))
  );

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
  plan: DeckPlan,
  random: Random
): Array<{ item: FormItem; slot: number }> => {
  const cards = cardsOf(items);
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

  return shuffle(chosen, random).map(({ item, slot }) => ({ item, slot }));
};

/** Turn one drawn slot into a question the channel can answer. */
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

  const wrong = shuffle(slot.wrong, random).slice(0, OPTION_COUNT - 1);
  const options = shuffle([slot.answer, ...wrong], random);

  return {
    itemId: item.id,
    slot: asked,
    mondai: 1,
    number,
    prompt,
    options,
    correct: options.indexOf(slot.answer),
    difficulty: slot.difficulty,
    points: [...slot.points],
    en: item.en,
    note: slot.note,
    token: tokenFrom(random),
    timeoutMs: timeoutFor(1, prompt, options)
  };
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
    for (const { item, slot } of drawDeck(items, plan, random)) {
      questions.push(formQuestion(item, slot, questions.length + 1, random));
    }
  }
  return questions;
};

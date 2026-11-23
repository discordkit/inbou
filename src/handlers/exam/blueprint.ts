import type { Difficulty } from "./items.js";

/**
 * What each mock test draws from the corpus.
 *
 * Its own module, with only a type import, so plain Node can load it: the
 * corpus build reports each deck's size against what a test draws from it.
 */

/**
 * The number a card shows: 1–3 grammar and 4–6 reading in Section 2.
 *
 * Only a number. What kind of question it is lives in the item's type, because each section of the paper numbers its 問題 from 1.
 */
export type Mondai = 1 | 2 | 3 | 4 | 5 | 6;

/** The tests a channel can start. */
export type TestId = `bunpou` | `dokkai` | `goi`;

/** How many questions of each difficulty. */
export type Mix = Readonly<Record<Difficulty, number>>;

/**
 * One deck's share of a test, drawn by difficulty.
 *
 * The mix is fixed so every test is about equally hard, and a student's
 * scores can be compared from one test to the next. Used for 問題1, whose
 * cards are slots, and 問題2, whose cards are windows.
 */
export type MixPlan =
  | { mondai: 1; type: `form`; mix: Mix }
  | { mondai: 2; type: `compose`; mix: Mix }
  // Section 1, numbered from 1 again. Each card is a whole item: one sentence, one question.
  | { mondai: 1; type: `kanji`; mix: Mix }
  | { mondai: 2; type: `spelling`; mix: Mix }
  | { mondai: 3; type: `context`; mix: Mix }
  | { mondai: 4; type: `paraphrase`; mix: Mix };

/**
 * 問題3's share: one passage, and how many of its blanks to ask.
 *
 * Not drawn by difficulty: a passage is one card, and difficulty belongs to
 * its blanks, which are asked in the order they appear.
 */
export interface PassagePlan {
  mondai: 3;
  type: `passage`;
  blanks: number;
}

/**
 * A reading deck's share: how many questions it asks.
 *
 * `together` asks them all of one text, on one card, in the order the text
 * answers them (問題5). Otherwise each question comes from a different text,
 * on a card of its own (問題4, 問題6).
 *
 * Difficulty is not fixed per deck but shared by the test: see {@link READING_MIX}.
 */
export type ReadingPlan =
  | { mondai: 4; type: `short`; questions: number; together: false }
  | { mondai: 6; type: `info`; questions: number; together: false }
  | { mondai: 5; type: `mid`; questions: number; together: true };

export type DeckPlan = MixPlan | PassagePlan | ReadingPlan;

/**
 * What each test draws.
 *
 * Grammar is the real N5 paper's 9 + 4 + 4; the mixes are a first guess, open in the spec (section 10). Reading is its 2 + 2 + 1. Vocabulary is Section 1's 7 + 5 + 6 + 3, with first-guess mixes too.
 */
export const BLUEPRINTS: Readonly<Record<TestId, readonly DeckPlan[]>> = {
  bunpou: [
    { mondai: 1, type: `form`, mix: { 1: 3, 2: 4, 3: 2 } },
    { mondai: 2, type: `compose`, mix: { 1: 1, 2: 2, 3: 1 } },
    { mondai: 3, type: `passage`, blanks: 4 }
  ],
  dokkai: [
    { mondai: 4, type: `short`, questions: 2, together: false },
    { mondai: 5, type: `mid`, questions: 2, together: true },
    { mondai: 6, type: `info`, questions: 1, together: false }
  ],
  // 漢字読み comes before 表記, and the draw keeps their words apart: the 表記 deck never asks a word the 漢字読み deck showed.
  goi: [
    { mondai: 1, type: `kanji`, mix: { 1: 2, 2: 3, 3: 2 } },
    { mondai: 2, type: `spelling`, mix: { 1: 2, 2: 2, 3: 1 } },
    { mondai: 3, type: `context`, mix: { 1: 2, 2: 3, 3: 1 } },
    { mondai: 4, type: `paraphrase`, mix: { 1: 1, 2: 1, 3: 1 } }
  ]
};

/**
 * The reading test's difficulty, shared by its decks and shuffled across them.
 *
 * Every test asks 2 easy, 2 medium and 1 hard question, so tests are equally hard and scores compare. Which 問題 gets which level changes each test. A fixed level per deck would never ask 問題6's easy or hard questions, because it asks only one (the user's choice, 2026-11-22).
 */
export const READING_MIX: Mix = { 1: 2, 2: 2, 3: 1 };

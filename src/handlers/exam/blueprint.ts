import type { Difficulty } from "./items.js";

/**
 * What each mock test draws from the corpus.
 *
 * Its own module, with only a type import, so plain Node can load it: the
 * corpus build reports each deck's size against what a test draws from it.
 */

/** The paper's grammar question types. */
export type Mondai = 1 | 2 | 3;

/** The tests a channel can start. */
export type TestId = `bunpou`;

/**
 * One deck's share of a test, drawn by difficulty.
 *
 * The mix is fixed so every test is about equally hard, and a student's
 * scores can be compared from one test to the next. Used for 問題1, whose
 * cards are slots, and 問題2, whose cards are windows.
 */
export interface MixPlan {
  mondai: 1 | 2;
  mix: Readonly<Record<Difficulty, number>>;
}

/**
 * 問題3's share: one passage, and how many of its blanks to ask.
 *
 * Not drawn by difficulty: a passage is one card, and difficulty belongs to
 * its blanks, which are asked in the order they appear.
 */
export interface PassagePlan {
  mondai: 3;
  blanks: number;
}

export type DeckPlan = MixPlan | PassagePlan;

/**
 * What each test draws: the real N5 grammar paper, 9 + 4 + 4. The mixes are a
 * first guess, open in the spec (section 10).
 */
export const BLUEPRINTS: Readonly<Record<TestId, readonly DeckPlan[]>> = {
  bunpou: [
    { mondai: 1, mix: { 1: 3, 2: 4, 3: 2 } },
    { mondai: 2, mix: { 1: 1, 2: 2, 3: 1 } },
    { mondai: 3, blanks: 4 }
  ]
};

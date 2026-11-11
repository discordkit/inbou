import type { Difficulty } from "./items.js";

/**
 * What each mock test draws from the corpus.
 *
 * Its own module, with only a type import, so plain Node can load it: the
 * corpus build reports each deck's size against what a test draws from it.
 */

/** The paper's question types. Phase 1 builds 問題1 only. */
export type Mondai = 1;

/** The tests a channel can start. */
export type TestId = `bunpou`;

/**
 * One deck's share of a test.
 *
 * The difficulty mix is fixed so every test is about equally hard, and a
 * student's scores can be compared from one test to the next.
 */
export interface DeckPlan {
  mondai: Mondai;
  mix: Readonly<Record<Difficulty, number>>;
}

/**
 * What each test draws. The real N5 grammar paper is 9 + 4 + 4; 問題2 and 問題3
 * join `bunpou` when they are built. The 3 / 4 / 2 mix is a first guess, open
 * in the spec (section 10).
 */
export const BLUEPRINTS: Readonly<Record<TestId, readonly DeckPlan[]>> = {
  bunpou: [{ mondai: 1, mix: { 1: 3, 2: 4, 3: 2 } }]
};

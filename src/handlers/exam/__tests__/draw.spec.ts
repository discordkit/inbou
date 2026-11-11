import { describe, expect, it } from "vite-plus/test";
import { BLUEPRINTS } from "../blueprint.js";
import {
  drawDeck,
  drawTest,
  formQuestion,
  OPTION_COUNT,
  timeoutFor,
  type Random
} from "../draw.js";
import type { Difficulty, FormItem } from "../items.js";

/**
 * Drawing a test from the decks.
 *
 * The draw is what makes a mock test comparable from one sitting to the next,
 * so these tests pin the blueprint's promises: the difficulty mix, no repeats
 * within a test, and answers spread evenly over the four positions.
 */

/** A seeded generator, so every run draws the same thing. */
const seeded = (seed: number): Random => {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
};

const item = (
  n: number,
  difficulty: Difficulty,
  point = `point-${String(n)}`
): FormItem => ({
  id: `n5-b1-${String(n).padStart(4, `0`)}`,
  type: `form`,
  status: `reviewed`,
  sentence: `ぶん${String(n)}（1）です。`,
  en: `Sentence ${String(n)}.`,
  slots: [
    {
      answer: `あ${String(n)}`,
      wrong: [
        `い${String(n)}`,
        `う${String(n)}`,
        `え${String(n)}`,
        `お${String(n)}`
      ],
      difficulty,
      points: [point],
      note: `n`
    }
  ]
});

/** A deck with `count` items at each difficulty. */
const deck = (count: Readonly<Record<Difficulty, number>>): FormItem[] => {
  const items: FormItem[] = [];
  for (const level of [1, 2, 3] as const) {
    for (let i = 0; i < count[level]; i += 1) {
      items.push(item(items.length + 1, level));
    }
  }
  return items;
};

const PLAN = BLUEPRINTS.bunpou[0];
if (PLAN === undefined) throw new Error(`bunpou has no 問題1 plan`);

const levelsOf = (drawn: readonly { item: FormItem; slot: number }[]) => {
  const levels = { 1: 0, 2: 0, 3: 0 };
  for (const { item: drawnItem, slot } of drawn) {
    const level = drawnItem.slots[slot]?.difficulty;
    if (level !== undefined) levels[level] += 1;
  }
  return levels;
};

describe(`drawing a deck`, () => {
  it(`keeps the blueprint's difficulty mix when the deck allows it`, () => {
    // WHY: a fixed mix is what makes this week's score comparable with last
    // week's. A random mix would move scores by luck of the draw.
    const drawn = drawDeck(deck({ 1: 10, 2: 10, 3: 10 }), PLAN, seeded(1));
    expect(levelsOf(drawn)).toEqual(PLAN.mix);
  });

  it(`never draws the same item twice in one test`, () => {
    // WHY: one card per sitting. A repeat inside a test is a free point the
    // second time, and it means another item went unasked. Every item shares
    // one grammar point here: with distinct points, the point preference
    // alone would keep items apart and hide a broken item rule.
    const shared = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) =>
      item(n, ((n % 3) + 1) as Difficulty, `shared`)
    );
    for (let seed = 1; seed <= 50; seed += 1) {
      const drawn = drawDeck(shared, PLAN, seeded(seed));
      const ids = drawn.map(({ item: drawnItem }) => drawnItem.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it(`draws one slot per item, even when an item has several`, () => {
    // WHY: asking two slots of one sentence shows it twice, and the second
    // question shows the first one's answer filled in.
    const twoSlots: FormItem = {
      ...item(1, 1),
      sentence: `ぶん（1） と（2）です。`,
      slots: [
        { ...item(1, 1).slots[0], answer: `か`, wrong: [`き`, `く`, `け`] },
        { ...item(1, 1).slots[0], answer: `さ`, wrong: [`し`, `す`, `せ`] }
      ]
    };
    const drawn = drawDeck(
      [twoSlots, ...deck({ 1: 0, 2: 9, 3: 0 })],
      PLAN,
      seeded(3)
    );
    expect(
      drawn.filter(({ item: d }) => d.id === twoSlots.id).length
    ).toBeLessThanOrEqual(1);
  });

  it(`borrows from the nearest level when one runs short, rather than failing`, () => {
    // WHY: a thin deck should give a slightly easier test, not no test. The
    // count matters more than the mix: a short test is a different test.
    const drawn = drawDeck(deck({ 1: 5, 2: 6, 3: 0 }), PLAN, seeded(4));
    expect(drawn).toHaveLength(9);
    expect(levelsOf(drawn)[3]).toBe(0);
  });

  it(`draws what there is when the whole deck is smaller than the plan`, () => {
    // WHY: the seed corpus is small. A test of five questions is better than
    // an error, and the coverage report already says the deck is short.
    expect(drawDeck(deck({ 1: 2, 2: 2, 3: 1 }), PLAN, seeded(5))).toHaveLength(
      5
    );
  });

  it(`prefers grammar points not yet asked`, () => {
    // WHY: the real paper does not test one point twice. With enough points
    // to go round, no point should repeat.
    const items = [
      ...[1, 2, 3, 4, 5, 6].map((n) => item(n, 1, `same-point`)),
      ...[7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map((n) => item(n, 1))
    ];
    const plan = { mondai: 1 as const, mix: { 1: 9, 2: 0, 3: 0 } };
    for (let seed = 1; seed <= 20; seed += 1) {
      const drawn = drawDeck(items, plan, seeded(seed));
      const same = drawn.filter(({ item: d }) =>
        d.slots[0]?.points.includes(`same-point`)
      );
      expect(same.length).toBeLessThanOrEqual(1);
    }
  });
});

describe(`a question`, () => {
  it(`offers the answer and three wrong options from the pool, once each`, () => {
    // WHY: a question with two right answers, or none, cannot be scored.
    const source = item(1, 1);
    const question = formQuestion(source, 0, 1, seeded(6));
    expect(question.options).toHaveLength(OPTION_COUNT);
    expect(new Set(question.options).size).toBe(OPTION_COUNT);
    expect(question.options[question.correct]).toBe(source.slots[0]?.answer);
    const wrong = question.options.filter((_, i) => i !== question.correct);
    for (const option of wrong)
      expect(source.slots[0]?.wrong).toContain(option);
  });

  it(`puts the answer in each position about equally often`, () => {
    // WHY: a bias toward one position is a strategy that beats the test.
    // One continuous stream, not one seed per draw: seeding 1..N measures the
    // seed sequence instead of the shuffle (a bug tome's tests once had).
    const random = seeded(7);
    const positions = [0, 0, 0, 0];
    const draws = 4000;
    for (let i = 0; i < draws; i += 1) {
      const { correct } = formQuestion(item(1, 1), 0, 1, random);
      positions[correct] = (positions[correct] ?? 0) + 1;
    }
    for (const count of positions) {
      expect(count).toBeGreaterThan(draws / 4 - 150);
      expect(count).toBeLessThan(draws / 4 + 150);
    }
  });

  it(`shows the other slots of the sentence filled in`, () => {
    // WHY: an unrelated empty blank beside the asked one would read as a
    // second question with no options.
    const twoSlots: FormItem = {
      ...item(1, 1),
      sentence: `わたし（1） パン（2） たべます。`,
      slots: [
        { ...item(1, 1).slots[0], answer: `は`, wrong: [`を`, `に`, `で`] },
        { ...item(1, 1).slots[0], answer: `を`, wrong: [`が`, `に`, `で`] }
      ]
    };
    expect(formQuestion(twoSlots, 1, 1, seeded(8)).prompt).toBe(
      `わたしは パン（2） たべます。`
    );
  });

  it(`gives longer questions more time, in whole seconds`, () => {
    // WHY: the timer is weighted by length, so a dialogue does not get the
    // same time as a five-word sentence.
    const short = timeoutFor(1, `ぶん（1）です。`, [`あ`, `い`, `う`, `え`]);
    const long = timeoutFor(1, `ながい ながい ながい ぶん（1）です。`, [
      `あ`,
      `い`,
      `う`,
      `え`
    ]);
    expect(long).toBeGreaterThan(short);
    expect(short % 1000).toBe(0);
  });
});

describe(`drawing a test`, () => {
  it(`numbers its questions straight through`, () => {
    // WHY: the paper numbers questions across the whole section, and the
    // reveal and the results refer to those numbers.
    const questions = drawTest(`bunpou`, deck({ 1: 5, 2: 5, 3: 5 }), seeded(9));
    expect(questions.map((q) => q.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it(`gives every question its own token`, () => {
    // WHY: the token is what rejects a press on an old question. Two
    // questions sharing one would let a vote land on the wrong question.
    const questions = drawTest(
      `bunpou`,
      deck({ 1: 5, 2: 5, 3: 5 }),
      seeded(10)
    );
    expect(new Set(questions.map((q) => q.token)).size).toBe(questions.length);
  });
});

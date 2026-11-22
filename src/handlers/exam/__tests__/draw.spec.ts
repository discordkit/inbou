import { describe, expect, it } from "vite-plus/test";
import { BLUEPRINTS, type MixPlan } from "../blueprint.js";
import {
  composeQuestion,
  drawDeck,
  drawTest,
  formQuestion,
  OPTION_COUNT,
  passageQuestions,
  PER_CHAR_MS,
  readingQuestions,
  reviewOf,
  timeoutFor,
  type Random
} from "../draw.js";
import {
  materialMarkup,
  plain,
  type ComposeItem,
  type Difficulty,
  type FormItem,
  type InfoItem,
  type Item,
  type MidItem,
  type PassageItem,
  type ShortItem
} from "../items.js";

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

const PLAN = BLUEPRINTS.bunpou.find(
  (plan): plan is MixPlan => plan.mondai === 1
);
if (PLAN === undefined) throw new Error(`bunpou has no 問題1 plan`);

const levelsOf = (drawn: readonly { item: Item; index: number }[]) => {
  const levels = { 1: 0, 2: 0, 3: 0 };
  for (const { item: drawnItem, index } of drawn) {
    const level =
      drawnItem.type === `form`
        ? drawnItem.slots.at(index)?.difficulty
        : undefined;
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
    const plan = { type: `form` as const, mix: { 1: 9, 2: 0, 3: 0 } };
    for (let seed = 1; seed <= 20; seed += 1) {
      const drawn = drawDeck(items, plan, seeded(seed));
      const same = drawn.filter(
        ({ item: d }) =>
          d.type === `form` &&
          d.slots.at(0)?.points.includes(`same-point`) === true
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
    const short = timeoutFor(`form`, `ぶん（1）です。`, [
      `あ`,
      `い`,
      `う`,
      `え`
    ]);
    const long = timeoutFor(`form`, `ながい ながい ながい ぶん（1）です。`, [
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
    const questions = drawTest(
      `bunpou`,
      deck({ 1: 5, 2: 5, 3: 5 }),
      {},
      seeded(9)
    );
    expect(questions.map((q) => q.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it(`gives every question its own token`, () => {
    // WHY: the token is what rejects a press on an old question. Two
    // questions sharing one would let a vote land on the wrong question.
    const questions = drawTest(
      `bunpou`,
      deck({ 1: 5, 2: 5, 3: 5 }),
      {},
      seeded(10)
    );
    expect(new Set(questions.map((q) => q.token)).size).toBe(questions.length);
  });

  it(`gives every question the review page for its grammar point`, () => {
    // WHY: the reveal and My results read links from the stored question, after the draw. A question drawn without them would show none, however complete the corpus.
    const items = deck({ 1: 5, 2: 5, 3: 5 });
    const links = Object.fromEntries(
      items
        .flatMap((item) => item.slots.flatMap((slot) => slot.points))
        .map((point) => [
          point,
          { label: point, url: `https://www.tofugu.com/${point}/` }
        ])
    );
    const questions = drawTest(`bunpou`, items, links, seeded(9));
    expect(questions.length).toBeGreaterThan(0);
    for (const q of questions) {
      expect(q.review).toEqual(q.points.map((point) => links[point]));
    }
  });
});

describe(`review links`, () => {
  it(`gives a page once when two points share it, and skips a point with none`, () => {
    // WHY: と for "with" and いっしょに share one Tofugu section. The same link twice reads like a mistake, and a point with no page must not leave an empty link.
    const url = `https://www.tofugu.com/japanese-grammar/particle-to/#as-in-with`;
    expect(
      reviewOf([`particle-to-with`, `adverb-issho-ni`, `form-kata`], {
        "particle-to-with": { label: `と`, url },
        "adverb-issho-ni": { label: `いっしょに`, url }
      })
    ).toEqual([{ label: `と`, url }]);
  });
});

describe(`a revealed answer`, () => {
  it(`underlines each half of a pair answer separately`, () => {
    // WHY: the reveal is a heading, already bold, so the answer is underlined
    // — a bold one vanished in the first live test. One pair of markers
    // around も／も would span the text between the two blanks.
    const pair: FormItem = {
      ...item(1, 3),
      sentence: `{日曜日|にちようび}（1） {土曜日|どようび}（1）、{休|やす}みです。`,
      slots: [
        {
          answer: `も／も`,
          wrong: [`は／は`, `に／に`, `を／を`],
          difficulty: 3,
          points: [`p`],
          note: `n`
        }
      ]
    };
    expect(formQuestion(pair, 0, 1, seeded(11)).answered).toBe(
      `{日曜日|にちようび}__も__ {土曜日|どようび}__も__、{休|やす}みです。`
    );
  });
});

/** この かばんは わたしの です: one window, chunks 1 to 4. */
const bag: ComposeItem = {
  id: `n5-b2-0001`,
  type: `compose`,
  status: `reviewed`,
  sentence: `この / かばん/は / わたし/の / です。`,
  en: `This bag is mine.`,
  windows: [{ start: 1, difficulty: 1, points: [`p`], note: `n` }]
};
const WINDOW = [`かばん`, `は`, `わたし`, `の`];

describe(`a ★ question`, () => {
  it(`hides the window behind four blanks, one of them starred`, () => {
    // WHY: the chunks are the options. Any of them left in the sentence would
    // give its place away.
    const { prompt } = composeQuestion(bag, 0, 1, seeded(12));
    expect(prompt).toMatch(
      /^この (＿＿|＿★＿) (＿＿|＿★＿) (＿＿|＿★＿) (＿＿|＿★＿) です。$/u
    );
    // The pattern above leaves no room for a chunk between the blanks; this
    // pins the star to exactly one of them.
    expect(prompt.match(/★/gu)).toHaveLength(1);
  });

  it(`answers with the chunk at the star's position`, () => {
    // WHY: the whole question is "which chunk lands on ★". An answer taken
    // from any other position would mark right answers wrong.
    const random = seeded(13);
    for (let i = 0; i < 200; i += 1) {
      const question = composeQuestion(bag, 0, 1, random);
      const star = question.prompt
        .replace(/^この /u, ``)
        .split(` `)
        .indexOf(`＿★＿`);
      expect(question.options[question.correct]).toBe(WINDOW[star]);
    }
  });

  it(`puts the star on each of the four positions about equally often`, () => {
    // WHY: a star that favoured one position would make a repeated card ask
    // the same thing, and a student could learn the position, not the order.
    const random = seeded(14);
    const positions = [0, 0, 0, 0];
    const draws = 4000;
    for (let i = 0; i < draws; i += 1) {
      const star = composeQuestion(bag, 0, 1, random)
        .prompt.replace(/^この /u, ``)
        .split(` `)
        .indexOf(`＿★＿`);
      positions[star] = (positions[star] ?? 0) + 1;
    }
    for (const count of positions) {
      expect(count).toBeGreaterThan(draws / 4 - 150);
      expect(count).toBeLessThan(draws / 4 + 150);
    }
  });

  it(`reveals the sentence with the window underlined, in its own spacing`, () => {
    // WHY: the order is the lesson, so the reveal shows the whole window in
    // place — with the sentence's own spacing, not the blanks'.
    expect(composeQuestion(bag, 0, 1, seeded(15)).answered).toBe(
      `この __かばんは わたしの__ です。`
    );
  });
});

/** A passage with five blanks, numbered in reading order. */
const passage: PassageItem = {
  id: `n5-b3-0001`,
  type: `passage`,
  status: `reviewed`,
  text: `あ（1）い。か（2）き。さ（3）し。た（4）ち。な（5）に。`,
  en: `The passage in English.`,
  blanks: [1, 2, 3, 4, 5].map((n) => ({
    answer: `A${String(n)}`,
    wrong: [`W${String(n)}a`, `W${String(n)}b`, `W${String(n)}c`],
    difficulty: 1 as const,
    points: [`p`],
    note: `n`
  }))
};

describe(`a passage`, () => {
  it(`asks its blanks in reading order, numbered straight on`, () => {
    // WHY: a passage is read top to bottom. Asking blank 4 before blank 2
    // would reveal the later answer before the earlier question.
    const questions = passageQuestions(passage, 4, 14, seeded(16));
    expect(questions.map((q) => q.number)).toEqual([14, 15, 16, 17]);
    expect(questions.map((q) => q.slot).sort((a, b) => a - b)).toEqual(
      questions.map((q) => q.slot)
    );
  });

  it(`puts all its asked blanks on one card, numbered, with the rest filled`, () => {
    // WHY: found in the second live test — a passage split across four cards
    // read badly. On one card every asked blank shows its number, and a blank
    // not asked shows its answer, since nobody is asked about it.
    const four = passageQuestions(passage, 4, 14, seeded(18));
    expect(new Set(four.map((q) => q.card))).toEqual(new Set([14]));
    const unasked = [1, 2, 3, 4, 5].find(
      (slot) => !four.some((q) => q.slot === slot)
    );
    const prompt = four[0]?.prompt ?? ``;
    for (const number of [14, 15, 16, 17]) {
      expect(prompt).toContain(`［${String(number)}］`);
    }
    expect(prompt).toContain(`A${String(unasked)}`);
    expect(new Set(four.map((q) => q.prompt)).size).toBe(1);
  });

  it(`reveals the whole passage with every asked answer underlined`, () => {
    // WHY: the card is revealed as one, so its reveal is the completed
    // passage, each answer marked where it goes.
    const all = passageQuestions(passage, 5, 14, seeded(22));
    expect(all[0]?.answered).toBe(
      `あ__A1__い。か__A2__き。さ__A3__し。た__A4__ち。な__A5__に。`
    );
  });

  it(`counts the passage toward the first question's time only`, () => {
    // WHY: by the second blank the passage has been read. Giving every
    // question the full reading time would make a passage group drag.
    const long: PassageItem = {
      ...passage,
      text: `${`ながい ぶんしょうです。`.repeat(20)}あ（1）い。か（2）き。さ（3）し。た（4）ち。な（5）に。`
    };
    const [first, second] = passageQuestions(long, 4, 14, seeded(19));
    expect(first?.timeoutMs ?? 0).toBeGreaterThan(
      (second?.timeoutMs ?? 0) + 60_000
    );
  });

  it(`asks a different set of its blanks from one test to the next`, () => {
    // WHY: a passage that comes up again should not bring back the same four questions. With eight blanks there are 70 sets of four, and every blank should get its turn. One random stream across draws, as tests are drawn in play.
    const eight: PassageItem = {
      ...passage,
      text: `あ（1）い（2）う（3）え（4）お（5）か（6）き（7）く（8）け。`,
      blanks: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
        ...passage.blanks[0],
        answer: `A${String(n)}`,
        points: [`p${String(n)}`]
      }))
    };
    const random = seeded(31);
    const sets = new Set<string>();
    const asked = new Set<number>();
    for (let i = 0; i < 200; i += 1) {
      const questions = passageQuestions(eight, 4, 14, random);
      sets.add(questions.map((q) => q.slot).join(`,`));
      for (const q of questions) asked.add(q.slot);
    }
    expect(sets.size).toBeGreaterThan(40);
    expect([...asked].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it(`gives the English only after its last question`, () => {
    // WHY: the translation of the whole passage would answer the blanks
    // still to come.
    const questions = passageQuestions(passage, 4, 14, seeded(20));
    expect(questions.map((q) => q.en)).toEqual([
      ``,
      ``,
      ``,
      `The passage in English.`
    ]);
  });
});

describe(`a full grammar test`, () => {
  it(`draws 9 + 4 + 4, numbered 1 to 17, in the paper's order`, () => {
    // WHY: the blueprint is the real N5 paper. A test that drew a different
    // shape would not be practice for it.
    const items: Item[] = [
      ...deck({ 1: 5, 2: 5, 3: 5 }),
      ...[1, 2, 3, 4, 5, 6].map((n): ComposeItem => ({
        ...bag,
        id: `n5-b2-${String(n).padStart(4, `0`)}`,
        windows: [
          {
            start: 1,
            difficulty: ((n % 3) + 1) as Difficulty,
            points: [`c${String(n)}`],
            note: `n`
          }
        ]
      })),
      passage
    ];
    const questions = drawTest(`bunpou`, items, {}, seeded(21));
    expect(questions.map((q) => q.number)).toEqual(
      Array.from({ length: 17 }, (_, i) => i + 1)
    );
    expect(questions.map((q) => q.mondai)).toEqual([
      ...Array.from({ length: 9 }, () => 1),
      ...Array.from({ length: 4 }, () => 2),
      ...Array.from({ length: 4 }, () => 3)
    ]);
  });

  it(`uses one passage, once, however many the corpus holds`, () => {
    // WHY: a passage seen twice in one sitting gives its own answers away. Every 問題3 question must come from the same passage, and ask a different blank of it.
    const passages = [1, 2, 3].map((n): PassageItem => ({
      ...passage,
      id: `n5-b3-${String(n).padStart(4, `0`)}`
    }));
    const random = seeded(41);
    for (let i = 0; i < 50; i += 1) {
      const questions = drawTest(
        `bunpou`,
        [...deck({ 1: 5, 2: 5, 3: 5 }), ...passages],
        {},
        random
      ).filter((q) => q.mondai === 3);
      expect(questions).toHaveLength(4);
      expect(new Set(questions.map((q) => q.itemId)).size).toBe(1);
      expect(new Set(questions.map((q) => q.slot)).size).toBe(4);
    }
  });
});

describe(`a reading test`, () => {
  const pad = (n: number): string => String(n).padStart(4, `0`);
  const asks = (
    n: number,
    difficulties: readonly Difficulty[]
  ): ShortItem[`questions`] =>
    difficulties.map((difficulty, q) => ({
      question: `しつもん${String(n)}-${String(q)}`,
      answer: `こたえ${String(n)}-${String(q)}`,
      wrong: [`か`, `き`, `く`].map((w) => `${w}${String(n)}-${String(q)}`),
      difficulty,
      note: `n`
    }));
  const short = (n: number, difficulties: Difficulty[]): ShortItem => ({
    id: `n5-d4-${pad(n)}`,
    type: `short`,
    status: `reviewed`,
    text: `ぶんしょう${String(n)}`,
    en: `Text ${String(n)}.`,
    questions: asks(n, difficulties)
  });
  const mid = (n: number, difficulties: Difficulty[]): MidItem => ({
    ...short(n, difficulties),
    id: `n5-d5-${pad(n)}`,
    type: `mid`
  });
  const info = (n: number, difficulties: Difficulty[]): InfoItem => ({
    id: `n5-d6-${pad(n)}`,
    type: `info`,
    status: `reviewed`,
    material: {
      kind: `notice`,
      title: `おしらせ${String(n)}`,
      blocks: [{ text: [`あしたは やすみです。`] }]
    },
    en: `Notice ${String(n)}.`,
    questions: asks(n, difficulties)
  });

  /** Enough of every level in every deck for any deal of the mix. */
  const corpus: Item[] = [
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) =>
      short(n, [(((n - 1) % 3) + 1) as Difficulty])
    ),
    mid(1, [1, 2, 3, 1]),
    mid(2, [2, 2, 1, 3]),
    mid(3, [3, 1, 2, 2]),
    ...[1, 2, 3, 4, 5, 6].map((n) =>
      info(n, [(((n - 1) % 3) + 1) as Difficulty])
    )
  ];

  it(`draws 2 + 2 + 1, numbered 1 to 5, in the paper's order`, () => {
    // WHY: the real paper's reading is two short texts, one longer text with two questions, and one page to search. A student practises that shape.
    const test = drawTest(`dokkai`, corpus, {}, seeded(3));
    expect(test.map((q) => q.mondai)).toEqual([4, 4, 5, 5, 6]);
    expect(test.map((q) => q.number)).toEqual([1, 2, 3, 4, 5]);
    // Two short cards, then the long text's two questions on one card, then the page.
    expect(test.map((q) => q.card)).toEqual([1, 2, 3, 3, 5]);
    const items = test.map((q) => q.itemId);
    expect(new Set(items).size).toBe(4);
  });

  it(`asks 2 easy, 2 medium and 1 hard every test, dealt to different 問題 from test to test`, () => {
    // WHY: equal difficulty keeps scores comparable from test to test; the shuffle lets every deck's easy and hard questions come up. A fixed level per deck would never ask 問題6's easy or hard ones (the user's choice, 2026-11-22).
    const hardIn = new Set<number>();
    for (let seed = 1; seed <= 40; seed += 1) {
      // Spread out: small seeds give this generator nearly the same first draw.
      const test = drawTest(`dokkai`, corpus, {}, seeded(seed * 1_000_003));
      expect(test.map((q) => q.difficulty).sort((a, b) => a - b)).toEqual([
        1, 1, 2, 2, 3
      ]);
      const hard = test.find((q) => q.difficulty === 3);
      if (hard !== undefined) hardIn.add(hard.mondai);
    }
    expect([...hardIn].sort((a, b) => a - b)).toEqual([4, 5, 6]);
  });

  it(`asks a 問題5 text's two questions in the order the text answers them`, () => {
    // WHY: the paper asks about a long text in reading order. Asked out of order, the second question would send the student back up the text.
    for (let seed = 1; seed <= 20; seed += 1) {
      const pair = drawTest(`dokkai`, corpus, {}, seeded(seed)).filter(
        (q) => q.mondai === 5
      );
      expect(pair).toHaveLength(2);
      expect(pair[0]?.itemId).toBe(pair[1]?.itemId);
      expect(pair[0]?.slot ?? 0).toBeLessThan(pair[1]?.slot ?? 0);
    }
  });

  it(`keeps fixed-order options in the order they are written`, () => {
    // WHY: times and prices print in order on the paper. Shuffled, 9:30 could sit above 9:00, and a student would have to hunt for the time they had already worked out.
    const timed: ShortItem = {
      ...short(1, [1]),
      questions: [
        {
          question: `{何時|なんじ}ですか。`,
          options: [`9:00`, `9:30`, `10:00`, `10:30`],
          answer: 3,
          difficulty: 1,
          note: `n`
        }
      ]
    };
    for (let seed = 1; seed <= 20; seed += 1) {
      const [q] = readingQuestions(timed, [0], 1, seeded(seed));
      expect(q?.options).toEqual([`9:00`, `9:30`, `10:00`, `10:30`]);
      expect(q?.correct).toBe(2);
    }
  });

  it(`keeps each why beside its own option through the shuffle`, () => {
    // WHY: a student is told privately why the option THEY chose is wrong. A why that drifted to another option would explain the wrong mistake, confidently.
    const explained: ShortItem = {
      ...short(1, [2]),
      questions: [
        {
          question: `どう しますか。`,
          answer: `A`,
          wrong: [
            { option: `B`, why: `why B` },
            { option: `C`, why: `why C` },
            { option: `D`, why: `why D` },
            { option: `E`, why: `why E` }
          ],
          difficulty: 2,
          note: `n`
        }
      ]
    };
    for (let seed = 1; seed <= 30; seed += 1) {
      const [q] = readingQuestions(explained, [0], 1, seeded(seed));
      q?.options.forEach((option, index) => {
        expect(q.whys?.at(index)).toBe(option === `A` ? `` : `why ${option}`);
      });
    }
  });

  it(`links each 問題6 question to its own hosted picture`, () => {
    // WHY: the card shows a picture only when its question carries the URL. Another page's URL would show the wrong document under the question; no URL, when one is hosted, would show text where the student expects a picture.
    const hosted = Object.fromEntries(
      corpus
        .filter((entry) => entry.type === `info`)
        .map((entry) => [entry.id, `https://assets.example/${entry.id}.webp`])
    );
    for (let seed = 1; seed <= 10; seed += 1) {
      const page = drawTest(
        `dokkai`,
        corpus,
        {},
        seeded(seed * 1_000_003),
        hosted
      ).find((q) => q.mondai === 6);
      expect(page?.image).toBe(
        `https://assets.example/${page?.itemId ?? ``}.webp`
      );
    }
    const unhosted = drawTest(`dokkai`, corpus, {}, seeded(3)).find(
      (q) => q.mondai === 6
    );
    expect(unhosted?.image).toBeUndefined();
  });

  it(`counts a text once per card, and gives a picture a minute on top`, () => {
    // WHY: two questions on one text should not make the student "read" it twice; and a picture may need opening at full size before it can be read (the user's condition for tall pictures).
    const [first, second] = readingQuestions(
      mid(1, [1, 2, 3, 1]),
      [0, 2],
      3,
      seeded(1)
    );
    expect(second?.timeoutMs).toBe(
      timeoutFor(`mid`, second?.question ?? ``, second?.options ?? [])
    );
    expect(first?.timeoutMs).toBeGreaterThan(second?.timeoutMs ?? 0);

    const [page] = readingQuestions(info(1, [1]), [0], 5, seeded(1));
    const material = materialMarkup(info(1, [1]).material);
    expect(page?.timeoutMs).toBeGreaterThanOrEqual(
      60_000 + plain(material).length * PER_CHAR_MS
    );
  });
});

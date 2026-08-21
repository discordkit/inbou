import { describe, expect, it } from "vitest";
import { judge } from "../quiz/answer.js";
import {
  generate,
  matches,
  pose,
  type Filters,
  type Word
} from "../quiz/question.js";

const uru: Word = {
  id: `1`,
  kana: `うる`,
  kanji: `売る`,
  pos: `v5r`,
  type: `verb`,
  verbClass: `godan-r`,
  jlpt: 5,
  gloss: `to sell`
};

const taberu: Word = {
  id: `2`,
  kana: `たべる`,
  kanji: `食べる`,
  pos: `v1`,
  type: `verb`,
  verbClass: `ichidan`,
  jlpt: 5,
  gloss: `to eat`
};

const shizuka: Word = {
  id: `3`,
  kana: `しずか`,
  kanji: `静か`,
  pos: `adj-na`,
  type: `adj-na`,
  jlpt: 4,
  gloss: `quiet`
};

const anyFilters: Filters = { levels: [], types: [], classes: [], forms: [] };

describe(`pose: the two question shapes`, () => {
  it(`asks a basic form from its polite counterpart`, () => {
    // WHY: this is the prompt rule. Showing the dictionary form for a basic
    // would ask the player to convert a register they were never shown, and
    // the question would be unanswerable as posed.
    const q = pose(uru, `non-past-negative`);
    expect(q?.prompt).toBe(`うりません`);
    expect(q?.answer).toBe(`うらない`);
  });

  it(`asks every other form from the dictionary form`, () => {
    // WHY: only the four basics have a polite counterpart. A potential or a
    // te-form has to be asked from the plain form.
    expect(pose(uru, `te-form`)?.prompt).toBe(`うる`);
    expect(pose(uru, `te-form`)?.answer).toBe(`うって`);
    expect(pose(taberu, `causative-passive`)?.prompt).toBe(`たべる`);
    expect(pose(taberu, `causative-passive`)?.answer).toBe(`たべさせられる`);
  });

  it(`returns null for a form the word cannot produce`, () => {
    // WHY: な-adjectives have no passive. The caller treats null as "pick
    // again", so a filter combination that cannot be satisfied never becomes a
    // round with no correct answer.
    expect(pose(shizuka, `passive`)).toBeNull();
    expect(pose(shizuka, `provisional-eba`)).toBeNull();
  });
});

describe(`pose: writing the answer in kanji`, () => {
  it(`splices the kanji stem onto the conjugated tail`, () => {
    // WHY: the conjugator works on the reading, so it produces うらない. A
    // player typing 売らない must also be accepted, and that spelling has to be
    // constructed rather than looked up.
    expect(pose(uru, `non-past-negative`)?.answerKanji).toBe(`売らない`);
    expect(pose(taberu, `past-affirmative`)?.answerKanji).toBe(`食べた`);
    expect(pose(shizuka, `te-form`)?.answerKanji).toBe(`静かで`);
  });

  it(`produces a kanji answer the scorer actually accepts`, () => {
    // WHY: the splice is only worth anything if `judge` agrees with it. This
    // is the contract between the generator and the scorer, and a mismatch
    // would reject correct kanji answers with no error anywhere.
    for (const [word, form] of [
      [uru, `non-past-negative`],
      [taberu, `te-form`],
      [shizuka, `past-affirmative`]
    ] as const) {
      const q = pose(word, form);
      expect(q).not.toBeNull();
      const expected = {
        kana: q?.answer ?? ``,
        ...(q?.answerKanji === undefined ? {} : { kanji: q.answerKanji })
      };
      expect(judge(q?.answerKanji ?? ``, expected).correct).toBe(true);
      expect(judge(q?.answer ?? ``, expected).correct).toBe(true);
    }
  });

  it(`omits the kanji answer for a word written only in kana`, () => {
    // WHY: many words have no kanji spelling in play. Inventing one would give
    // the scorer a second accepted string that is not real Japanese.
    const kanaOnly: Word = {
      ...uru,
      kanji: undefined,
      kana: `ある`,
      pos: `v5r-i`
    };
    expect(pose(kanaOnly, `past-affirmative`)?.answerKanji).toBeUndefined();
  });
});

describe(`matches: the session filters`, () => {
  it(`filters by level, type and verb class`, () => {
    expect(matches(uru, { ...anyFilters, levels: [5] })).toBe(true);
    expect(matches(uru, { ...anyFilters, levels: [4] })).toBe(false);
    expect(matches(uru, { ...anyFilters, types: [`verb`] })).toBe(true);
    expect(matches(uru, { ...anyFilters, types: [`adj-i`] })).toBe(false);
    expect(matches(uru, { ...anyFilters, classes: [`godan-r`] })).toBe(true);
    expect(matches(uru, { ...anyFilters, classes: [`ichidan`] })).toBe(false);
  });

  it(`does not let a verb-class filter exclude adjectives`, () => {
    // WHY: an adjective has no verb class. If the class filter applied to it,
    // asking for "ichidan + adjectives" would silently yield an empty pool and
    // the session would refuse to start for no visible reason.
    expect(
      matches(shizuka, {
        ...anyFilters,
        types: [`adj-na`],
        classes: [`ichidan`]
      })
    ).toBe(true);
  });

  it(`excludes unlevelled words when a level filter is set`, () => {
    // WHY: 4,044 corpus words carry no level. A level filter that let them
    // through would put unlevelled vocabulary into an N5 session.
    const unlevelled: Word = { ...uru, jlpt: undefined };
    expect(matches(unlevelled, { ...anyFilters, levels: [5] })).toBe(false);
    expect(matches(unlevelled, anyFilters)).toBe(true);
  });
});

describe(`generate: picking from the corpus`, () => {
  const words = [uru, taberu, shizuka];

  it(`only ever poses a question the filters allow`, () => {
    // WHY: the generator is the last gate before a question reaches the
    // channel. A word slipping past the filters would show an N1 verb in an N5
    // session.
    const filters: Filters = { ...anyFilters, levels: [4], types: [`adj-na`] };
    for (let i = 0; i < 20; i += 1) {
      const q = generate(words, filters);
      expect(q?.wordId).toBe(shizuka.id);
    }
  });

  it(`respects a form filter`, () => {
    // WHY: "basics only" is a documented session option. Asking a te-form in a
    // basics-only session would be a bug the player experiences as unfairness.
    const filters: Filters = { ...anyFilters, forms: [`past-negative`] };
    for (let i = 0; i < 20; i += 1) {
      expect(generate(words, filters)?.form).toBe(`past-negative`);
    }
  });

  it(`returns null when no word passes the filters`, () => {
    // WHY: the caller reports this as a misconfigured session. Returning a
    // question anyway would ignore the filters the channel chose.
    expect(generate(words, { ...anyFilters, levels: [1] })).toBeNull();
    expect(generate([], anyFilters)).toBeNull();
  });

  it(`finds a valid question even when random attempts keep missing`, () => {
    // WHY: a narrow filter (a form only one word supports) can defeat random
    // sampling. Falling back to a scan means a valid configuration always
    // produces a question rather than failing intermittently.
    const alwaysFirst = (): number => 0;
    const filters: Filters = { ...anyFilters, forms: [`causative-passive`] };
    // shizuka is first in the list and has no causative-passive, so a
    // zero-returning random always picks the wrong word.
    const q = generate([shizuka, taberu], filters, alwaysFirst);
    expect(q?.wordId).toBe(taberu.id);
    expect(q?.answer).toBe(`たべさせられる`);
  });

  it(`is driven by the injected random source`, () => {
    // WHY: selection has to be testable. If it reached for Math.random
    // directly, none of the tests above could pin a specific outcome.
    const q = generate(words, anyFilters, () => 0);
    expect(q?.wordId).toBe(uru.id);
  });
});

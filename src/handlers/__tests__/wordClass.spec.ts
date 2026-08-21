import { describe, expect, it } from "vitest";
import { formTable } from "../quiz/forms.js";
import { classify } from "../quiz/wordClass.js";

describe(`classify: resolving JMdict POS codes to a quiz class`, () => {
  it(`prefers the verb reading of a suru-noun`, () => {
    // WHY: 勉強 is tagged `n` first, and classifying on the first code would
    // make it a noun — whose only conjugation is the copula. The drill worth
    // having is 勉強する, so verbs must win over nouns regardless of tag order.
    expect(classify([`n`, `vs`, `vt`])).toEqual({
      type: `verb`,
      verbClass: `irregular-suru`,
      pos: `vs`
    });
  });

  it(`names 行く's class separately from other godan-k verbs`, () => {
    // WHY: 行く geminates (行って) where 書く does not (書いて). Both are `k`
    // row, so a shared class would let a learner filter for godan-k and get a
    // verb that breaks the rule they are practising.
    expect(classify([`v5k-s`])?.verbClass).toBe(`godan-iku`);
    expect(classify([`v5k`])?.verbClass).toBe(`godan-k`);
  });

  it(`keeps the original POS code, not just the class`, () => {
    // WHY: the mapping is deliberately lossy — v5r and v5r-i both classify as
    // godan-r — but the conjugator needs the exact code to know that ある's
    // negative is the standalone ない. Dropping it would produce あらない.
    const aru = classify([`v5r-i`]);
    expect(aru?.verbClass).toBe(`godan-r`);
    expect(aru?.pos).toBe(`v5r-i`);
    expect(
      formTable(`ある`, [aru?.pos ?? ``])?.casual[`non-past-negative`]
    ).toBe(`ない`);
  });

  it(`classifies adjectives without a verb class`, () => {
    // WHY: `verbClass` gates the verb-class filter. A value on an adjective
    // would put 高い in a godan bucket.
    expect(classify([`adj-i`])).toEqual({ type: `adj-i`, pos: `adj-i` });
    expect(classify([`adj-na`])).toEqual({ type: `adj-na`, pos: `adj-na` });
    // いい conjugates on the よい stem, and adj-ix is how JMdict says so.
    expect(classify([`adj-ix`])).toEqual({ type: `adj-i`, pos: `adj-ix` });
  });

  it(`returns null for anything the conjugator cannot inflect`, () => {
    // WHY: this null is the filter that keeps the corpus answerable. A word
    // admitted here whose POS the conjugator rejects would become a question
    // with no correct answer, and the round could only ever time out.
    expect(classify([`n`])).toBeNull();
    expect(classify([`prt`])).toBeNull();
    expect(classify([`adv`, `n-adv`])).toBeNull();
    expect(classify([])).toBeNull();
  });

  it(`only admits codes the conjugator actually handles`, () => {
    // WHY: the guarantee the corpus depends on. Every class this returns must
    // produce a real table, or the build ships unanswerable questions.
    const probes: [string, string][] = [
      [`v1`, `食べる`],
      [`v5u`, `買う`],
      [`v5k`, `書く`],
      [`v5k-s`, `行く`],
      [`v5g`, `泳ぐ`],
      [`v5s`, `話す`],
      [`v5t`, `待つ`],
      [`v5n`, `死ぬ`],
      [`v5b`, `遊ぶ`],
      [`v5m`, `飲む`],
      [`v5r`, `売る`],
      [`vk`, `来る`],
      [`vs-i`, `する`],
      [`adj-i`, `高い`],
      [`adj-na`, `静か`]
    ];
    const failures = probes.filter(([pos, surface]) => {
      const cls = classify([pos]);
      return cls === null || formTable(surface, [cls.pos]) === null;
    });
    expect(failures).toEqual([]);
  });
});

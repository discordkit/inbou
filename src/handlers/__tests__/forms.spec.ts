import { describe, expect, it } from "vitest";
import { formTable, formsFor, isBasic } from "../quiz/forms.js";

describe(`formTable: reshaping for the quiz`, () => {
  it(`splits polarity into separately askable forms`, () => {
    // WHY: the conjugator pairs affirmative and negative in one row because it
    // renders a table. A question asks for exactly one of them, so if the
    // flattening dropped or crossed a polarity the quiz would mark a correct
    // answer wrong.
    const table = formTable(`食べる`, [`v1`]);
    expect(table?.casual[`non-past-affirmative`]).toBe(`食べる`);
    expect(table?.casual[`non-past-negative`]).toBe(`食べない`);
    expect(table?.casual[`past-affirmative`]).toBe(`食べた`);
    expect(table?.casual[`past-negative`]).toBe(`食べなかった`);
  });

  it(`keeps polite forms only for the four basics`, () => {
    // WHY: the prompt rule shows the polite form for basics and the dictionary
    // form otherwise. If a non-basic form gained a polite entry the generator
    // would show a prompt that has no business existing (there is no polite
    // imperative here), and the player would be asked to convert from a form
    // they have never seen.
    const table = formTable(`書く`, [`v5k`]);
    expect(table?.polite[`non-past-negative`]).toBe(`書きません`);
    expect(table?.polite[`past-negative`]).toBe(`書きませんでした`);
    expect(Object.keys(table?.polite ?? {}).sort()).toEqual([
      `non-past-affirmative`,
      `non-past-negative`,
      `past-affirmative`,
      `past-negative`
    ]);
  });

  it(`omits forms with no standard counterpart instead of storing empty strings`, () => {
    // WHY: the conjugator returns "" for the volitional's negative. Stored as
    // an empty string the generator could pick it and pose a question with no
    // possible answer; omitted, it cannot be chosen at all.
    const table = formTable(`食べる`, [`v1`]);
    expect(table?.casual.volitional).toBe(`食べよう`);
    expect(Object.values(table?.casual ?? {})).not.toContain(``);
  });

  it(`derives the causative-passive by conjugating the causative`, () => {
    // WHY: the conjugator has no causative-passive row. Because a causative is
    // itself an ichidan verb, its passive is a second pass — the same
    // composition the spec relies on for compound forms. If this broke, the
    // hardest single-word form would silently vanish from the question pool.
    expect(formTable(`食べる`, [`v1`])?.casual[`causative-passive`]).toBe(
      `食べさせられる`
    );
    expect(formTable(`書く`, [`v5k`])?.casual[`causative-passive`]).toBe(
      `書かせられる`
    );
    expect(formTable(`する`, [`vs-i`])?.casual[`causative-passive`]).toBe(
      `させられる`
    );
  });

  it(`carries the lexical irregulars through the reshape`, () => {
    // WHY: the conjugator handles these correctly (proven in its own tests),
    // but a reshape that read the wrong row would reintroduce the non-words.
    // These are the forms a naive rule gets wrong.
    expect(formTable(`行く`, [`v5k-s`])?.casual[`te-form`]).toBe(`行って`);
    expect(formTable(`ある`, [`v5r-i`])?.casual[`non-past-negative`]).toBe(
      `ない`
    );
    expect(formTable(`来る`, [`vk`])?.casual.imperative).toBe(`来い`);
    expect(formTable(`勉強`, [`n`, `vs`])?.casual[`non-past-affirmative`]).toBe(
      `勉強する`
    );
  });

  it(`returns null for words that do not conjugate`, () => {
    // WHY: the question generator filters on this. A non-null table for 犬
    // would put a noun in the verb pool and ask for its te-form.
    expect(formTable(`犬`, [`n`])).toBeNull();
    expect(formTable(`を`, [`prt`])).toBeNull();
  });
});

describe(`formsFor: what each word type can be asked`, () => {
  it(`offers voice and modality to verbs only`, () => {
    // WHY: there is no passive of 高い. Offering one would generate a question
    // whose answer the conjugator cannot produce, so the round would open with
    // no correct answer to accept.
    expect(formsFor(`verb`)).toContain(`passive`);
    expect(formsFor(`verb`)).toContain(`potential`);
    expect(formsFor(`adj-i`)).not.toContain(`passive`);
    expect(formsFor(`adj-na`)).not.toContain(`potential`);
    expect(formsFor(`noun`)).not.toContain(`causative-passive`);
  });

  it(`gives each word type its own conditionals`, () => {
    // WHY: な-adjectives take なら where verbs and い-adjectives take 〜たら and
    // 〜ば. The conjugator emits なら as a single unqualified `Conditional` row,
    // so promising な-adjectives a 〜ば form asks for one that cannot be built —
    // caught by the corpus test as 静か "missing provisional-eba".
    expect(formsFor(`verb`)).toContain(`conditional-tara`);
    expect(formsFor(`verb`)).toContain(`provisional-eba`);
    expect(formsFor(`verb`)).not.toContain(`conditional-nara`);

    expect(formsFor(`adj-i`)).toContain(`provisional-eba`);
    expect(formsFor(`adj-i`)).not.toContain(`conditional-nara`);

    expect(formsFor(`adj-na`)).toContain(`conditional-nara`);
    expect(formsFor(`adj-na`)).not.toContain(`provisional-eba`);
    expect(formsFor(`adj-na`)).not.toContain(`conditional-tara`);

    // And the form it promises is one the conjugator actually produces.
    expect(formTable(`静か`, [`adj-na`])?.casual[`conditional-nara`]).toBe(
      `静かなら`
    );
  });

  it(`gives every word type the tense and polarity basics`, () => {
    for (const type of [`verb`, `adj-i`, `adj-na`, `noun`] as const) {
      expect(formsFor(type)).toContain(`non-past-negative`);
      expect(formsFor(type)).toContain(`past-negative`);
    }
  });
});

describe(`isBasic: which forms are asked from the polite register`, () => {
  it(`marks exactly the four tense-polarity forms`, () => {
    // WHY: this predicate decides the question's shape. Getting it wrong would
    // show a dictionary form and ask for a register conversion, or vice versa
    // — a question the player cannot interpret.
    expect(isBasic(`non-past-affirmative`)).toBe(true);
    expect(isBasic(`past-negative`)).toBe(true);
    expect(isBasic(`te-form`)).toBe(false);
    expect(isBasic(`causative-passive`)).toBe(false);
  });
});

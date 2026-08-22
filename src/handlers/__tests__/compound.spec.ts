import { describe, expect, it } from "vitest";
import { buildCompound, COMPOUNDS } from "../quiz/compound.js";
import { DEFAULT_SETTINGS, isSettings, parseSettings } from "../quiz/config.js";
import { generate, isQuestion, type Word } from "../quiz/question.js";

/**
 * The multi-word constructions, checked against real Japanese.
 *
 * These are the questions N3 and above are made of, so a wrong one teaches a
 * learner something false — the worst failure this project has. Each case names
 * the verb class it covers, because the euphonic changes differ by class and
 * that is exactly where a hand-rolled implementation would go wrong.
 */

describe(`〜てしまう and 〜ておく: built on the te-form`, () => {
  // WHY: the te-form is where godan verbs change sound by consonant row —
  // 飲む gives 飲んで, not 飲みて. Composing on the conjugator's own row is what
  // keeps that right without this module knowing the rules.
  it.each([
    [`食べる`, `v1`, `食べてしまう`],
    [`飲む`, `v5m`, `飲んでしまう`],
    [`書く`, `v5k`, `書いてしまう`],
    [`話す`, `v5s`, `話してしまう`],
    [`待つ`, `v5t`, `待ってしまう`],
    [`行く`, `v5k-s`, `行ってしまう`],
    [`する`, `vs-i`, `してしまう`],
    [`来る`, `vk`, `来てしまう`]
  ])(`%s → %s`, (word, pos, expected) => {
    expect(buildCompound(word, [pos], `do-completely`)).toBe(expected);
  });

  it(`appends おく to the same stem`, () => {
    expect(buildCompound(`買う`, [`v5u`], `do-in-advance`)).toBe(`買っておく`);
    expect(buildCompound(`読む`, [`v5m`], `do-in-advance`)).toBe(`読んでおく`);
  });
});

describe(`〜なければならない: must do`, () => {
  // WHY: built on the negative provisional, which already carries なければ. A
  // naive "stem + なければならない" would produce 食べなければならない for
  // ichidan but 飲まなければならない requires the negative stem 飲ま-, not 飲み-.
  it.each([
    [`食べる`, `v1`, `食べなければならない`],
    [`飲む`, `v5m`, `飲まなければならない`],
    [`行く`, `v5k-s`, `行かなければならない`],
    [`する`, `vs-i`, `しなければならない`]
  ])(`%s → %s`, (word, pos, expected) => {
    expect(buildCompound(word, [pos], `must-do`)).toBe(expected);
  });
});

describe(`〜たくない: do not want to`, () => {
  // WHY: 〜たい inflects as an い-adjective, so the negative is 〜たくない and
  // never 〜たいない. Reading the conjugator's own たい row keeps that fact in
  // one place.
  it.each([
    [`食べる`, `v1`, `食べたくない`],
    [`飲む`, `v5m`, `飲みたくない`],
    [`する`, `vs-i`, `したくない`],
    [`行く`, `v5k-s`, `行きたくない`]
  ])(`%s → %s`, (word, pos, expected) => {
    expect(buildCompound(word, [pos], `do-not-want-to`)).toBe(expected);
  });
});

describe(`〜させられる: be made to do`, () => {
  // WHY: two conjugations deep — causative, then the passive of that. The
  // causative always ends in る and behaves as ichidan whatever the original
  // class, which is the fact that makes the second step safe.
  it.each([
    [`食べる`, `v1`, `食べさせられる`],
    [`飲む`, `v5m`, `飲ませられる`],
    [`する`, `vs-i`, `させられる`],
    [`来る`, `vk`, `来させられる`]
  ])(`%s → %s`, (word, pos, expected) => {
    expect(buildCompound(word, [pos], `be-made-to`)).toBe(expected);
  });
});

describe(`words that cannot form a construction`, () => {
  it(`returns null rather than a partial answer`, () => {
    // WHY: a compound the conjugator cannot produce is a question with no
    // correct answer. Asking it would mark every player wrong.
    for (const compound of COMPOUNDS) {
      expect(buildCompound(`ねこ`, [`n`], compound)).toBeNull();
    }
  });
});

describe(`asking a construction as a question`, () => {
  const taberu: Word = {
    id: `1`,
    kana: `たべる`,
    kanji: `食べる`,
    pos: `v1`,
    type: `verb`,
    verbClass: `ichidan`,
    jlpt: 5,
    gloss: `to eat`
  };

  it(`produces a question whose answer is the construction`, () => {
    // WHY: the compound has to arrive as an ordinary Question or nothing
    // downstream works — the scorer, the session and the embeds all take one
    // shape, and a second shape would need every one of them changed.
    const question = generate([taberu], {
      levels: [],
      types: [],
      classes: [],
      forms: [`do-completely`]
    });

    expect(isQuestion(question)).toBe(true);
    if (!isQuestion(question)) return;
    expect(question.answer).toBe(`たべてしまう`);
    expect(question.answerKanji).toBe(`食べてしまう`);
    // Asked from the dictionary form: there is no register to convert.
    expect(question.prompt).toBe(`たべる`);
  });

  it(`never asks a construction unless it was requested`, () => {
    // WHY: constructions are N3+ material. An N5 session must not start
    // producing 〜させられる because the word happened to support it — the
    // default filter is `basics`, and `all` means all inflections.
    const asked = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      const question = generate(
        [taberu],
        { levels: [], types: [], classes: [], forms: [] },
        () => i / 40
      );
      if (isQuestion(question)) asked.add(question.form);
    }

    for (const compound of COMPOUNDS) {
      expect(asked.has(compound)).toBe(false);
    }
  });

  it(`accepts \`compounds\` as a forms option`, () => {
    // WHY: naming five constructions individually is not something anyone will
    // type. The shorthand is how a session actually gets configured for them.
    const settings = parseSettings({ forms: `compounds` }, DEFAULT_SETTINGS);

    expect(isSettings(settings)).toBe(true);
    if (!isSettings(settings)) return;
    expect(settings.filters.forms).toEqual([...COMPOUNDS]);
  });

  it(`accepts one construction by name`, () => {
    const settings = parseSettings({ forms: `must-do` }, DEFAULT_SETTINGS);

    expect(isSettings(settings)).toBe(true);
    if (!isSettings(settings)) return;
    expect(settings.filters.forms).toEqual([`must-do`]);
  });
});

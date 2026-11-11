import { describe, expect, it } from "vite-plus/test";
import {
  BLANK,
  display,
  fill,
  itemHints,
  itemProblems,
  corpusProblems,
  parse,
  plain,
  type FormItem
} from "../items.js";

/**
 * The item gate: markup, and the mechanical checks every item must pass.
 *
 * Code cannot tell whether a wrong option is really wrong — a reviewer does
 * that — so these checks are about everything else that would reach a channel
 * broken: a blank with no answer, a kanji with no reading, a distractor that
 * is the answer.
 */

const POINTS = new Set([`particle-de-means`, `particle-mo-also`]);

const item = (overrides: Partial<FormItem> = {}): FormItem => ({
  id: `n5-b1-0001`,
  type: `form`,
  status: `draft`,
  sentence: `{毎日|まいにち} バス（1） {学校|がっこう}へ {行|い}きます。`,
  en: `I go to school by bus every day.`,
  slots: [
    {
      answer: `で`,
      wrong: [`を`, `が`, `と`],
      difficulty: 1,
      points: [`particle-de-means`],
      note: `で marks the means.`
    }
  ],
  ...overrides
});

describe(`markup`, () => {
  it(`shows every kanji with its reading after it`, () => {
    // WHY: the paper prints furigana on every kanji and Discord cannot. A
    // kanji shown without its reading tests kanji, not grammar.
    expect(display(`{毎日|まいにち} バス`)).toBe(`毎日(まいにち) バス`);
  });

  it(`shows a blank as the paper's blank, not as its slot number`, () => {
    // WHY: the slot number is our bookkeeping. "（1）" in the channel would
    // read as part of the sentence.
    expect(display(`バス（1） {学校|がっこう}`)).toBe(
      `バス${BLANK} 学校(がっこう)`
    );
  });

  it(`fills the other blanks, and both blanks of a pair in order`, () => {
    // WHY: a pair item (は／は) covers two blanks with one answer. Filling
    // both with the whole "は／は" would print the slash into the sentence.
    expect(fill(`A（1） B（1）、C（2）`, new Map([[1, `も／も`]]))).toBe(
      `Aも Bも、C（2）`
    );
  });

  it(`leaves readings and blanks out of the reading-time count`, () => {
    // WHY: the timer grows with what a player reads. Counting the inline
    // readings would give kanji-heavy questions time for text nobody reads.
    expect(plain(`{毎日|まいにち}（1）です`)).toBe(`毎日です`);
  });

  it(`parses ruby, blanks and text in order`, () => {
    expect(parse(`{本|ほん}（2）だ`)).toEqual([
      { kind: `ruby`, base: `本`, reading: `ほん` },
      { kind: `blank`, slot: 2 },
      { kind: `text`, text: `だ` }
    ]);
  });
});

describe(`the scoping hint`, () => {
  const withOptions = (answer: string, wrong: string[]): FormItem =>
    item({
      slots: [
        {
          answer,
          wrong,
          difficulty: 1,
          points: [`particle-de-means`],
          note: `n`
        }
      ]
    });

  it(`points out an ending every option shares`, () => {
    // WHY: four options all ending in です make the student read です four
    // times, and lengthen the timer for nothing. It belongs in the sentence.
    expect(
      itemHints(
        withOptions(`むずかしくなかったです`, [
          `むずかしかったです`,
          `むずかしいです`,
          `むずかしくないです`
        ])
      )
    ).toEqual([
      `n5-b1-0001 slot 1: every option ends in "です"; move it into the sentence unless it is part of what varies`
    ]);
  });

  it(`stays quiet when the endings are what varies`, () => {
    // WHY: です, でした and ですか differ in exactly the part being tested.
    // A hint there would teach reviewers to ignore the hint.
    expect(itemHints(withOptions(`です`, [`でした`, `ですか`, `だ`]))).toEqual(
      []
    );
    expect(
      itemHints(withOptions(`も／も`, [`は／は`, `に／に`, `を／を`]))
    ).toEqual([]);
  });
});

describe(`the item checks`, () => {
  it(`passes a well-formed item`, () => {
    expect(itemProblems(item(), POINTS)).toEqual([]);
  });

  it(`catches a kanji with no reading`, () => {
    // WHY: Discord has no furigana, so the reading is the only help a
    // student gets. One missed kanji is invisible until someone cannot read it.
    const problems = itemProblems(
      item({ sentence: `毎日 バス（1） 学校へ 行きます。` }),
      POINTS
    );
    expect(problems.some((p) => p.includes(`kanji 毎 has no reading`))).toBe(
      true
    );
  });

  it(`catches a kanji the paper would not use, even with a reading`, () => {
    // WHY: the paper writes harder words in kana. 曖 is far beyond N4.
    const problems = itemProblems(
      item({ sentence: `{曖昧|あいまい}な バス（1） {行|い}きます。` }),
      POINTS
    );
    expect(problems.some((p) => p.includes(`kanji 曖 is above N4`))).toBe(true);
  });

  it(`allows the N4 kanji the official sample uses`, () => {
    // WHY: the sample writes 私, 家 and 朝 in kanji. Rejecting them would make
    // our items less like the paper, not more.
    expect(
      itemProblems(
        item({
          sentence: `{私|わたし}は {毎朝|まいあさ} {家|いえ}（1） {出|で}ます。`
        }),
        POINTS
      )
    ).toEqual([]);
  });

  it(`catches the answer hiding in the wrong pool`, () => {
    // WHY: two buttons with the right answer, one scored wrong.
    const problems = itemProblems(
      item({
        slots: [
          {
            answer: `で`,
            wrong: [`で`, `を`, `が`],
            difficulty: 1,
            points: [`particle-de-means`],
            note: `n`
          }
        ]
      }),
      POINTS
    );
    expect(problems).toContain(
      `n5-b1-0001 slot 1: the answer is also in the wrong pool`
    );
  });

  it(`catches a slot that never appears in the sentence`, () => {
    // WHY: a question whose blank is missing has nothing to answer.
    const problems = itemProblems(
      item({ sentence: `{毎日|まいにち} バスで {行|い}きます。` }),
      POINTS
    );
    expect(problems).toContain(`n5-b1-0001 slot 1: no （1） in the text`);
  });

  it(`catches a pair answer whose shape does not match its blanks`, () => {
    // WHY: も／も fills two blanks. Offered against one blank, the second
    // half has nowhere to go and the reveal prints half an answer.
    const problems = itemProblems(
      item({
        sentence: `{日曜日|にちようび}（1） {休|やす}みです。`,
        slots: [
          {
            answer: `も／も`,
            wrong: [`は／は`, `に／に`, `を／を`],
            difficulty: 3,
            points: [`particle-mo-also`],
            note: `n`
          }
        ]
      }),
      POINTS
    );
    expect(problems).toContain(
      `n5-b1-0001 slot 1: 1 blanks but the answer has 2 parts`
    );
  });

  it(`catches a grammar point that is not in the list`, () => {
    // WHY: statistics and coverage group by point. A typo would make a
    // point look untested while its items sit under a name nobody reads.
    const problems = itemProblems(
      item({
        slots: [
          {
            answer: `で`,
            wrong: [`を`, `が`, `と`],
            difficulty: 1,
            points: [`particle-de-mean`],
            note: `n`
          }
        ]
      }),
      POINTS
    );
    expect(problems.some((p) => p.includes(`"particle-de-mean"`))).toBe(true);
  });

  it(`catches an id used twice`, () => {
    // WHY: results and statistics refer to items by id. Two items under one
    // id would merge their statistics silently.
    expect(corpusProblems([item(), item()])).toEqual([
      `n5-b1-0001: id used twice`
    ]);
  });
});

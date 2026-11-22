import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";
import {
  BLANK,
  chunksOf,
  display,
  fill,
  grammarPointSchema,
  joinChunks,
  itemHints,
  itemProblems,
  corpusProblems,
  materialMarkup,
  parse,
  plain,
  type ComposeItem,
  type FormItem,
  type InfoItem,
  type PassageItem,
  type ShortItem
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

describe(`★ items`, () => {
  const compose = (overrides: Partial<ComposeItem> = {}): ComposeItem => ({
    id: `n5-b2-0001`,
    type: `compose`,
    status: `draft`,
    sentence: `この / かばん/は / わたし/の / です。`,
    en: `This bag is mine.`,
    windows: [
      { start: 1, difficulty: 1, points: [`particle-de-means`], note: `n` }
    ],
    ...overrides
  });

  it(`keeps the spacing written around each slash`, () => {
    // WHY: the reveal shows the sentence as the paper spaces it. Spaces
    // around a / are the only record of where a phrase ends.
    const chunks = chunksOf(`この / かばん/は / わたし/の / です。`);
    expect(chunks.map((chunk) => chunk.text)).toEqual([
      `この`,
      `かばん`,
      `は`,
      `わたし`,
      `の`,
      `です。`
    ]);
    expect(joinChunks(chunks)).toBe(`この かばんは わたしの です。`);
  });

  it(`passes a well-formed window`, () => {
    expect(itemProblems(compose(), POINTS)).toEqual([]);
  });

  it(`catches a window that ends the sentence`, () => {
    // WHY: the last chunk carries the 。, so it would give its own place away.
    const problems = itemProblems(
      compose({
        windows: [
          { start: 2, difficulty: 1, points: [`particle-de-means`], note: `n` }
        ]
      }),
      POINTS
    );
    expect(problems.some((p) => p.includes(`ends the sentence`))).toBe(true);
  });

  it(`catches a window that runs past the end`, () => {
    const problems = itemProblems(
      compose({
        windows: [
          { start: 4, difficulty: 1, points: [`particle-de-means`], note: `n` }
        ]
      }),
      POINTS
    );
    expect(problems.some((p) => p.includes(`runs past the end`))).toBe(true);
  });

  it(`catches two identical chunks in one window`, () => {
    // WHY: two の would make two orders look the same, and which の is "the"
    // ★ answer would be a coin toss.
    const problems = itemProblems(
      compose({ sentence: `わたし/の / ともだち/の / ほん/は / これです。` }),
      POINTS
    );
    expect(
      problems.some((p) => p.includes(`two of its chunks are the same`))
    ).toBe(true);
  });
});

describe(`passage items`, () => {
  it(`checks the intro's kanji as well as the passage's`, () => {
    // WHY: the intro is shown above the passage. A kanji there without a
    // reading is as unreadable as one in the passage.
    const passage: PassageItem = {
      id: `n5-b3-0001`,
      type: `passage`,
      status: `draft`,
      intro: `先生に メールを 書きました。`,
      text: `あ（1）い（2）う（3）え（4）お。`,
      en: `English.`,
      blanks: [1, 2, 3, 4].map(() => ({
        answer: `で`,
        wrong: [`を`, `が`, `と`],
        difficulty: 1 as const,
        points: [`particle-de-means`],
        note: `n`
      }))
    };
    const problems = itemProblems(passage, POINTS);
    expect(
      problems.some((p) => p.includes(`intro: kanji 先 has no reading`))
    ).toBe(true);
  });

  /** Four blanks, each on its own point, with words between them. */
  const passage = (text: string, points: string[]): PassageItem => ({
    id: `n5-b3-0001`,
    type: `passage`,
    status: `draft`,
    text,
    en: `English.`,
    blanks: points.map((point) => ({
      answer: `で`,
      wrong: [`を`, `が`, `と`],
      difficulty: 1 as const,
      points: [point],
      note: `n`
    }))
  });
  const FOUR = [
    `particle-de-means`,
    `particle-de-place`,
    `particle-ni-time`,
    `particle-o-object`
  ];

  it(`passes blanks that each stand alone`, () => {
    expect(
      itemProblems(
        passage(`あ（1）い（2）う（3）え（4）お。`, FOUR),
        new Set(FOUR)
      )
    ).toEqual([]);
  });

  it(`catches two blanks that test the same point`, () => {
    // WHY: a test asks any four blanks and shows the rest filled. Two on one point would test it twice on one card, or a filled one would give the asked one away.
    const same = [...FOUR.slice(0, 3), `particle-de-means`];
    expect(
      itemProblems(
        passage(`あ（1）い（2）う（3）え（4）お。`, same),
        new Set(FOUR)
      )
    ).toEqual([
      `n5-b3-0001: blanks （1） and （4） both test particle-de-means`
    ]);
  });

  it(`catches two blanks with only punctuation between them`, () => {
    // WHY: two gaps side by side read as one, and whichever is shown filled decides what the other can be.
    expect(
      itemProblems(
        passage(`あ（1）い（2）、（3）え（4）お。`, FOUR),
        new Set(FOUR)
      )
    ).toEqual([`n5-b3-0001: blanks （2） and （3） sit side by side`]);
  });
});

describe(`reading items`, () => {
  const short = (overrides: Partial<ShortItem> = {}): ShortItem => ({
    id: `n5-d4-0001`,
    type: `short`,
    status: `draft`,
    text: `{今日|きょう}は 6{時|じ}に {帰|かえ}ります。`,
    en: `I will be home at six today.`,
    questions: [
      {
        question: `{何時|なんじ}に {帰|かえ}りますか。`,
        options: [`5{時|じ}`, `6{時|じ}`, `7{時|じ}`, `8{時|じ}`],
        answer: 2,
        difficulty: 1,
        note: `6{時|じ}に {帰|かえ}ります.`
      }
    ],
    ...overrides
  });

  const info = (blocks: InfoItem[`material`][`blocks`]): InfoItem => ({
    id: `n5-d6-0001`,
    type: `info`,
    status: `draft`,
    material: { title: `バスの {時間|じかん}`, blocks },
    en: `Bus times.`,
    questions: [
      {
        question: `{何時|なんじ}の バスに {乗|の}りますか。`,
        answer: `8:10`,
        wrong: [`7:40`, `8:40`, `9:10`],
        difficulty: 2,
        note: `n`
      }
    ]
  });

  const asked = (
    answer: string,
    wrong: string[]
  ): ShortItem[`questions`][number] => ({
    question: `どう しますか。`,
    answer,
    wrong,
    difficulty: 1,
    note: `n`
  });

  it(`passes a well-formed text and a well-formed picture`, () => {
    expect(itemProblems(short(), POINTS)).toEqual([]);
    expect(
      itemProblems(
        info([
          {
            table: {
              head: [`{駅|えき}`, `{大学|だいがく}`],
              rows: [[`8:10`, `8:35`]]
            }
          }
        ]),
        POINTS
      )
    ).toEqual([]);
  });

  it(`catches a bracketed number in reading text`, () => {
    // WHY: to the parser, （1） is a blank. A notice that numbers its points that way would show the paper's empty blank in the middle of the text.
    expect(
      itemProblems(short({ text: `（1） {本|ほん}を {読|よ}みます。` }), POINTS)
    ).toEqual([
      `n5-d4-0001: reading text has no （n） blanks; write the number another way`
    ]);
  });

  it(`catches the answer hiding in a question's wrong pool`, () => {
    // WHY: two options would both be the answer, and the one marked right would be chosen by the draw, not by the text.
    expect(
      itemProblems(
        short({
          questions: [
            asked(`バスで`, [`バスで`, `{電車|でんしゃ}で`, `あるいて`])
          ]
        }),
        POINTS
      )
    ).toEqual([`n5-d4-0001 question 1: the answer is also in the wrong pool`]);
  });

  it(`catches two ordered options that are the same`, () => {
    // WHY: a student who found the right time could not tell which of two identical buttons the bot counts as right.
    expect(
      itemProblems(
        short({
          questions: [
            {
              question: `{何時|なんじ}に {帰|かえ}りますか。`,
              options: [`5{時|じ}`, `6{時|じ}`, `6{時|じ}`, `8{時|じ}`],
              answer: 2,
              difficulty: 1,
              note: `n`
            }
          ]
        }),
        POINTS
      )
    ).toEqual([`n5-d4-0001 question 1: two options are the same`]);
  });

  it(`catches a table row that does not fill its head`, () => {
    // WHY: the picture would put a value under the wrong heading, and the student would read a wrong time from it.
    expect(
      itemProblems(
        info([
          {
            table: { head: [`{駅|えき}`, `{大学|だいがく}`], rows: [[`8:10`]] }
          }
        ]),
        POINTS
      )
    ).toEqual([`n5-d6-0001 block 1 row 1: 1 cells, but the head has 2`]);
  });

  it(`checks the kanji in a picture as well as in the text`, () => {
    // WHY: the picture is read like the text, and its readings line comes from the same markup. A kanji with no reading, or one above N4, would be just as unreadable there.
    expect(
      itemProblems(
        info([
          {
            lists: [
              { head: `ゆうびん`, rows: [[`{切手|きって}`, `{郵|ゆう}`]] }
            ]
          }
        ]),
        POINTS
      )
    ).toEqual([
      `n5-d6-0001 block 1: kanji 郵 is above N4; write the word in kana`
    ]);
  });

  it(`writes out every line of the picture for its alt text`, () => {
    // WHY: a student who cannot see the picture reads this instead, and the line left out could be the one that holds the answer. Empty corner cells add nothing to read.
    expect(
      materialMarkup({
        title: `みどり {図書館|としょかん}`,
        blocks: [
          {
            table: {
              head: [``, `{時間|じかん}`],
              rows: [[`{月|げつ}`, `やすみ`]]
            }
          },
          {
            lists: [
              { head: `{飲|の}みもの`, rows: [[`ミルク`, `150{円|えん}`]] }
            ]
          },
          { text: [`5さつまで {借|か}りられます。`] }
        ]
      })
    ).toBe(
      [
        `みどり {図書館|としょかん}`,
        `{時間|じかん}`,
        `{月|げつ} やすみ`,
        `{飲|の}みもの`,
        `ミルク 150{円|えん}`,
        `5さつまで {借|か}りられます。`
      ].join(`\n`)
    );
  });

  it(`points out whole words every reading option shares`, () => {
    // WHY: バスで 行きます。 and あるいて 行きます。 make the student read 行きます four times. It belongs in the question: 何で 行きますか。
    expect(
      itemHints(
        short({
          questions: [
            asked(`バスで {行|い}きます。`, [
              `{電車|でんしゃ}で {行|い}きます。`,
              `あるいて {行|い}きます。`,
              `タクシーで {行|い}きます。`
            ])
          ]
        })
      )
    ).toEqual([
      `n5-d4-0001 question 1: every option ends in "行きます。"; move it into the sentence unless it is part of what varies`
    ]);
  });

  it(`stays quiet about a shared ます。, which cannot move`, () => {
    // WHY: nearly every reading option is a short sentence ending in ます。 A hint on each would teach reviewers to ignore the hint.
    expect(
      itemHints(
        short({
          questions: [
            asked(`{食|た}べます。`, [
              `{飲|の}みます。`,
              `{読|よ}みます。`,
              `{書|か}きます。`
            ])
          ]
        })
      )
    ).toEqual([]);
  });
});

describe(`the schemas`, () => {
  it(`reject a key they do not know`, () => {
    // WHY: YAML ends an unquoted flow value at a comma, so
    // \`meaning: so, therefore\` stores "so" and a stray key. Twelve meanings
    // were cut short that way, silently, while the schema dropped the stray.
    const parsed = v.safeParse(grammarPointSchema, {
      id: `conjunction-dakara`,
      pattern: `だから`,
      meaning: `so`,
      therefore: null
    });
    expect(parsed.success).toBe(false);
  });
});

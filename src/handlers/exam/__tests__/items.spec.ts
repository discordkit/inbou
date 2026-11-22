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
  reviewLinksOf,
  wordHints,
  wordProblems,
  type ComposeItem,
  type ContextItem,
  type FormItem,
  type InfoItem,
  type KanjiItem,
  type Material,
  type Option,
  type ParaphraseItem,
  type PassageItem,
  type Sheet,
  type ShortItem,
  type SpellingItem,
  type VocabList
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

  const infoOf = (material: Material): InfoItem => ({
    id: `n5-d6-0001`,
    type: `info`,
    status: `draft`,
    material,
    en: `Bus times.`,
    questions: [
      {
        question: `{何時|なんじ}の バスに {乗|の}りますか。`,
        answer: `8:10`,
        wrong: [
          { option: `7:40`, why: `too early` },
          { option: `8:40`, why: `too late` },
          { option: `9:10`, why: `much too late` }
        ],
        difficulty: 2,
        note: `n`
      }
    ]
  });

  const info = (blocks: Sheet[`blocks`]): InfoItem =>
    infoOf({ kind: `notice`, title: `バスの {時間|じかん}`, blocks });

  type Receipt = Extract<Material, { kind: `receipt` }>;
  const till = (overrides: Partial<Receipt> = {}): Receipt => ({
    kind: `receipt`,
    store: `コンビニ`,
    items: [
      { name: `おにぎり`, price: 150 },
      { name: `お{茶|ちゃ}`, price: 130 }
    ],
    total: { label: `{合計|ごうけい}`, amount: 280 },
    paid: { label: `おあずかり`, amount: 300 },
    change: { label: `おつり`, amount: 20 },
    ...overrides
  });

  const asked = (
    answer: string,
    wrong: Option[]
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

  it(`asks a medium or hard question to say why each wrong option is wrong`, () => {
    // WHY: reading is comprehension, not a grammar point. A student who chose a wrong option at medium or hard needs to see what in the text rules it out; an easy question's note, which says what was asked, is enough.
    const explained = (difficulty: 1 | 2 | 3): ShortItem =>
      short({
        questions: [
          {
            ...asked(`バスで`, [
              { option: `{電車|でんしゃ}で`, why: `no train` },
              `あるいて`,
              { option: `タクシーで`, why: `no taxi` }
            ]),
            difficulty
          }
        ]
      });
    expect(itemProblems(explained(1), POINTS)).toEqual([]);
    for (const difficulty of [2, 3] as const) {
      expect(itemProblems(explained(difficulty), POINTS)).toEqual([
        `n5-d4-0001 question 1: a medium or hard question says why each wrong option is wrong; "あるいて" has no why`
      ]);
    }
  });

  it(`asks for the whys of an ordered question's wrong options, never its answer's`, () => {
    // WHY: an ordered question keeps all four options in one list, so the answer sits among them. A why on the answer would tell the student the right option is wrong.
    const ordered = (options: Option[]): ShortItem =>
      short({
        questions: [
          {
            question: `{何時|なんじ}に {帰|かえ}りますか。`,
            options,
            answer: 2,
            difficulty: 2,
            note: `n`
          }
        ]
      });
    expect(
      itemProblems(
        ordered([
          { option: `5{時|じ}`, why: `early` },
          `6{時|じ}`,
          { option: `7{時|じ}`, why: `late` },
          { option: `8{時|じ}`, why: `later` }
        ]),
        POINTS
      )
    ).toEqual([]);
    expect(
      itemProblems(
        ordered([
          { option: `5{時|じ}`, why: `early` },
          { option: `6{時|じ}`, why: `right` },
          `7{時|じ}`,
          { option: `8{時|じ}`, why: `later` }
        ]),
        POINTS
      )
    ).toEqual([
      `n5-d4-0001 question 1: the answer has a why, as if it were wrong`,
      `n5-d4-0001 question 1: a medium or hard question says why each wrong option is wrong; "7{時|じ}" has no why`
    ]);
  });

  it(`catches a reading question's grammar point that is not in the list`, () => {
    // WHY: the reveal links a point's review page by its id. An id that is not in the list links nothing, and the student loses the one pointer to what decided the question.
    expect(
      itemProblems(
        short({
          questions: [
            {
              ...asked(`バスで`, [
                `あるいて`,
                `{電車|でんしゃ}で`,
                `タクシーで`
              ]),
              points: [`particle-made-ni`]
            }
          ]
        }),
        POINTS
      )
    ).toEqual([
      `n5-d4-0001 question 1: grammar point "particle-made-ni" is not in the list`
    ]);
  });

  it(`links the review page of a point a reading question names`, () => {
    // WHY: corpus.json carries only the links of points in use. A reading question's point left out of that count would reach the reveal with no page to link.
    const point = {
      id: `particle-de-means`,
      pattern: `で`,
      meaning: `by`,
      tofugu: `particle-de`
    };
    const item = short({
      questions: [
        {
          ...asked(`バスで`, [`あるいて`, `{電車|でんしゃ}で`, `タクシーで`]),
          points: [`particle-de-means`]
        }
      ]
    });
    expect(Object.keys(reviewLinksOf([point], [item]))).toEqual([
      `particle-de-means`
    ]);
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
      `n5-d6-0001 blocks 1 lists 1 rows 1 2: kanji 郵 is above N4; write the word in kana`
    ]);
  });

  it(`checks the kanji in every panel line`, () => {
    // WHY: on a route chart the fare and the time sit in a panel's lines, and the question turns on them. A kanji there that the student cannot read hides the answer.
    expect(
      itemProblems(
        info([
          {
            panels: [
              { head: `① バス`, lines: [`30{分|ぷん}`] },
              {
                head: `② {電車|でんしゃ}`,
                lines: [`{郵|ゆう}びんきょくの まえ`]
              }
            ]
          }
        ]),
        POINTS
      )
    ).toEqual([
      `n5-d6-0001 blocks 1 panels 2 lines 1: kanji 郵 is above N4; write the word in kana`
    ]);
  });

  it(`checks the kanji in every field of a document, not only in sheets`, () => {
    // WHY: a receipt, a timetable or a chat has its own fields, and new kinds will add more. The check walks every string, so a field nobody listed is still read for kanji the student cannot read.
    expect(
      itemProblems(
        infoOf(
          till({
            items: [
              { name: `{郵|ゆう}びん`, price: 150 },
              { name: `お{茶|ちゃ}`, price: 130 }
            ]
          })
        ),
        POINTS
      )
    ).toEqual([
      `n5-d6-0001 items 1 name: kanji 郵 is above N4; write the word in kana`
    ]);
  });

  it(`catches a receipt whose sums do not add up`, () => {
    // WHY: a question asks how much was paid or what change came back. A till never prints wrong sums, so a picture that does teaches the student to distrust a right answer.
    expect(itemProblems(infoOf(till()), POINTS)).toEqual([]);
    expect(
      itemProblems(
        infoOf(
          till({
            total: { label: `{合計|ごうけい}`, amount: 300 },
            change: { label: `おつり`, amount: 50 }
          })
        ),
        POINTS
      )
    ).toEqual([
      `n5-d6-0001: the items add up to ¥280, but the total says ¥300`,
      `n5-d6-0001: ¥300 paid for ¥300 leaves ¥0, but the change says ¥50`
    ]);
  });

  it(`catches a timetable hour that does not fill its columns`, () => {
    // WHY: the minutes would slide under the wrong kind of day, and a student would take a Saturday bus that only runs on weekdays.
    expect(
      itemProblems(
        infoOf({
          kind: `stop-timetable`,
          mode: `bus`,
          stop: `{駅前|えきまえ}`,
          bound: `{大学|だいがく}ゆき`,
          columns: [`{月|げつ}〜{金|きん}`, `{土|ど}・{日|にち}`],
          rows: [{ hour: 8, minutes: [[`10`, `40`]] }]
        }),
        POINTS
      )
    ).toEqual([
      `n5-d6-0001 hour 8: 1 lists of minutes, but there are 2 columns`
    ]);
  });

  it(`catches a calendar colour the legend does not explain`, () => {
    // WHY: the colour is the only thing that says what a marked day is for. Without its legend entry the student would have to guess, and the paper never makes them guess.
    expect(
      itemProblems(
        infoOf({
          kind: `calendar`,
          title: `2{月|がつ}`,
          week: [
            `{日|にち}`,
            `{月|げつ}`,
            `{火|か}`,
            `{水|すい}`,
            `{木|もく}`,
            `{金|きん}`,
            `{土|ど}`
          ],
          first: 0,
          days: 28,
          legend: [{ tone: `green`, short: `もえる`, label: `もえる ごみ` }],
          marks: [
            { day: 2, tone: `green` },
            { day: 4, tone: `blue` }
          ]
        }),
        POINTS
      )
    ).toEqual([`n5-d6-0001: day 4 is blue, which the legend does not explain`]);
  });

  it(`writes out every line of the picture for its alt text`, () => {
    // WHY: a student who cannot see the picture reads this instead, and the line left out could be the one that holds the answer. Empty corner cells add nothing to read.
    expect(
      materialMarkup({
        kind: `notice`,
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
          { text: [`5さつまで {借|か}りられます。`] },
          {
            panels: [
              { head: `① バス`, lines: [`30{分|ぷん}`, `220{円|えん}`] },
              { head: `② タクシー`, lines: [`10{分|ぷん}`] }
            ]
          }
        ]
      })
    ).toBe(
      [
        `みどり {図書館|としょかん}`,
        `{時間|じかん}`,
        `{月|げつ} やすみ`,
        `{飲|の}みもの`,
        `ミルク 150{円|えん}`,
        `5さつまで {借|か}りられます。`,
        `① バス`,
        `30{分|ぷん}`,
        `220{円|えん}`,
        `② タクシー`,
        `10{分|ぷん}`
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

describe(`vocabulary items`, () => {
  const kanji = (overrides: Partial<KanjiItem> = {}): KanjiItem => ({
    id: `n5-g1-0001`,
    type: `kanji`,
    status: `draft`,
    word: `先週`,
    sentence: `__先週__ うみへ いきました。`,
    en: `I went to the sea last week.`,
    answer: `せんしゅう`,
    wrong: [`せんしゅ`, `せんじゅう`, `さきしゅう`],
    difficulty: 1,
    note: `This asks the reading of 先週.`,
    ...overrides
  });
  const spelling = (overrides: Partial<SpellingItem> = {}): SpellingItem => ({
    id: `n5-g2-0001`,
    type: `spelling`,
    status: `draft`,
    word: `学校`,
    sentence: `ヤンさんの __がっこう__は どこですか。`,
    en: `Where is Yan's school?`,
    answer: `学校`,
    wrong: [`学枚`, `字校`, `字枚`],
    difficulty: 1,
    note: `校 is the school; 枚 counts flat things.`,
    ...overrides
  });
  const context = (overrides: Partial<ContextItem> = {}): ContextItem => ({
    id: `n5-g3-0001`,
    type: `context`,
    status: `draft`,
    sentence: `さむいですから、まどを ${BLANK} ください。`,
    en: `It is cold, so please close the window.`,
    answer: `しめて`,
    wrong: [`あけて`, `つけて`, `きって`],
    difficulty: 1,
    note: `A cold room wants the window shut.`,
    ...overrides
  });
  const paraphrase = (
    overrides: Partial<ParaphraseItem> = {}
  ): ParaphraseItem => ({
    id: `n5-g4-0001`,
    type: `paraphrase`,
    status: `draft`,
    sentence: `あには えいごの きょうしです。`,
    en: `My older brother is an English teacher.`,
    answer: `あには えいごを おしえて います。`,
    wrong: [
      `あには えいごを ならって います。`,
      `あには えいごが すきです。`,
      `あには えいごの がくせいです。`
    ],
    difficulty: 1,
    note: `きょうし is a teacher: someone who teaches.`,
    ...overrides
  });

  it(`passes a well-formed item of each type`, () => {
    for (const each of [kanji(), spelling(), context(), paraphrase()]) {
      expect(itemProblems(each, POINTS)).toEqual([]);
    }
  });

  it(`catches a kanji outside the word a question tests`, () => {
    // WHY: Section 1 writes everything in kana except what it tests, and prints no readings. A kanji elsewhere would need a reading the card cannot show without breaking that rule.
    expect(
      itemProblems(
        kanji({ sentence: `{今日|きょう}と __先週__は いそがしかったです。` }),
        POINTS
      )
    ).toContain(
      `n5-g1-0001: Section 1 prints no readings; write the sentence without ruby`
    );
    expect(
      itemProblems(
        kanji({ sentence: `今日と __先週__は いそがしかったです。` }),
        POINTS
      )
    ).toEqual([
      `n5-g1-0001: kanji 今 in the sentence; Section 1 writes everything but the tested word in kana`,
      `n5-g1-0001: kanji 日 in the sentence; Section 1 writes everything but the tested word in kana`
    ]);
    expect(
      itemProblems(
        paraphrase({ answer: `あには えいごを {教|おし}えて います。` }),
        POINTS
      )
    ).toContain(
      `n5-g4-0001: kanji 教 in an option; Section 1 writes these in kana`
    );
  });

  it(`asks 漢字読み for a kanji the paper would test, answered in hiragana`, () => {
    // WHY: the paper asks the reading ひらがなで, of words in N5 and N4 kanji. A katakana answer, a target with nothing to read, or a kanji above N4 is a different test.
    expect(
      itemProblems(
        kanji({ wrong: [`センシュウ`, `せんじゅう`, `さきしゅう`] }),
        POINTS
      )
    ).toEqual([
      `n5-g1-0001: option "センシュウ" is not hiragana; 漢字読み answers are written ひらがなで`
    ]);
    expect(
      itemProblems(
        kanji({ sentence: `__せんしゅう__ うみへ いきました。` }),
        POINTS
      )
    ).toEqual([`n5-g1-0001: the underlined word has no kanji to read`]);
    expect(
      itemProblems(
        kanji({
          word: `机`,
          sentence: `__机__の うえに あります。`,
          answer: `つくえ`,
          wrong: [`つぐえ`, `つくい`, `づくえ`]
        }),
        POINTS
      )
    ).toEqual([
      `n5-g1-0001: kanji 机 is above N4; the paper would not ask its reading`
    ]);
  });

  it(`asks 表記 to spell a kana word in kanji or katakana`, () => {
    // WHY: 表記 tests writing. An answer already in hiragana tests nothing, and an underlined word in kanji shows the student the answer.
    expect(itemProblems(spelling({ answer: `がっこう` }), POINTS)).toEqual([
      `n5-g2-0001: the answer is all hiragana; a 表記 answer is written in kanji or katakana`
    ]);
    expect(
      itemProblems(
        spelling({ sentence: `ヤンさんの __学校__は どこですか。` }),
        POINTS
      )
    ).toEqual([
      `n5-g2-0001: kanji 学 in the sentence; Section 1 writes everything but the tested word in kana`,
      `n5-g2-0001: kanji 校 in the sentence; Section 1 writes everything but the tested word in kana`,
      `n5-g2-0001: the underlined word must be kana; it is what the student spells`
    ]);
  });

  it(`underlines exactly one word where the paper does, and nowhere else`, () => {
    // WHY: the card underlines what is asked about. Two underlines leave the student guessing which; an underline on a 文脈規定 sentence points at something that is not asked.
    expect(
      itemProblems(kanji({ sentence: `先週 うみへ いきました。` }), POINTS)
    ).toContain(`n5-g1-0001: underline exactly one word, as __…__`);
    expect(
      itemProblems(
        context({ sentence: `__さむい__ですから、まどを ${BLANK} ください。` }),
        POINTS
      )
    ).toEqual([`n5-g3-0001: only 漢字読み and 表記 underline a word`]);
    expect(
      itemProblems(
        context({ sentence: `さむいですから、まどを しめて ください。` }),
        POINTS
      )
    ).toEqual([`n5-g3-0001: a 文脈規定 sentence has exactly one ${BLANK}`]);
  });

  it(`asks a medium or hard question to say why each wrong option is wrong`, () => {
    // WHY: a near-miss reading such as せんしゅ is wrong by a rule the student may not know; the user asked for a why at medium and hard, as for reading.
    const hard = kanji({
      difficulty: 3,
      wrong: [
        { option: `せんしゅ`, why: `しゅう is long: せんしゅう.` },
        `せんじゅう`,
        `さきしゅう`
      ]
    });
    expect(itemProblems(hard, POINTS)).toEqual([
      `n5-g1-0001: a medium or hard question says why each wrong option is wrong; "せんじゅう" has no why`,
      `n5-g1-0001: a medium or hard question says why each wrong option is wrong; "さきしゅう" has no why`
    ]);
  });

  it(`points out an answer the sentence already shows`, () => {
    // WHY: a 漢字読み sentence that has せんしゅう in kana elsewhere gives the reading away. A hint, because a short answer can sit inside another word by chance.
    expect(
      itemHints(kanji({ sentence: `せんしゅうは __先週__です。` }))
    ).toEqual([
      `n5-g1-0001: the answer "せんしゅう" also appears outside the underlined word, which may give it away`
    ]);
    expect(itemHints(kanji())).toEqual([]);
  });
});

describe(`the word list`, () => {
  const LIST: VocabList = {
    source: `test`,
    levels: `test`,
    license: `test`,
    words: [
      { level: 5, kanji: [`大人`], kana: [`おとな`] },
      { level: 5, kanji: [`橋`], kana: [`はし`] },
      { level: 5, kanji: [`箸`], kana: [`はし`] },
      { level: 4, kanji: [`港`], kana: [`みなと`] }
    ],
    readings: {
      大人: [`おとな`, `だいにん`, `たいじん`],
      橋: [`はし`],
      箸: [`はし`],
      港: [`みなと`]
    }
  };
  const read = (overrides: Partial<KanjiItem> = {}): KanjiItem => ({
    id: `n5-g1-0001`,
    type: `kanji`,
    status: `draft`,
    word: `大人`,
    sentence: `__大人__の きっぷは いくらですか。`,
    en: `How much is an adult ticket?`,
    answer: `おとな`,
    wrong: [`おおと`, `おとうな`, `おどな`],
    difficulty: 1,
    note: `n`,
    ...overrides
  });
  const spell = (overrides: Partial<SpellingItem> = {}): SpellingItem => ({
    id: `n5-g2-0001`,
    type: `spelling`,
    status: `draft`,
    word: `橋`,
    sentence: `この __はし__を わたります。`,
    en: `I cross this bridge.`,
    answer: `橋`,
    wrong: [`矯`, `槁`, `喬`],
    difficulty: 1,
    note: `n`,
    ...overrides
  });

  it(`passes words on the list, read and written as JMdict has them`, () => {
    expect(wordProblems([read(), spell()], LIST)).toEqual([]);
  });

  it(`catches a 漢字読み option that is another reading of the same kanji`, () => {
    // WHY: on a fare sign 大人 is read だいにん. An option that is right somewhere is a trap code can see and a reviewer can miss; the paper never uses one.
    expect(
      wordProblems([read({ wrong: [`だいにん`, `おとうな`, `おどな`] })], LIST)
    ).toEqual([
      `n5-g1-0001: だいにん is also a reading of 大人, so the option is right somewhere`
    ]);
  });

  it(`catches a 表記 option that is another word with the same reading`, () => {
    // WHY: はし is 橋, a bridge, and 箸, chopsticks. Only the sentence tells them apart, so 表記 must not ask the student to choose between them.
    expect(wordProblems([spell({ wrong: [`箸`, `槁`, `喬`] })], LIST)).toEqual([
      `n5-g2-0001: 箸 is also an N5 or N4 word read はし, so the option is right somewhere`
    ]);
  });

  it(`catches an answer the dictionary does not give, and a word off the list`, () => {
    // WHY: a typo in an answer key marks every right student wrong. And the paper tests N5 words: a word on neither list is off level, or misspelt.
    expect(
      wordProblems(
        [read({ answer: `おとうな`, wrong: [`おおと`, `おとな`, `おどな`] })],
        LIST
      )
    ).toEqual([
      `n5-g1-0001: JMdict does not read 大人 as おとうな`,
      `n5-g1-0001: おとな is also a reading of 大人, so the option is right somewhere`
    ]);
    expect(wordProblems([read({ word: `机` })], LIST)).toEqual([
      `n5-g1-0001: 机 is not an N5 or N4 word on the list; check its spelling, or choose another word`
    ]);
  });

  it(`points out an N4 word, which the N5 paper rarely tests`, () => {
    expect(
      wordHints(
        [
          spell({
            word: `港`,
            sentence: `__みなと__へ いきます。`,
            answer: `港`
          })
        ],
        LIST
      )
    ).toEqual([`n5-g2-0001: 港 is an N4 word; the N5 paper tests N5 words`]);
    expect(wordHints([spell()], LIST)).toEqual([]);
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

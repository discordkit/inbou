import { describe, expect, it } from "vite-plus/test";
import type { ExamQuestion } from "../draw.js";
import {
  closedQuestionMessage,
  CONTENT_MAX,
  fitLabel,
  heading2,
  LABEL_MAX,
  myResultsText,
  parseResults,
  parseVote,
  questionMessage,
  resultsMessage,
  revealMessage,
  passageBlock,
  sentenceBlock
} from "../render.js";

/**
 * What the channel sees.
 *
 * The renderer is pure, so these tests read the exact objects Discord would
 * receive. The most important property is one the eye cannot check: nothing in
 * an open question gives the answer away.
 */

const question = (overrides: Partial<ExamQuestion> = {}): ExamQuestion => ({
  itemId: `n5-b1-0001`,
  slot: 1,
  mondai: 1,
  number: 3,
  card: 3,
  prompt: `{毎日|まいにち} バス（1） {行|い}きます。`,
  answered: `{毎日|まいにち} バス__で__ {行|い}きます。`,
  options: [`を`, `で`, `が`, `と`],
  correct: 1,
  difficulty: 1,
  points: [`particle-de-means`],
  en: `I go by bus.`,
  note: `で marks the means.`,
  token: `abc123`,
  timeoutMs: 30_000,
  ...overrides
});

/** Two review links, as the draw attaches them. */
const DE = {
  label: `で`,
  url: `https://www.tofugu.com/japanese-grammar/particle-de/#for-means-of-an-action`
};
const TO = {
  label: `と`,
  url: `https://www.tofugu.com/japanese-grammar/particle-to/#as-in-with`
};

const view = (q: ExamQuestion) => ({
  questions: [q],
  total: 9,
  endsAt: 1_700_000_000
});

/** Every button in a message, wherever it sits. */
const buttons = (message: unknown): Record<string, unknown>[] => {
  const found: Record<string, unknown>[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
    } else if (typeof node === `object` && node !== null) {
      const record = node as Record<string, unknown>;
      if (record.type === 2) found.push(record);
      walk(record.components);
    }
  };
  walk(message);
  return found;
};

describe(`a passage question`, () => {
  it(`shows the passage as a quote at reading size, with its readings below`, () => {
    // WHY: two hundred characters at heading size would fill the screen. The
    // quote bar runs down every line, since a quote stops at a line break.
    expect(
      passageBlock(`{私|わたし}は［14］です。
また **［15］**。`)
    ).toBe(
      `> 私は［14］です。
> また **［15］**。
-# 私 わたし`
    );
  });

  it(`gives each blank its own labelled row, inside Discord's 40 components`, () => {
    // WHY: found in the second live test. One passage split across four cards
    // read badly; on one card each row must say which blank it answers, and
    // each button must carry its own blank's token.
    const blanks = [14, 15, 16, 17].map((number) =>
      question({ mondai: 3, number, card: 14, token: `tok${String(number)}` })
    );
    const card = questionMessage({ questions: blanks, total: 17, endsAt: 0 });
    const json = JSON.stringify(card);
    for (const number of [14, 15, 16, 17]) {
      expect(json).toContain(`**［${String(number)}］**`);
    }
    const ids = buttons(card).map((button) => String(button.customId));
    expect(ids.filter((id) => id.startsWith(`exam:v:tok16:`))).toHaveLength(4);
    expect(json).toContain(`14–17 / 17`);

    let components = 0;
    const count = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(count);
      else if (typeof node === `object` && node !== null) {
        components += 1;
        count((node as { components?: unknown }).components);
      }
    };
    count(card);
    expect(components).toBeLessThanOrEqual(40);
  });

  it(`puts the intro above the passage`, () => {
    // WHY: the intro says who wrote the passage and why, which the blanks
    // can depend on — a letter to a teacher is polite.
    const card = JSON.stringify(
      questionMessage(
        view(
          question({
            mondai: 3,
            intro: `ケンさんが メールを {書|か}きました。`,
            prompt: `こんにちは。**［14］**。`
          })
        )
      )
    );
    expect(card.indexOf(`ケンさんが`)).toBeGreaterThan(-1);
    expect(card.indexOf(`ケンさんが`)).toBeLessThan(
      card.indexOf(`> こんにちは`)
    );
  });
});

describe(`an open question`, () => {
  it(`is identical whichever option is correct`, () => {
    // WHY: a client can read every component, including custom ids. If the
    // answer changed anything at all in the open card, someone could read it.
    const a = questionMessage(view(question({ correct: 0 })));
    const b = questionMessage(view(question({ correct: 3 })));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it(`numbers its options 1 to 4, as the paper does`, () => {
    // WHY: the reveal says "2 で". The buttons must use the same numbers.
    const labels = buttons(questionMessage(view(question())))
      .map((button) => button.label)
      .slice(0, 4);
    expect(labels).toEqual([`1 を`, `2 で`, `3 が`, `4 と`]);
  });

  it(`shows the sentence clean, with each reading once in a line below`, () => {
    // WHY: found in the first live test. Inline readings — 日曜日(にちようび)に —
    // broke the sentence up and made it hard to read. Below it, they play
    // furigana's part without getting in the way.
    expect(
      sentenceBlock(
        `{日曜日|にちようび}に {学校|がっこう}（1） {日曜日|にちようび}`
      )
    ).toBe(
      `## 日曜日に 学校（　） 日曜日\n-# 日曜日 にちようび · 学校 がっこう`
    );
  });

  it(`adds no readings line to a sentence without kanji`, () => {
    // WHY: an empty small line still takes vertical space on every card.
    expect(sentenceBlock(`きのうの テストは あまり（1）です。`)).toBe(
      `## きのうの テストは あまり（　）です。`
    );
  });

  it(`shows a dialogue large on every line, not only the first`, () => {
    // WHY: Discord's ## styles one line. With one heading, speaker A would
    // be large and speaker B small, as if B were a footnote.
    expect(heading2(`Ａ「はい」\nＢ「いいえ」`)).toBe(
      `## Ａ「はい」\n## Ｂ「いいえ」`
    );
  });
});

describe(`a closed question`, () => {
  it(`keeps its buttons but disables them, and drops End test`, () => {
    // WHY: the layout stays where the channel scrolled past it, the numbers
    // still match the reveal, and nothing on it can be pressed.
    const closed = buttons(closedQuestionMessage(view(question())));
    expect(closed).toHaveLength(4);
    for (const button of closed) expect(button.disabled).toBe(true);
  });

  it(`replaces the countdown`, () => {
    // WHY: Discord renders <t:…:R> forever. Left alone, a closed question
    // says "ends 5 minutes ago" until the end of time.
    expect(
      JSON.stringify(closedQuestionMessage(view(question())))
    ).not.toContain(`<t:`);
  });
});

describe(`the reveal`, () => {
  it(`shows the drawn answer underlined, without inline readings`, () => {
    // WHY: the reveal is a heading; the underline is what marks the answer,
    // and the readings belong on their own line as on the question card.
    const reveal = JSON.stringify(
      revealMessage([
        {
          question: question(),
          tally: { counts: [0, 1, 0, 0], correct: 1, scorers: [] }
        }
      ])
    );
    expect(reveal).toContain(`## 毎日 バス__で__ 行きます。`);
    expect(reveal).toContain(`-# 毎日 まいにち · 行 い`);
  });

  it(`reveals a passage card as one: every answer in place, then each blank`, () => {
    // WHY: the passage is answered as one card, so it is revealed as one —
    // the completed passage, each blank's answer and note, and the English
    // once, at the end.
    const blank = (number: number, en: string) =>
      question({
        mondai: 3,
        number,
        card: 14,
        prompt: `あ［14］い［15］う。`,
        answered: `あ__で__い__に__う。`,
        en,
        note: `Note ${String(number)}.`
      });
    const reveal = JSON.stringify(
      revealMessage([
        {
          question: blank(14, ``),
          tally: { counts: [0, 1, 0, 0], correct: 1, scorers: [`ann`] }
        },
        {
          question: blank(15, `The English.`),
          tally: { counts: [0, 0, 0, 0], correct: 1, scorers: [] }
        }
      ])
    );
    expect(reveal).toContain(`> あ__で__い__に__う。`);
    expect(reveal).toContain(`**［14］ 2 で** · 1 of 1 correct`);
    expect(reveal).toContain(`**［15］ 2 で** · Nobody answered.`);
    expect(reveal.match(/The English\./gu)).toHaveLength(1);
  });

  it(`says nobody answered rather than "0 of 0 correct"`, () => {
    const reveal = revealMessage([
      {
        question: question(),
        tally: { counts: [0, 0, 0, 0], correct: 1, scorers: [] }
      }
    ]);
    expect(JSON.stringify(reveal)).toContain(`Nobody answered.`);
  });

  it(`links the grammar to Tofugu under the note, without a preview card`, () => {
    // WHY: a student who got it wrong can read more while the question is fresh. The `<>` stops Discord adding a preview card per link, which would push the next question off screen.
    const reveal = JSON.stringify(
      revealMessage([
        {
          question: question({ review: [DE, TO] }),
          tally: { counts: [0, 1, 0, 0], correct: 1, scorers: [] }
        }
      ])
    );
    expect(reveal).toContain(
      `-# Review on Tofugu: [で](<${DE.url}>) · [と](<${TO.url}>)`
    );
  });

  it(`links each passage blank to its own page`, () => {
    // WHY: the four blanks of a passage test different grammar, so one link for the card would send a student to the wrong page.
    const reveal = JSON.stringify(
      revealMessage([
        {
          question: question({ mondai: 3, number: 14, review: [DE] }),
          tally: { counts: [0, 1, 0, 0], correct: 1, scorers: [] }
        },
        {
          question: question({ mondai: 3, number: 15, review: [TO] }),
          tally: { counts: [0, 1, 0, 0], correct: 1, scorers: [] }
        }
      ])
    );
    expect(reveal).toMatch(/［14］[^［]*\[で\]\(</u);
    expect(reveal).toMatch(/［15］[^［]*\[と\]\(</u);
  });

  it(`adds no review line when no page covers the grammar`, () => {
    // WHY: "Review on Tofugu:" with nothing after it points nowhere. A test drawn before links existed has no `review` at all, and must still reveal.
    for (const review of [[], undefined]) {
      const reveal = JSON.stringify(
        revealMessage([
          {
            question: question({ review }),
            tally: { counts: [0, 1, 0, 0], correct: 1, scorers: [] }
          }
        ])
      );
      expect(reveal).not.toContain(`Review on Tofugu`);
    }
  });
});

describe(`button ids`, () => {
  it(`round-trips a vote`, () => {
    expect(parseVote(`exam:v:abc123:2`)).toEqual({ token: `abc123`, index: 2 });
  });

  it(`rejects an empty option, which Number() would read as option 1`, () => {
    // WHY: Number("") is 0. tome shipped this once: `…:` voted for A.
    expect(parseVote(`exam:v:abc123:`)).toBeNull();
    expect(parseVote(`exam:v::0`)).toBeNull();
  });

  it(`rejects another namespace and an option out of range`, () => {
    expect(parseVote(`tome:v:abc123:1`)).toBeNull();
    expect(parseVote(`exam:v:abc123:4`)).toBeNull();
  });

  it(`reads a results button's test id`, () => {
    expect(parseResults(`exam:r:mk3x9`)).toBe(`mk3x9`);
    expect(parseResults(`exam:r:`)).toBeNull();
  });
});

describe(`results`, () => {
  it(`offers My results only when someone answered`, () => {
    // WHY: a button that can only say "you did not answer" is clutter.
    expect(buttons(resultsMessage(`bunpou`, `t1`, []))).toHaveLength(0);
    const one = buttons(
      resultsMessage(`bunpou`, `t1`, [
        { userId: `ann`, points: 2, max: 4, correct: 1, asked: 2 }
      ])
    );
    expect(one.map((button) => button.customId)).toEqual([`exam:r:t1`]);
  });

  it(`shows a missed question beside its right answer`, () => {
    // WHY: the private results are where a student learns. "❌" alone
    // teaches nothing.
    const text = myResultsText(
      [question({ number: 1 }), question({ number: 2 })],
      [
        { number: 1, chose: 0, correct: false, points: 0 },
        { number: 2, chose: null, correct: false, points: 0 }
      ],
      { userId: `ann`, points: 0, max: 4, correct: 0, asked: 2 }
    );
    expect(text).toContain(`1 ❌ を → **で**`);
    expect(text).toContain(`2 ❌ no answer → **で**`);
  });

  it(`links a missed question to its review page, and a right one to nothing`, () => {
    // WHY: the links are homework for what the student got wrong. A link beside every right answer would bury the ones that matter.
    const text = myResultsText(
      [
        question({ number: 1, review: [DE] }),
        question({ number: 2, review: [TO] })
      ],
      [
        { number: 1, chose: 0, correct: false, points: 0 },
        { number: 2, chose: 1, correct: true, points: 2 }
      ],
      { userId: `ann`, points: 2, max: 4, correct: 1, asked: 2 }
    );
    expect(text).toContain(`1 ❌ を → **で** · [で](<${DE.url}>)`);
    expect(text).toContain(`2 ✅ で\n`);
    expect(text).not.toContain(TO.url);
  });

  it(`escapes square brackets in a link's label`, () => {
    // WHY: a "]" in the label would end the link text early, and Discord would show broken markup instead of a link.
    const text = myResultsText(
      [
        question({
          number: 1,
          review: [{ label: `[clause] + noun`, url: DE.url }]
        })
      ],
      [{ number: 1, chose: 0, correct: false, points: 0 }],
      undefined
    );
    expect(text).toContain(`[\\[clause\\] + noun](<${DE.url}>)`);
  });

  it(`fits Discord's 2,000 characters however much is missed, keeping every answer`, () => {
    // WHY: Discord rejects a reply over the limit, so the student who missed the most would see nothing at all. Links go first, from the end; the answers stay, and the answer cards above still have every link.
    const long = (n: number) => ({
      label: `〜くなかった／〜じゃなかった`,
      url: `https://www.tofugu.com/japanese-grammar/explanatory-nda-ndesu-noda-nodesu/#for-explaining-${String(n)}`
    });
    const questions = Array.from({ length: 17 }, (_, i) =>
      question({ number: i + 1, review: [long(i), long(i + 100)] })
    );
    const answers = questions.map((q) => ({
      number: q.number,
      chose: 0,
      correct: false,
      points: 0
    }));
    const text = myResultsText(questions, answers, {
      userId: `ann`,
      points: 0,
      max: 51,
      correct: 0,
      asked: 17
    });
    expect(text.length).toBeLessThanOrEqual(CONTENT_MAX);
    for (const q of questions) {
      expect(text).toContain(`\n${String(q.number)} ❌ を → **で**`);
    }
    expect(text).toContain(long(0).url);
    expect(text).toContain(`The answer card for each question has them.`);
  });
});

describe(`a button label`, () => {
  it(`fits inside Discord's limit`, () => {
    // WHY: Discord rejects the whole message over 80 characters, which loses
    // the question, not just the label.
    expect(fitLabel(`あ`.repeat(200))).toHaveLength(LABEL_MAX);
  });
});

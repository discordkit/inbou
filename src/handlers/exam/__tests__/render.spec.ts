import { describe, expect, it } from "vite-plus/test";
import type { ExamQuestion } from "../draw.js";
import {
  answeredSentence,
  closedQuestionMessage,
  fitLabel,
  heading2,
  LABEL_MAX,
  myResultsText,
  parseResults,
  parseVote,
  questionMessage,
  resultsMessage,
  revealMessage
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
  prompt: `{毎日|まいにち} バス（1） {行|い}きます。`,
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

const view = (q: ExamQuestion) => ({
  question: q,
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
  it(`marks each half of a pair answer separately`, () => {
    // WHY: one pair of ** around も／も would span the text between the two
    // blanks and bold half the sentence.
    const pair = question({
      prompt: `{日曜日|にちようび}（1） {土曜日|どようび}（1）、{休|やす}みです。`,
      options: [`も／も`, `は／は`, `に／に`, `を／を`],
      correct: 0
    });
    expect(answeredSentence(pair)).toBe(
      `日曜日(にちようび)**も** 土曜日(どようび)**も**、休(やす)みです。`
    );
  });

  it(`says nobody answered rather than "0 of 0 correct"`, () => {
    const reveal = revealMessage(question(), {
      counts: [0, 0, 0, 0],
      correct: 1,
      scorers: []
    });
    expect(JSON.stringify(reveal)).toContain(`Nobody answered.`);
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
});

describe(`a button label`, () => {
  it(`fits inside Discord's limit`, () => {
    // WHY: Discord rejects the whole message over 80 characters, which loses
    // the question, not just the label.
    expect(fitLabel(`あ`.repeat(200))).toHaveLength(LABEL_MAX);
  });
});

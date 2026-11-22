import {
  ButtonStyle,
  ComponentType,
  type ActionRow,
  type MessageComponent
} from "@discordkit/client";
import type { Mondai, TestId } from "./blueprint.js";
import { OPTION_COUNT, type ExamQuestion } from "./draw.js";
import { bare, BLANK, display, readingsOf, type ReviewLink } from "./items.js";
import type { Answer, Result, Tally } from "./machine.js";

/**
 * What the channel sees during a mock test.
 *
 * Pure functions returning plain objects, so every message the bot can post is
 * testable without a network. Everything is Components V2: a question needs
 * its buttons inside the card, and V2 is all or nothing per message.
 *
 * Test content and the instruction lines are Japanese, as on the paper. The
 * bot's own words (counts, results) are English, as in the rest of inbou.
 */

/** Open: the quiz's indigo. */
const INDIGO = 0x2f_4b_6e;
/** Revealed: the quiz's moss. */
const MOSS = 0x4a_6b_45;
/**
 * A question that has closed. Muted rather than green: the reveal just below is
 * the green thing, and two green cards in a row would compete for attention.
 */
const SLATE = 0x3a_3f_44;

/** Discord's cap on a button label. */
export const LABEL_MAX = 80;

/** Discord's cap on a message's `content`, which My results is. */
export const CONTENT_MAX = 2000;

/**
 * Links to read more, as `[で](<url>)`.
 *
 * The `<>` stops Discord from adding a preview card for each link. Square brackets in a label would end the link text early, so they are escaped.
 */
const reviewLinks = (review: readonly ReviewLink[] | undefined): string =>
  (review ?? [])
    .map(({ label, url }) => `[${label.replace(/[[\]]/gu, `\\$&`)}](<${url}>)`)
    .join(` · `);

/** A small line under a teaching note, or nothing when no page covers it. */
const reviewLine = (review: readonly ReviewLink[] | undefined): string => {
  const links = reviewLinks(review);
  return links === `` ? `` : `\n-# Review on Tofugu: ${links}`;
};

/**
 * The custom ids the buttons carry.
 *
 * The **correct option is never here.** A client can read every button's id,
 * so putting the answer in one would let anyone with devtools score.
 */
export const BUTTON = {
  /** `exam:v:<questionToken>:<optionIndex>` */
  vote: (token: string, index: number): string =>
    `exam:v:${token}:${String(index)}`,
  end: `exam:end`,
  /** `exam:r:<testId>`, so results from an earlier test are not confused. */
  results: (testId: string): string => `exam:r:${testId}`
} as const;

/** A vote id, parsed, or null if it is not one. */
export const parseVote = (
  customId: string
): { token: string; index: number } | null => {
  const parts = customId.split(`:`);
  if (parts.length !== 4) return null;
  const [ns, kind, token, raw] = parts;
  if (ns !== `exam` || kind !== `v`) return null;
  // `Number("")` is 0, so an empty segment would otherwise read as option 1.
  if (token === `` || raw === ``) return null;
  const index = Number(raw);
  if (!Number.isInteger(index) || index < 0 || index >= OPTION_COUNT) {
    return null;
  }
  return { token, index };
};

/** The test a results button belongs to, or null if it is not one. */
export const parseResults = (customId: string): string | null => {
  const match = /^exam:r:(?<id>[a-z0-9]+)$/u.exec(customId);
  return match?.groups?.id ?? null;
};

/** What each test is called on its cards. */
export const TEST_NAMES: Readonly<Record<TestId, string>> = {
  bunpou: `文法(ぶんぽう) · N5`,
  dokkai: `読解(どっかい) · N5`
};

/**
 * The paper's instruction line for each type, in its own wording.
 *
 * Markup, so the kanji carry readings as on the paper.
 */
export const INSTRUCTIONS: Readonly<Record<Mondai, string>> = {
  1: `${BLANK}に {何|なに}を {入|い}れますか。1・2・3・4から いちばん いい ものを {一|ひと}つ えらんで ください。`,
  2: `★に {入|はい}る ものは どれですか。1・2・3・4から いちばん いい ものを {一|ひと}つ えらんで ください。`,
  3: `［　］に {何|なに}を {入|い}れますか。ぶんしょうの いみを かんがえて、1・2・3・4から いちばん いい ものを {一|ひと}つ えらんで ください。`,
  4: `つぎの ぶんしょうを {読|よ}んで、しつもんに こたえて ください。こたえは、1・2・3・4から いちばん いい ものを {一|ひと}つ えらんで ください。`,
  5: `つぎの ぶんしょうを {読|よ}んで、しつもんに こたえて ください。こたえは、1・2・3・4から いちばん いい ものを {一|ひと}つ えらんで ください。`,
  // The paper's 右の ページ: here the picture sits in the card, so つぎの.
  6: `つぎの ページを {見|み}て、しつもんに こたえて ください。こたえは、1・2・3・4から いちばん いい ものを {一|ひと}つ えらんで ください。`
};

/** Reading puts its options in the card, and its buttons show only the number. */
const isReading = (question: ExamQuestion): boolean => question.mondai >= 4;

/** Discord's cap on a picture's description, its alt text. */
const ALT_MAX = 1024;

/**
 * A sentence as a heading, every line of it.
 *
 * Discord's `##` styles one line. A dialogue is one line per speaker, and with
 * a single `##` only the first speaker would be large.
 */
export const heading2 = (text: string): string =>
  text
    .split(`\n`)
    .map((line) => `## ${line}`)
    .join(`\n`);

/**
 * A sentence as the card shows it: large, as the paper prints it, with its
 * readings in one small line below.
 *
 * Inline readings — 日曜日(にちようび)に — made sentences hard to read in the
 * first live test. Below the sentence they play furigana's part without
 * breaking it up, and the sentence keeps the paper's spacing.
 */
export const sentenceBlock = (markup: string): string =>
  withReadings(heading2(bare(markup)), markup);

/**
 * A passage as the card shows it: a block quote at reading size, with its
 * readings below like a sentence's.
 *
 * Not a heading: two hundred characters at heading size would fill the
 * screen. The quote bar sets the passage apart from the question around it,
 * and runs down every line, since a quote stops at a line break.
 */
export const passageBlock = (markup: string): string =>
  withReadings(
    bare(markup)
      .split(`\n`)
      .map((line) => `> ${line}`)
      .join(`\n`),
    markup
  );

/** Text followed by a small line of its kanji's readings, if it has any. */
const withReadings = (text: string, markup: string): string => {
  const readings = readingsOf(markup)
    .map(({ base, reading }) => `${base} ${reading}`)
    .join(` · `);
  return readings === `` ? text : `${text}\n-# ${readings}`;
};

/** Fit a label inside Discord's limit. The full text is in the reveal. */
export const fitLabel = (text: string): string =>
  text.length <= LABEL_MAX ? text : `${text.slice(0, LABEL_MAX - 1)}…`;

/** What a card needs beyond its questions. */
export interface QuestionView {
  /** The questions on the card: usually one; a passage's blanks share one. */
  questions: readonly ExamQuestion[];
  /** How many questions the test has. */
  total: number;
  /** Epoch seconds, rendered by the client as a live countdown. */
  endsAt: number;
  /** How many have answered: a count, never a distribution. */
  voters?: number;
}

/** "14" for one question, "14–17" for a card of several. */
const numbersOf = (questions: readonly ExamQuestion[]): string => {
  const first = questions.at(0)?.number ?? 0;
  const last = questions.at(-1)?.number ?? first;
  return first === last ? String(first) : `${String(first)}–${String(last)}`;
};

/** One question's four buttons, numbered as on the paper. */
const optionRow = (question: ExamQuestion, closed: boolean): ActionRow => ({
  type: ComponentType.ActionRow as const,
  components: question.options.map((option, index) => ({
    type: ComponentType.Button as const,
    style: ButtonStyle.Secondary as const,
    // Numbered as on the paper, so the reveal can refer to "2".
    label: fitLabel(`${String(index + 1)} ${display(option)}`),
    customId: BUTTON.vote(question.token, index),
    // Disabled rather than removed, so the layout the channel scrolled past
    // stays put and the numbers still match the reveal.
    ...(closed ? { disabled: true } : {})
  }))
});

/**
 * A card, open or closed.
 *
 * One builder for both, because the message is EDITED in place when the timer
 * ends, and any difference beyond the closed state would read as the message
 * rewriting itself.
 *
 * A passage card has a row of buttons per blank, each labelled with its
 * number, so the whole passage is answered on one card: about 32 of Discord's
 * 40 components for four blanks.
 */
/** The card's top line: which 問題, which questions, and the clock. */
const headingOf = (view: QuestionView, closed: boolean): string => {
  const first = view.questions.at(0);
  const voters =
    view.voters === undefined || view.voters === 0
      ? ``
      : ` · ${String(view.voters)} answered`;
  // A relative timestamp is ticked down by the client for free. It must be
  // replaced on close, or it goes on saying "ends 5 minutes ago" forever.
  return `**もんだい${String(first?.mondai ?? ``)}** · ${numbersOf(view.questions)} / ${String(view.total)} · ${
    closed ? `closed` : `ends <t:${String(view.endsAt)}:R>`
  }${voters}`;
};

/** The End test button, outside the card, and only while it is open. */
const endRow = (closed: boolean): MessageComponent =>
  closed
    ? []
    : [
        {
          type: ComponentType.ActionRow as const,
          components: [
            {
              type: ComponentType.Button as const,
              style: ButtonStyle.Danger as const,
              label: `End test`,
              customId: BUTTON.end
            }
          ]
        }
      ];

/** What a card may hold: anything but another card. */
type InCard = Extract<
  MessageComponent[number],
  { type: ComponentType.Container }
>[`components`][number];

/** Fit alt text inside Discord's limit. Its readings are on the card in full. */
const fitAlt = (text: string): string =>
  text.length <= ALT_MAX ? text : `${text.slice(0, ALT_MAX - 1)}…`;

/**
 * A reading card: the text or picture once, then each question with its options in the card.
 *
 * Reading options are sentences, too long for a button and too important to trim, so they sit in the card as the paper prints them, numbered 1–4, and the buttons show only the number. A 問題6 card puts its question above the picture, as the paper puts it above the page. Until the picture pipeline hosts the picture, its text stands in.
 */
const readingBody = (view: QuestionView, closed: boolean): MessageComponent => {
  const first = view.questions.at(0);
  if (first === undefined) return [];
  const several = view.questions.length > 1;

  const stem = (question: ExamQuestion): string =>
    sentenceBlock(
      several
        ? `［${String(question.number)}］ ${question.question ?? ``}`
        : (question.question ?? ``)
    );
  const optionsOf = (question: ExamQuestion): string =>
    withReadings(
      question.options
        .map((option, index) => `### ${String(index + 1)}　${bare(option)}`)
        .join(`\n`),
      question.options.join(` `)
    );
  const numberRow = (question: ExamQuestion): ActionRow => ({
    type: ComponentType.ActionRow as const,
    components: question.options.map((_, index) => ({
      type: ComponentType.Button as const,
      style: ButtonStyle.Secondary as const,
      label: String(index + 1),
      customId: BUTTON.vote(question.token, index),
      ...(closed ? { disabled: true } : {})
    }))
  });

  const material = first.material ?? ``;
  const picture: InCard[] =
    first.material === undefined
      ? []
      : first.image === undefined
        ? [{ type: ComponentType.TextDisplay, content: passageBlock(material) }]
        : [
            {
              type: ComponentType.MediaGallery,
              items: [
                {
                  media: { url: first.image },
                  description: fitAlt(bare(material).replace(/\n/gu, ` / `))
                }
              ]
            },
            {
              type: ComponentType.TextDisplay,
              content: withReadings(``, material).trimStart()
            }
          ];

  const asks = view.questions.flatMap((question, index) => [
    ...(index > 0 || first.material === undefined
      ? [{ type: ComponentType.TextDisplay as const, content: stem(question) }]
      : []),
    { type: ComponentType.TextDisplay as const, content: optionsOf(question) },
    numberRow(question)
  ]);

  return [
    {
      type: ComponentType.Container,
      accentColor: closed ? SLATE : INDIGO,
      components: [
        { type: ComponentType.TextDisplay, content: headingOf(view, closed) },
        {
          type: ComponentType.TextDisplay,
          content: `-# ${display(INSTRUCTIONS[first.mondai])}`
        },
        ...(first.intro === undefined
          ? []
          : [
              {
                type: ComponentType.TextDisplay as const,
                content: withReadings(bare(first.intro), first.intro)
              }
            ]),
        ...(first.material === undefined
          ? [
              {
                type: ComponentType.TextDisplay as const,
                content: passageBlock(first.prompt)
              }
            ]
          : [
              {
                type: ComponentType.TextDisplay as const,
                content: stem(first)
              },
              ...picture
            ]),
        { type: ComponentType.Separator, divider: true, spacing: 1 },
        ...asks
      ]
    },
    ...endRow(closed)
  ];
};

const questionBody = (
  view: QuestionView,
  closed: boolean
): MessageComponent => {
  const first = view.questions.at(0);
  if (first === undefined) return [];
  if (isReading(first)) return readingBody(view, closed);
  const heading = headingOf(view, closed);

  const rows =
    view.questions.length === 1
      ? [optionRow(first, closed)]
      : view.questions.flatMap((question) => [
          {
            type: ComponentType.TextDisplay as const,
            content: `**［${String(question.number)}］**`
          },
          optionRow(question, closed)
        ]);

  return [
    {
      type: ComponentType.Container,
      accentColor: closed ? SLATE : INDIGO,
      components: [
        { type: ComponentType.TextDisplay, content: heading },
        {
          type: ComponentType.TextDisplay,
          content: `-# ${display(INSTRUCTIONS[first.mondai])}`
        },
        ...(first.intro === undefined
          ? []
          : [
              {
                type: ComponentType.TextDisplay as const,
                content: display(first.intro)
              }
            ]),
        {
          type: ComponentType.TextDisplay,
          content:
            first.mondai === 3
              ? passageBlock(first.prompt)
              : sentenceBlock(first.prompt)
        },
        { type: ComponentType.Separator, divider: true, spacing: 1 },
        ...rows
      ]
    },
    // Outside the card, and only while open: a closed card has nothing left
    // to end.
    ...endRow(closed)
  ];
};

/** The card the channel answers, with its clock running. */
export const questionMessage = (view: QuestionView): MessageComponent =>
  questionBody(view, false);

/** The same card once its timer has ended. Edited over the original. */
export const closedQuestionMessage = (view: QuestionView): MessageComponent =>
  questionBody(view, true);

/** A bar wide enough to read at a glance. */
const BAR_WIDTH = 10;

const bar = (count: number, max: number): string => {
  if (max === 0) return `░`.repeat(BAR_WIDTH);
  const filled = Math.round((count / max) * BAR_WIDTH);
  return `${`█`.repeat(filled)}${`░`.repeat(BAR_WIDTH - filled)}`;
};

/** "2 of 3 correct", or that nobody answered. */
const summaryOf = (tally: Tally): string => {
  const voted = tally.counts.reduce((sum, count) => sum + count, 0);
  return voted === 0
    ? `Nobody answered.`
    : `${String(tally.scorers.length)} of ${String(voted)} correct`;
};

/** How the room answered one question: a bar per option. */
const distribution = (question: ExamQuestion, tally: Tally): string => {
  const max = Math.max(0, ...tally.counts);
  return question.options
    .map((option, index) => {
      const count = tally.counts.at(index) ?? 0;
      const graph = `${bar(count, max)} \`${String(count)}\``;
      return index === question.correct
        ? `**${String(index + 1)}** ${graph} **${display(option)}** ✅`
        : `${String(index + 1)} ${graph} ${display(option)}`;
    })
    .join(`\n`);
};

/**
 * The answers, why, and how the room answered.
 *
 * The distribution is shown only now that the card has closed. While it was
 * open, "3 picked 2" would have leaked the answer.
 *
 * A passage card reveals as one: the passage with every answer in place and
 * underlined, then each blank's answer and note, then the English. Without
 * the bars, which four times over would bury the passage.
 */
export const revealMessage = (
  results: ReadonlyArray<{ question: ExamQuestion; tally: Tally }>
): MessageComponent => {
  const only = results.at(0);
  if (only === undefined) return [];
  if (isReading(only.question)) return readingReveal(results);

  if (results.length === 1) {
    const { question, tally } = only;
    const answer = display(question.options.at(question.correct) ?? ``);
    return [
      {
        type: ComponentType.Container,
        accentColor: MOSS,
        components: [
          // The answer underlined, not bold: the sentence is a heading, and a
          // bold answer vanished into it in the first live test.
          {
            type: ComponentType.TextDisplay,
            content: sentenceBlock(question.answered)
          },
          {
            type: ComponentType.TextDisplay,
            content: `✅ **${String(question.correct + 1)} ${answer}** · ${summaryOf(tally)}${
              question.en === `` ? `` : `\n_${question.en}_`
            }`
          },
          {
            type: ComponentType.TextDisplay,
            content: `${display(question.note)}${reviewLine(question.review)}`
          },
          { type: ComponentType.Separator, divider: true, spacing: 1 },
          {
            type: ComponentType.TextDisplay,
            content: distribution(question, tally)
          }
        ]
      }
    ];
  }

  const blanks = results
    .map(({ question, tally }) => {
      const answer = display(question.options.at(question.correct) ?? ``);
      return `✅ **［${String(question.number)}］ ${String(question.correct + 1)} ${answer}** · ${summaryOf(tally)}\n${display(question.note)}${reviewLine(question.review)}`;
    })
    .join(`\n\n`);
  const en = results
    .map(({ question }) => question.en)
    .find((text) => text !== ``);

  return [
    {
      type: ComponentType.Container,
      accentColor: MOSS,
      components: [
        {
          type: ComponentType.TextDisplay,
          content: passageBlock(only.question.answered)
        },
        { type: ComponentType.Separator, divider: true, spacing: 1 },
        { type: ComponentType.TextDisplay, content: blanks },
        ...(en === undefined
          ? []
          : [{ type: ComponentType.TextDisplay as const, content: `_${en}_` }])
      ]
    }
  ];
};

/**
 * A reading card's reveal: for each question, its stem, the answer, the note and how the room answered, then the English once.
 *
 * Never the text again: the closed card sits just above. And never a why: each student who chose wrong is told theirs privately, which keeps the channel short (the user's choice, 2026-11-22). The note stays public, so a student who did not vote still learns where the answer was.
 */
const readingReveal = (
  results: ReadonlyArray<{ question: ExamQuestion; tally: Tally }>
): MessageComponent => {
  const several = results.length > 1;
  const parts = results.flatMap(({ question, tally }, index) => {
    const answer = display(question.options.at(question.correct) ?? ``);
    const stem = bare(question.question ?? ``).replace(/\n/gu, ` `);
    return [
      ...(index > 0
        ? [
            {
              type: ComponentType.Separator as const,
              divider: true,
              spacing: 1 as const
            }
          ]
        : []),
      {
        type: ComponentType.TextDisplay as const,
        content: `${several ? `**［${String(question.number)}］** ` : ``}${stem}\n✅ **${String(question.correct + 1)} ${answer}** · ${summaryOf(tally)}\n${display(question.note)}${reviewLine(question.review)}`
      },
      {
        type: ComponentType.TextDisplay as const,
        content: distribution(question, tally)
      }
    ];
  });
  const en = results
    .map(({ question }) => question.en)
    .find((text) => text !== ``);

  return [
    {
      type: ComponentType.Container,
      accentColor: MOSS,
      components: [
        ...parts,
        ...(en === undefined
          ? []
          : [{ type: ComponentType.TextDisplay as const, content: `_${en}_` }])
      ]
    }
  ];
};

/**
 * One student's private follow-up on a reading card: why each wrong option they ended on is wrong.
 *
 * Null when there is nothing to say: they chose right, or chose an option the item does not explain (an easy question's note, public in the reveal, covers those).
 */
export const followUpText = (
  picks: ReadonlyArray<{ question: ExamQuestion; chose: number }>
): string | null => {
  const parts = picks.flatMap(({ question, chose }) => {
    if (chose === question.correct) return [];
    const why = question.whys?.at(chose) ?? ``;
    if (why === ``) return [];
    const mine = display(question.options.at(chose) ?? ``);
    const right = display(question.options.at(question.correct) ?? ``);
    return [
      `**${String(question.number)}.** You chose **${String(chose + 1)} ${mine}**.\n${display(why)}\nThe answer is **${String(question.correct + 1)} ${right}**.${reviewLine(question.review)}`
    ];
  });
  return parts.length === 0 ? null : parts.join(`\n\n`);
};

/**
 * Before question one: what the test is and how it works.
 *
 * A live countdown until the test starts, then an absolute time. Discord keeps
 * ticking a relative timestamp forever, so the intro is edited once when
 * question one opens — otherwise it says "starts 12 minutes ago" mid-test.
 */
export const introMessage = (
  test: TestId,
  questions: number,
  /** Epoch seconds when question one opens, or opened. */
  startsAt: number,
  started = false
): MessageComponent => [
  {
    type: ComponentType.Container,
    accentColor: INDIGO,
    components: [
      {
        type: ComponentType.TextDisplay,
        content: `## ${TEST_NAMES[test]} mock test\n${String(questions)} questions · ${
          started
            ? `started at <t:${String(startsAt)}:t>`
            : `starts <t:${String(startsAt)}:R>`
        }`
      },
      {
        type: ComponentType.TextDisplay,
        content: [
          `Anyone can answer. Press a number to vote.`,
          `Your vote is private, and you can change it until the question closes.`,
          `Everyone who is right scores; speed does not matter. Harder questions are worth more.`
        ].join(`\n`)
      }
    ]
  }
];

/**
 * The real pass line, as a guide.
 *
 * N5 needs 38 of 120 in vocabulary, grammar and reading together. The JLPT
 * scales its scores, so a percentage here is a guide, not an equivalent.
 */
const GUIDE = `-# The real N5 needs at least 38 of 120 (32%) across vocabulary, grammar and reading. The JLPT scales its scores, so use this as a guide, not a prediction.`;

const percent = (points: number, max: number): string =>
  max === 0 ? `0%` : `${String(Math.round((points / max) * 100))}%`;

/** Medals for the top three, so the card reads at a glance. */
const PLACES = [`🥇`, `🥈`, `🥉`];

/** The end of a test: everyone's score, and a way to see your own detail. */
export const resultsMessage = (
  test: TestId,
  testId: string,
  results: readonly Result[]
): MessageComponent => {
  const board =
    results.length === 0
      ? `_Nobody answered any questions._`
      : results
          .map(
            (result, index) =>
              `${PLACES.at(index) ?? `\`${String(index + 1)}.\``} <@${result.userId}> **${String(result.points)}** / ${String(result.max)} · ${percent(result.points, result.max)} · ${String(result.correct)} of ${String(result.asked)} correct`
          )
          .join(`\n`);

  return [
    {
      type: ComponentType.Container,
      accentColor: MOSS,
      components: [
        {
          type: ComponentType.TextDisplay,
          content: `## ${TEST_NAMES[test]} results`
        },
        { type: ComponentType.TextDisplay, content: board },
        { type: ComponentType.Separator, divider: true, spacing: 1 },
        { type: ComponentType.TextDisplay, content: GUIDE }
      ]
    },
    ...(results.length === 0
      ? []
      : [
          {
            type: ComponentType.ActionRow as const,
            components: [
              {
                type: ComponentType.Button as const,
                style: ButtonStyle.Primary as const,
                label: `My results`,
                customId: BUTTON.results(testId)
              }
            ]
          }
        ])
  ];
};

/** Said when review links were left out of My results to fit. */
const LINKS_LEFT_OUT = `-# Some review links did not fit here. The answer card for each question has them.`;

/**
 * One player's answers, privately.
 *
 * Plain text in an ephemeral reply: it is for one person, and every missed
 * question shows the right answer beside theirs, with where to review it.
 *
 * A reply's content is capped at 2,000 characters, and a test with many misses can carry more links than that. So the links go from the last miss back until the reply fits. The answers always stay, and every answer card above has the links.
 */
export const myResultsText = (
  questions: readonly ExamQuestion[],
  answers: readonly Answer[],
  result: Result | undefined
): string => {
  const head =
    result === undefined
      ? `**Your results** · you did not answer any questions.`
      : `**Your results** · ${String(result.points)} / ${String(result.max)} points (${percent(result.points, result.max)}) · ${String(result.correct)} of ${String(result.asked)} correct`;

  const lines = answers.map((answer) => {
    const number = String(answer.number);
    const question = questions.find((q) => q.number === answer.number);
    if (question === undefined) {
      return { text: `${number} ?`, links: ``, why: `` };
    }
    const right = display(question.options.at(question.correct) ?? ``);
    if (answer.correct) {
      return { text: `${number} ✅ ${right}`, links: ``, why: `` };
    }
    const chose =
      answer.chose === null
        ? `no answer`
        : display(question.options.at(answer.chose) ?? ``);
    // A reading why, kept here because the private follow-up disappears when Discord reloads; this is where a student reads it again.
    const why =
      answer.chose === null ? `` : (question.whys?.at(answer.chose) ?? ``);
    return {
      text: `${number} ❌ ${chose} → **${right}**`,
      links: reviewLinks(question.review),
      why: why === `` ? `` : `\n> ${display(why)}`
    };
  });

  /** The reply with links on the first `kept` lines only. */
  const withLinks = (kept: number): string => {
    const leftOut = lines.slice(kept).some((line) => line.links !== ``);
    return [
      head,
      // Links go before the why, so they stay on the answer's line. Only links are dropped to fit: a why is the reason this reply exists.
      ...lines.map(
        (line, index) =>
          `${
            index < kept && line.links !== ``
              ? `${line.text} · ${line.links}`
              : line.text
          }${line.why}`
      ),
      ...(leftOut ? [LINKS_LEFT_OUT] : []),
      GUIDE
    ].join(`\n`);
  };

  for (let kept = lines.length; kept > 0; kept -= 1) {
    const text = withLinks(kept);
    if (text.length <= CONTENT_MAX) return text;
  }
  return withLinks(0);
};

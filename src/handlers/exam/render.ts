import {
  ButtonStyle,
  ComponentType,
  type MessageComponent
} from "@discordkit/client";
import type { Mondai, TestId } from "./blueprint.js";
import { OPTION_COUNT, type ExamQuestion } from "./draw.js";
import { BLANK, display, fill, partsOf } from "./items.js";
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
  bunpou: `文法(ぶんぽう) · N5`
};

/**
 * The paper's instruction line for each type, in its own wording.
 *
 * Markup, so the kanji carry readings as on the paper.
 */
export const INSTRUCTIONS: Readonly<Record<Mondai, string>> = {
  1: `${BLANK}に {何|なに}を {入|い}れますか。1・2・3・4から いちばん いい ものを {一|ひと}つ えらんで ください。`
};

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

/** Fit a label inside Discord's limit. The full text is in the reveal. */
export const fitLabel = (text: string): string =>
  text.length <= LABEL_MAX ? text : `${text.slice(0, LABEL_MAX - 1)}…`;

/** What a question card needs beyond the question itself. */
export interface QuestionView {
  question: ExamQuestion;
  /** How many questions the test has. */
  total: number;
  /** Epoch seconds, rendered by the client as a live countdown. */
  endsAt: number;
  /** How many have answered: a count, never a distribution. */
  voters?: number;
}

/**
 * The question, open or closed.
 *
 * One builder for both, because the message is EDITED in place when the timer
 * ends, and any difference beyond the closed state would read as the message
 * rewriting itself.
 */
const questionBody = (
  view: QuestionView,
  closed: boolean
): MessageComponent => {
  const { question } = view;
  const voters =
    view.voters === undefined || view.voters === 0
      ? ``
      : ` · ${String(view.voters)} answered`;
  // A relative timestamp is ticked down by the client for free. It must be
  // replaced on close, or it goes on saying "ends 5 minutes ago" forever.
  const heading = `**もんだい${String(question.mondai)}** · ${String(question.number)} / ${String(view.total)} · ${
    closed ? `closed` : `ends <t:${String(view.endsAt)}:R>`
  }${voters}`;

  return [
    {
      type: ComponentType.Container,
      accentColor: closed ? SLATE : INDIGO,
      components: [
        { type: ComponentType.TextDisplay, content: heading },
        {
          type: ComponentType.TextDisplay,
          content: `-# ${display(INSTRUCTIONS[question.mondai])}`
        },
        {
          type: ComponentType.TextDisplay,
          content: heading2(display(question.prompt))
        },
        { type: ComponentType.Separator, divider: true, spacing: 1 },
        {
          type: ComponentType.ActionRow,
          components: question.options.map((option, index) => ({
            type: ComponentType.Button as const,
            style: ButtonStyle.Secondary as const,
            // Numbered as on the paper, so the reveal can refer to "2".
            label: fitLabel(`${String(index + 1)} ${display(option)}`),
            customId: BUTTON.vote(question.token, index),
            // Disabled rather than removed, so the layout the channel scrolled
            // past stays put and the numbers still match the reveal.
            ...(closed ? { disabled: true } : {})
          }))
        }
      ]
    },
    // Outside the card, and only while open: a closed question has nothing
    // left to end.
    ...(closed
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
        ])
  ];
};

/** The question the channel answers, with its clock running. */
export const questionMessage = (view: QuestionView): MessageComponent =>
  questionBody(view, false);

/** The same question once its timer has ended. Edited over the original. */
export const closedQuestionMessage = (view: QuestionView): MessageComponent =>
  questionBody(view, true);

/** The sentence with its answer filled in and marked. */
export const answeredSentence = (question: ExamQuestion): string => {
  const answer = question.options.at(question.correct) ?? ``;
  // Each part bold on its own: a pair answer (は／は) fills two blanks, and one
  // pair of asterisks around both would span the text between them.
  const marked = partsOf(answer)
    .map((part) => `**${part}**`)
    .join(`／`);
  return display(fill(question.prompt, new Map([[question.slot, marked]])));
};

/** A bar wide enough to read at a glance. */
const BAR_WIDTH = 10;

const bar = (count: number, max: number): string => {
  if (max === 0) return `░`.repeat(BAR_WIDTH);
  const filled = Math.round((count / max) * BAR_WIDTH);
  return `${`█`.repeat(filled)}${`░`.repeat(BAR_WIDTH - filled)}`;
};

/**
 * The answer, why, and how the room answered.
 *
 * The distribution is shown only now that the question has closed. While it was
 * open, "3 picked 2" would have leaked the answer.
 */
export const revealMessage = (
  question: ExamQuestion,
  tally: Tally
): MessageComponent => {
  const max = Math.max(0, ...tally.counts);
  const voted = tally.counts.reduce((sum, count) => sum + count, 0);
  const answer = display(question.options.at(question.correct) ?? ``);

  const rows = question.options
    .map((option, index) => {
      const count = tally.counts.at(index) ?? 0;
      const graph = `${bar(count, max)} \`${String(count)}\``;
      return index === question.correct
        ? `**${String(index + 1)}** ${graph} **${display(option)}** ✅`
        : `${String(index + 1)} ${graph} ${display(option)}`;
    })
    .join(`\n`);

  const summary =
    voted === 0
      ? `Nobody answered.`
      : `${String(tally.scorers.length)} of ${String(voted)} correct`;

  return [
    {
      type: ComponentType.Container,
      accentColor: MOSS,
      components: [
        {
          type: ComponentType.TextDisplay,
          content: heading2(answeredSentence(question))
        },
        {
          type: ComponentType.TextDisplay,
          content: `✅ **${String(question.correct + 1)} ${answer}** · ${summary}\n_${question.en}_`
        },
        { type: ComponentType.TextDisplay, content: display(question.note) },
        { type: ComponentType.Separator, divider: true, spacing: 1 },
        { type: ComponentType.TextDisplay, content: rows }
      ]
    }
  ];
};

/** Before question one: what the test is and how it works. */
export const introMessage = (
  test: TestId,
  questions: number,
  /** Epoch seconds when question one opens. */
  startsAt: number
): MessageComponent => [
  {
    type: ComponentType.Container,
    accentColor: INDIGO,
    components: [
      {
        type: ComponentType.TextDisplay,
        content: `## ${TEST_NAMES[test]} mock test\n${String(questions)} questions · starts <t:${String(startsAt)}:R>`
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

/**
 * One player's answers, privately.
 *
 * Plain text in an ephemeral reply: it is for one person, and every missed
 * question shows the right answer beside theirs.
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
    if (question === undefined) return `${number} ?`;
    const right = display(question.options.at(question.correct) ?? ``);
    if (answer.correct) return `${number} ✅ ${right}`;
    const chose =
      answer.chose === null
        ? `no answer`
        : display(question.options.at(answer.chose) ?? ``);
    return `${number} ❌ ${chose} → **${right}**`;
  });

  return [head, ...lines, GUIDE].join(`\n`);
};

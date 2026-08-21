import type { Form } from "./forms.js";
import type { Question } from "./question.js";
import type { VerbClass } from "./wordClass.js";

/**
 * Turning quiz state into what the channel sees.
 *
 * Pure functions returning plain objects: nothing here calls Discord, so every
 * message the bot can post is testable without a network, a token, or the
 * Workers runtime. The handler's job is to take these and send them.
 *
 * Discord has no furigana. The reference site uses `<ruby>`, which has no
 * equivalent in a message, so a reading is written the way a dictionary writes
 * it — 売る（うる）— and kanji is only ever shown alongside its reading.
 */

/** How each form is named to a player. */
const FORM_LABELS: Record<Form, string> = {
  "non-past-affirmative": `Non-past`,
  "non-past-negative": `Non-past negative`,
  "past-affirmative": `Past`,
  "past-negative": `Past negative`,
  "te-form": `Te-form`,
  potential: `Potential`,
  volitional: `Volitional`,
  imperative: `Imperative`,
  "conditional-tara": `Conditional 〜たら`,
  "provisional-eba": `Provisional 〜ば`,
  "conditional-nara": `Conditional 〜なら`,
  passive: `Passive`,
  causative: `Causative`,
  "causative-passive": `Causative-passive`
};

export const formLabel = (form: Form): string => FORM_LABELS[form];

/** How each verb class is named to a player. */
const CLASS_LABELS: Record<VerbClass, string> = {
  ichidan: `Ichidan (る-verb)`,
  "godan-u": `Godan (-う)`,
  "godan-k": `Godan (-く)`,
  "godan-g": `Godan (-ぐ)`,
  "godan-s": `Godan (-す)`,
  "godan-t": `Godan (-つ)`,
  "godan-n": `Godan (-ぬ)`,
  "godan-b": `Godan (-ぶ)`,
  "godan-m": `Godan (-む)`,
  "godan-r": `Godan (-る)`,
  "godan-iku": `Godan (行く exception)`,
  "irregular-suru": `Irregular (する)`,
  "irregular-kuru": `Irregular (来る)`
};

export const classLabel = (question: Question): string => {
  if (question.verbClass !== undefined) return CLASS_LABELS[question.verbClass];
  return question.type === `adj-i`
    ? `い-adjective`
    : question.type === `adj-na`
      ? `な-adjective`
      : `Noun`;
};

/**
 * A word written for a learner: kanji with its reading, or just the reading.
 *
 * Discord cannot render ruby annotations, so the reading goes in full-width
 * parentheses beside the kanji the way a dictionary prints it. When the entry
 * has no kanji, the reading stands alone rather than being repeated.
 */
export const withReading = (dictionary: string, reading: string): string =>
  dictionary === reading ? dictionary : `${dictionary}（${reading}）`;

/** The subset of a Discord embed this bot builds. */
export interface Embed {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
}

// Discord renders the left border in these. Chosen for meaning rather than
// brand: the correct answer is the only green thing the bot posts.
const VERMILION = 0xc8_49_2b;
const MOSS = 0x4a_6b_45;
const INDIGO = 0x2f_4b_6e;

/**
 * The question the channel races to answer.
 *
 * The prompt is the largest thing in the message, because it is what players
 * are reading. The target form is a field rather than part of the title so it
 * stays legible next to a long word.
 */
export const questionEmbed = (
  question: Question,
  questionNumber: number,
  total: number | null
): Embed => ({
  title: `Question ${String(questionNumber)}${total === null ? `` : ` of ${String(total)}`}`,
  description: `## ${question.prompt}`,
  color: INDIGO,
  fields: [
    { name: `Target`, value: formLabel(question.form), inline: true },
    { name: `Class`, value: classLabel(question), inline: true }
  ],
  footer: { text: `Type your answer in the channel` }
});

/** One player's attempt, as the reveal embed lists it. */
export interface AttemptLine {
  userId: string;
  answer: string;
  correct: boolean;
}

/**
 * What the channel is shown once the question closes.
 *
 * This is the teaching moment, and it lands only now — a wrong answer gets a
 * silent ❌ while the race is still running, so nothing is leaked to the
 * players still thinking. See `docs/specs/conjugation-quiz.md` §3 for why a
 * private reply is impossible here.
 */
export const revealEmbed = (
  question: Question,
  outcome: { winner: string | null },
  attempts: readonly AttemptLine[]
): Embed => {
  const won = outcome.winner !== null;
  const fields: Embed[`fields`] = [
    {
      name: `Answer`,
      value: withReading(
        question.answerKanji ?? question.answer,
        question.answer
      )
    },
    {
      name: `Dictionary`,
      value: withReading(question.dictionary, question.reading),
      inline: true
    },
    { name: `Class`, value: classLabel(question), inline: true },
    { name: `Meaning`, value: question.gloss }
  ];

  if (question.example !== undefined) {
    fields.push({
      name: `Example`,
      value: `${question.example.jpn}\n${question.example.eng}`
    });
  }

  if (attempts.length > 0) {
    fields.push({
      name: `Attempts`,
      value: attempts
        .map((a) => `${a.correct ? `⭕` : `❌`} <@${a.userId}> ${a.answer}`)
        .join(`\n`)
    });
  }

  return {
    title: won ? `<@${outcome.winner ?? ``}> got it` : `Nobody got it in time`,
    color: won ? MOSS : VERMILION,
    fields
  };
};

/** The final standings. */
export const scoresEmbed = (
  standings: ReadonlyArray<{ userId: string; points: number }>,
  asked: number
): Embed => ({
  title: `Session complete`,
  description:
    standings.length === 0
      ? `No answers this session.`
      : standings
          .map(
            (s, i) =>
              `${i === 0 ? `🥇` : i === 1 ? `🥈` : i === 2 ? `🥉` : `　`} <@${s.userId}> — ${String(s.points)}`
          )
          .join(`\n`),
  color: INDIGO,
  footer: { text: `${String(asked)} question${asked === 1 ? `` : `s`} asked` }
});

/**
 * The private nudge `/hint` gives.
 *
 * Deliberately short of the answer: the reading and the meaning are enough to
 * unstick someone without handing them the conjugation, so a hint costs the
 * rest of the channel nothing.
 */
export const hintEmbed = (question: Question): Embed => ({
  title: `Hint`,
  description: withReading(question.dictionary, question.reading),
  color: INDIGO,
  fields: [
    { name: `Meaning`, value: question.gloss },
    { name: `Target`, value: formLabel(question.form), inline: true },
    { name: `Class`, value: classLabel(question), inline: true }
  ]
});

/** Told to the channel when the filters match nothing. */
export const noWordsMessage = `No words match those filters. Try widening the level or word type — some combinations are empty, like N4 with ぬ-verbs, and adjectives have no verb class at all.`;

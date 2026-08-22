import {
  ButtonStyle,
  ComponentType,
  type ActionRow,
  type Embed
} from "@discordkit/client";
import { isBasic, type Form, type WordType } from "./forms.js";
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

/**
 * A Discord embed, as the client models it.
 *
 * Re-exported rather than redefined. A hand-rolled shape here compiled fine but
 * did not structurally match `@discordkit/client`'s, which is why the effects
 * layer needed a cast to hand these to `createMessage` — and a cast is exactly
 * the thing that would stop complaining if the two ever diverged.
 */
export type { Embed } from "@discordkit/client";

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
    // What the prompt already IS, alongside what is wanted. Without it the
    // transformation has to be inferred from the word itself, and 見せません
    // against 見せない is hard to tell apart at a glance — the player cannot
    // see whether the prompt is already in the target form.
    { name: `From`, value: promptLabel(question), inline: true },
    {
      name: `Target`,
      value: `${formLabel(question.form)} (plain)`,
      inline: true
    },
    { name: `Class`, value: classLabel(question), inline: true }
  ],
  footer: { text: `Type your answer in the channel` }
});

/**
 * What form the prompt is in.
 *
 * A basic form is asked from its own polite counterpart, so the prompt is that
 * same form in the polite register; everything else is asked from the
 * dictionary form. Saying so removes the guesswork about what is being
 * converted, which is the part that reads as ambiguous in the channel.
 */
export const promptLabel = (question: Question): string =>
  isBasic(question.form)
    ? `${formLabel(question.form)} (polite)`
    : `Dictionary form`;

/**
 * The custom ids a question's buttons carry.
 *
 * Discord echoes these back on the interaction, so they are the routing key.
 * Named as constants because a typo would produce a button that silently does
 * nothing — the interaction arrives, matches no case, and the player sees
 * "this interaction failed".
 */
export const BUTTON = {
  hint: `quiz:hint`,
  end: `quiz:end`
} as const;

/**
 * The controls under a question.
 *
 * `/hint` still works, but a button is where someone stuck on a conjugation
 * actually looks — and it costs them no typing in a channel where typing is
 * how you answer.
 *
 * Built from the client's component types rather than hand-rolled objects, so
 * the shape is checked against the same schema `createMessage` validates
 * against.
 */
export const questionButtons = (): ActionRow[] => [
  {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        label: `Hint`,
        customId: BUTTON.hint
      },
      {
        type: ComponentType.Button,
        style: ButtonStyle.Danger,
        label: `End session`,
        customId: BUTTON.end
      }
    ]
  }
];

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
  outcome: { winner: string | null; points?: number; total?: number },
  attempts: readonly AttemptLine[]
): Embed => {
  const won = outcome.winner !== null;
  const { points, total } = outcome;
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
    // The winner goes in the description, never the title. Discord does not
    // resolve mention markup in an embed title — it renders the raw
    // `<@123…>` — but it does in a description or a field value, which is why
    // the Attempts list below shows names correctly.
    title: won ? `Correct` : `Nobody got it in time`,
    ...(outcome.winner === null
      ? {}
      : {
          // What this answer earned, then the running total. Reporting only
          // the total made a late answer read as though one question were
          // worth twenty points, which is exactly what left the final
          // leaderboard looking arbitrary.
          description: `<@${outcome.winner}> got it${
            points === undefined
              ? ``
              : ` — **+${String(points)}**${total === undefined ? `` : ` (${String(total)} total)`}`
          }`
        }),
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

/**
 * What the channel is shown before the first question.
 *
 * A session starts with a burst of rules nobody agreed to — how many guesses,
 * how long each question stays open, what is being drilled. Posting them once,
 * with a pause before question one, means the first question is not also the
 * moment everyone works out how the game runs.
 */
export const introEmbed = (
  settings: {
    filters: { levels: readonly number[]; types: readonly WordType[] };
    session: { length: number | null; timeoutMs: number; guesses: number };
  },
  startsInSeconds: number
): Embed => {
  const { levels, types } = settings.filters;
  const { length, timeoutMs, guesses } = settings.session;

  return {
    title: `Conjugation practice`,
    description: `Answer by typing in the channel. First correct answer takes the question.`,
    color: INDIGO,
    fields: [
      {
        name: `Questions`,
        value: length === null ? `Endless` : String(length),
        inline: true
      },
      {
        name: `Time each`,
        value: `${String(Math.round(timeoutMs / 1000))}s`,
        inline: true
      },
      {
        name: `Guesses each`,
        value: String(guesses),
        inline: true
      },
      {
        name: `Drilling`,
        value: `${levels.length === 0 ? `Any level` : levels.map((l) => `N${String(l)}`).join(`, `)} · ${types.join(`, `)}`
      },
      {
        // Named so the taper is understood before it matters, rather than
        // inferred later from a leaderboard that does not add up.
        name: `Scoring`,
        value: `${String(guesses + 1)} points for a first-guess answer, one less for each miss. \`/hint\` is free.`
      }
    ],
    footer: { text: `First question in ${String(startsInSeconds)} seconds…` }
  };
};

/** A mid-session standings update, so a long run has a visible shape. */
export const standingsEmbed = (
  standings: ReadonlyArray<{ userId: string; points: number }>,
  afterQuestion: number,
  pauseSeconds: number
): Embed => ({
  title: `Standings after ${String(afterQuestion)} questions`,
  description:
    standings.length === 0
      ? `Nobody has scored yet.`
      : standings.map(
          (s, i) =>
            `${i === 0 ? `🥇` : i === 1 ? `🥈` : i === 2 ? `🥉` : `　`} <@${s.userId}> — ${String(s.points)}`
        ).join(`
`),
  color: INDIGO,
  footer: { text: `Next question in ${String(pauseSeconds)} seconds…` }
});

/** Told to the channel when the filters match nothing. */
export const noWordsMessage = `No words match those filters. Try widening the level or word type — some combinations are empty, like N4 with ぬ-verbs, and adjectives have no verb class at all.`;

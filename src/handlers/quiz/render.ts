import {
  ButtonStyle,
  ComponentType,
  type ActionRow,
  type Embed
} from "@discordkit/client";
import { compoundGist, COMPOUND_LABELS } from "./compound.js";
import {
  isBasic,
  isCompound,
  type Askable,
  type Form,
  type WordType
} from "./forms.js";
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

export const formLabel = (form: Askable): string =>
  isCompound(form) ? COMPOUND_LABELS[form] : FORM_LABELS[form];

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
      // A construction names itself; only an inflection needs its register
      // spelled out, since 〜てしまう has no polite/plain distinction to make.
      name: `Target`,
      value: isCompound(question.form)
        ? formLabel(question.form)
        : `${formLabel(question.form)} (plain)`,
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
  !isCompound(question.form) && isBasic(question.form)
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
 * The confirm button on `/privacy forget`.
 *
 * Carries the user and scope, because the deletion is irreversible and a
 * `customId` is a plain string. The handler checks the id names whoever
 * pressed it, so a crafted press cannot erase somebody else.
 */
export const forgetButton = (userId: string, everywhere: boolean): string =>
  `privacy:forget:${userId}:${everywhere ? `everywhere` : `guild`}`;

export const readForgetButton = (
  customId: string
): { userId: string; everywhere: boolean } | null => {
  const match =
    /^privacy:forget:(?<userId>\d+):(?<scope>everywhere|guild)$/u.exec(
      customId
    );
  if (match?.groups === undefined) return null;
  return {
    userId: match.groups.userId ?? ``,
    everywhere: match.groups.scope === `everywhere`
  };
};

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

  // What the construction itself means, which the word's own gloss does not
  // say: 食べてしまう is not just "to eat". This is the teaching the higher
  // levels exist for.
  if (isCompound(question.form)) {
    fields.push({
      name: formLabel(question.form),
      value: compoundGist(question.form)
    });
  }

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
 * The guild's standing leaderboard, across every session.
 *
 * Separate from {@link scoresEmbed}, which reports one session. The two answer
 * different questions — "who won just now" and "who plays here" — and merging
 * them would make the first one wrong every time somebody new joined.
 *
 * Accuracy is shown alongside points because points reward speed as much as
 * knowledge: someone who answers carefully and correctly deserves to see that
 * reflected somewhere, and the taper alone does not show it.
 */
export const leaderboardEmbed = (
  standings: ReadonlyArray<{
    userId: string;
    points: number;
    correct: number;
    sessions: number;
  }>,
  guildName?: string
): Embed => ({
  title: guildName === undefined ? `Leaderboard` : `${guildName} leaderboard`,
  description:
    standings.length === 0
      ? `Nobody has finished a session here yet. Start one with \`/quiz start\`.`
      : standings.map(
          (s, i) =>
            `${i === 0 ? `🥇` : i === 1 ? `🥈` : i === 2 ? `🥉` : `　`} <@${s.userId}> — **${String(s.points)}** · ${String(s.correct)} correct in ${String(s.sessions)} session${s.sessions === 1 ? `` : `s`}`
        ).join(`
`),
  color: INDIGO
});

/** Leads with the player, not their rank: 7th means little without a total. */
export const standingEmbed = (
  userId: string,
  standing: {
    points: number;
    correct: number;
    sessions: number;
  } | null
): Embed => ({
  title: `Standing`,
  description:
    standing === null
      ? `<@${userId}> has not finished a session here yet.`
      : `<@${userId}> — **${String(standing.points)}** points, ${String(standing.correct)} correct across ${String(standing.sessions)} session${standing.sessions === 1 ? `` : `s`}.`,
  color: INDIGO
});

/**
 * A private second look at a question you got wrong.
 *
 * The reveal taught this once publicly, then scrolled away — and it lists
 * everybody's attempts together, so finding your own is work.
 */
export const reviewEmbed = (
  miss: { question: Question; answer: string; questionNumber: number },
  /** False when this is the last question rather than one they got wrong. */
  attempted: boolean
): Embed => {
  const { question } = miss;
  const fields: Embed[`fields`] = [];

  if (attempted) {
    fields.push({ name: `You typed`, value: `❌ ${miss.answer}` });
  }

  fields.push(
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
    { name: `Target`, value: formLabel(question.form), inline: true },
    { name: `Class`, value: classLabel(question), inline: true },
    { name: `Meaning`, value: question.gloss }
  );

  if (question.example !== undefined) {
    fields.push({
      name: `Example`,
      value: `${question.example.jpn}
${question.example.eng}`
    });
  }

  return {
    title: attempted ? `Your last miss` : `Last question`,
    description: attempted
      ? `Question ${String(miss.questionNumber)}.`
      : `You did not answer question ${String(miss.questionNumber)}.`,
    // Vermilion for a miss, moss for a question they simply did not answer —
    // the colour should not scold somebody who was not even playing.
    color: attempted ? VERMILION : MOSS,
    fields
  };
};

/**
 * The link `/feedback` hands back.
 *
 * States what the pre-filled form contains before the user opens it. A GitHub
 * issue is public and a Discord id is not secret, but publishing one is their
 * decision, so it is named rather than buried in a query string.
 */
export const feedbackEmbed = (kind: `bug` | `idea`, url: string): Embed => ({
  title: kind === `bug` ? `Report a problem` : `Suggest an idea`,
  description: [
    `**[Open the pre-filled form ↗](${url})**`,
    ``,
    `It includes your Discord user id, this server and channel id, your`,
    `language setting, the bot's build, and the current quiz settings — so a`,
    `report can be traced back to what actually happened.`,
    ``,
    `Nothing is sent until you press Submit on GitHub, and you can edit or`,
    `delete anything first.`
  ].join(`
`),
  color: INDIGO
});

/** The confirm control on a deletion preview. */
export const forgetButtons = (
  userId: string,
  everywhere: boolean
): ActionRow[] => [
  {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Danger,
        label: everywhere ? `Delete everywhere` : `Delete`,
        customId: forgetButton(userId, everywhere)
      }
    ]
  }
];

/**
 * What `/privacy forget` is about to delete.
 *
 * Shown before anything goes, and it names counts rather than saying "your
 * data" — somebody deciding whether to erase seven sessions of progress should
 * be told it is seven.
 */
export const forgetPreviewEmbed = (
  found: ReadonlyArray<{ label: string; rows: number }>,
  everywhere: boolean
): Embed => {
  const total = found.reduce((sum, entry) => sum + entry.rows, 0);
  return {
    title: everywhere ? `Forget me everywhere` : `Forget me in this server`,
    description:
      total === 0
        ? `There is nothing stored about you ${everywhere ? `in any server` : `here`}.`
        : [
            `This deletes, permanently:`,
            ``,
            ...found
              .filter((entry) => entry.rows > 0)
              .map((entry) => `• ${String(entry.rows)} × ${entry.label}`),
            ``,
            everywhere
              ? `Across every server this bot is in.`
              : `In this server only. Use \`scope:everywhere\` for all of them.`
          ].join(`
`),
    color: total === 0 ? MOSS : VERMILION
  };
};

/** What `/privacy forget` actually removed. */
export const forgottenEmbed = (
  erased: ReadonlyArray<{ label: string; rows: number }>
): Embed => {
  const total = erased.reduce((sum, entry) => sum + entry.rows, 0);
  return {
    title: `Forgotten`,
    description:
      total === 0
        ? `There was nothing to delete.`
        : [
            ...erased
              .filter((entry) => entry.rows > 0)
              .map(
                (entry) => `• ${String(entry.rows)} × ${entry.label} deleted`
              ),
            ``,
            `A session running right now keeps your answers until it ends;`,
            `those are not written to the leaderboard.`
          ].join(`
`),
    color: MOSS
  };
};

/** The current tracking preference, and how to change it. */
export const trackingEmbed = (tracked: boolean): Embed => ({
  title: tracked ? `Tracking is on` : `Tracking is off`,
  description: tracked
    ? [
        `Your scores are saved to this server's leaderboard when a session ends.`,
        ``,
        `\`/privacy tracking off\` stops that. You can still play — only the`,
        `saving stops, and nothing already stored is removed.`
      ].join(`
`)
    : [
        `Nothing you score here is saved to the leaderboard.`,
        ``,
        `You can still play, and you still appear in the standings a session`,
        `posts while it runs — those messages are not stored.`,
        ``,
        `\`/privacy tracking on\` starts saving again.`
      ].join(`
`),
  color: INDIGO
});

/** Short of the answer on purpose: enough to unstick, not to win. */
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
 * The rules, posted once before the first question.
 *
 * Otherwise question one is also the moment everyone works out how it runs.
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

import type { DiscordEffects } from "../discord.js";
import { judge, looksLikeAnswer } from "./answer.js";
import type { QuizSettings } from "./config.js";
import { generate, isQuestion, type Question, type Word } from "./question.js";
import {
  noWordsMessage,
  questionEmbed,
  revealEmbed,
  scoresEmbed,
  type AttemptLine
} from "./render.js";

/**
 * Running a round, without knowing it is Discord on the other end.
 *
 * Everything here talks to {@link DiscordEffects} rather than to the client, so
 * the whole flow — post a question, mark a guess, reveal, move on — can be
 * driven by a recording stub in a plain Node test. That is the boundary: the
 * platform lives at the edge, and the decisions live here.
 *
 * The session object is reached through {@link SessionPort} for the same
 * reason. It is a Durable Object in production, and an ordinary object in a
 * test.
 */

/** What the flow needs from a session, which a Durable Object stub satisfies. */
export interface SessionPort {
  begin: (
    channelId: string,
    question: Question,
    config: QuizSettings[`session`],
    filters: QuizSettings[`filters`]
  ) => Promise<unknown>;
  current: () => Promise<{
    state: `asking` | `revealing` | `finished`;
    context: {
      question: Question | null;
      questionNumber: number;
      config: { length: number | null };
      filters: QuizSettings[`filters`];
      attempts: AttemptLine[];
      scores: Record<string, number>;
    };
  } | null>;
  submit: (
    userId: string,
    typed: string,
    correct: boolean
  ) => Promise<{
    outcome: { kind: string; userId?: string; points?: number };
    closed?: Question;
    final?: Array<{ userId: string; points: number }>;
    needsNext: boolean;
  }>;
  next: (question: Question) => Promise<unknown>;
  configure: (settings: QuizSettings) => Promise<unknown>;
  /**
   * Fire the question timeout.
   *
   * Present so a test can drive the same transition the Durable Object's alarm
   * causes in production. The object implements it as part of its alarm
   * handler rather than as a callable method.
   */
  timeout?: (() => void) | undefined;
  end: () => Promise<Array<{ userId: string; points: number }> | null>;
}

/** Everything a round needs to run. */
export interface FlowDeps {
  discord: DiscordEffects;
  session: SessionPort;
  words: readonly Word[];
  /** Injected so tests can pin which question is chosen. */
  random?: () => number;
}

/**
 * Start a session in a channel.
 *
 * Reports the empty-filter case to the channel rather than failing silently:
 * some combinations really are empty — N4 with ぬ-verbs has no words, and
 * adjectives have no verb class — and the player is the only one who can fix
 * it.
 */
export const startSession = async (
  deps: FlowDeps,
  channelId: string,
  settings: QuizSettings
): Promise<boolean> => {
  const result = generate(deps.words, settings.filters, deps.random);
  if (!isQuestion(result)) {
    await deps.discord.say(channelId, noWordsMessage);
    return false;
  }

  await deps.session.begin(
    channelId,
    result,
    settings.session,
    settings.filters
  );
  await deps.discord.post(
    channelId,
    questionEmbed(result, 1, settings.session.length)
  );
  return true;
};

/**
 * Handle a message that might be an answer.
 *
 * Returns quietly when the channel is not playing, because every message in an
 * active channel reaches this — a channel with no session must cost nothing.
 *
 * A wrong guess gets a ❌ and nothing else. The explanation waits for the
 * reveal, so the players still thinking are not handed the answer; see
 * `docs/specs/conjugation-quiz.md` §3 for why a private reply is impossible.
 */
export const handleAnswer = async (
  deps: FlowDeps,
  channelId: string,
  messageId: string,
  userId: string,
  content: string
): Promise<void> => {
  const view = await deps.session.current();
  if (view === null || view.state !== `asking`) return;

  const question = view.context.question;
  if (question === null) return;

  const expected = {
    kana: question.answer,
    ...(question.answerKanji === undefined
      ? {}
      : { kanji: question.answerKanji }),
    stem: question.stem
  };

  // Ordinary conversation must not score. Every message in the channel reaches
  // here, so without this "lol same" takes a ❌ and costs someone an attempt.
  if (!looksLikeAnswer(content, expected)) return;

  const verdict = judge(content, expected);

  const result = await deps.session.submit(
    userId,
    verdict.normalized,
    verdict.correct
  );
  if (result.outcome.kind === `ignored`) return;

  await deps.discord.react(channelId, messageId, verdict.correct ? `⭕` : `❌`);

  if (!verdict.correct) return;
  await closeRound(deps, channelId, result);
};

/** Fire the timeout, which the Durable Object's alarm triggers. */
export const handleTimeout = async (
  deps: FlowDeps,
  channelId: string
): Promise<void> => {
  const view = await deps.session.current();
  if (view === null) return;

  // `finished` counts as well as `revealing`. On the LAST question the machine
  // runs straight from `asking` to `finished`, because `revealing` falls
  // through once the session is over — so requiring `revealing` here silently
  // dropped both the reveal and the final standings, and the session just
  // stopped.
  if (view.state === `asking`) return;

  const question = view.context.question;
  if (question !== null) {
    await deps.discord.post(
      channelId,
      revealEmbed(question, { winner: null }, view.context.attempts)
    );
  }
  await advance(deps, channelId);
};

/** Post the reveal, then either ask again or show the final standings. */
const closeRound = async (
  deps: FlowDeps,
  channelId: string,
  result: Awaited<ReturnType<SessionPort[`submit`]>>
): Promise<void> => {
  const view = await deps.session.current();
  const closed = result.closed;
  if (closed !== undefined) {
    await deps.discord.post(
      channelId,
      revealEmbed(
        closed,
        {
          winner: result.outcome.userId ?? null,
          ...(result.outcome.points === undefined
            ? {}
            : { points: result.outcome.points })
        },
        view?.context.attempts ?? []
      )
    );
  }

  if (result.final !== undefined) {
    await deps.discord.post(
      channelId,
      scoresEmbed(result.final, view?.context.questionNumber ?? 0)
    );
    return;
  }

  if (result.needsNext) await advance(deps, channelId);
};

/**
 * Ask the next question, or finish if the session has run out.
 *
 * The question is generated here rather than inside the session object, which
 * never sees the corpus — a Durable Object runs its constructor on every wake
 * from hibernation, and parsing 1.8 MB of JSON each time would spend the whole
 * CPU budget.
 */
const advance = async (deps: FlowDeps, channelId: string): Promise<void> => {
  const view = await deps.session.current();
  if (view === null || view.state === `finished`) {
    const standings = await deps.session.end();
    if (standings !== null) {
      await deps.discord.post(
        channelId,
        scoresEmbed(standings, view?.context.questionNumber ?? 0)
      );
    }
    return;
  }

  const settings = view.context;
  // The session's own filters, not fresh ones: the object hibernates between
  // questions, so this is the only place they survive from. Drawing from the
  // whole corpus here would quietly ignore the level the channel chose.
  const result = generate(deps.words, settings.filters, deps.random);
  if (!isQuestion(result)) {
    await deps.discord.say(channelId, noWordsMessage);
    return;
  }

  await deps.session.next(result);
  await deps.discord.post(
    channelId,
    questionEmbed(result, settings.questionNumber + 1, settings.config.length)
  );
};

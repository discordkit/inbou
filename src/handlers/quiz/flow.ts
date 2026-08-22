import { diagnostics } from "../diagnostics.js";
import type { DiscordEffects } from "../discord.js";
import type { ScorePort } from "../scores.js";
import { judge, looksLikeAnswer } from "./answer.js";
import type { QuizSettings } from "./config.js";
import { generate, isQuestion, type Question, type Word } from "./question.js";
import {
  introEmbed,
  noWordsMessage,
  questionButtons,
  questionEmbed,
  revealEmbed,
  scoresEmbed,
  standingsEmbed,
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
    guildId: string | null,
    question: Question,
    config: QuizSettings[`session`],
    filters: QuizSettings[`filters`]
  ) => Promise<unknown>;
  current: () => Promise<{
    state: `asking` | `revealing` | `paused` | `finished`;
    context: {
      question: Question | null;
      questionNumber: number;
      config: {
        length: number | null;
        timeoutMs: number;
        guesses: number;
      };
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
    outcome: {
      kind: string;
      userId?: string;
      /** What this answer earned. */
      points?: number;
      /** Their session total afterwards. */
      total?: number;
    };
    closed?: Question;
    final?: Array<{ userId: string; points: number }>;
    needsNext: boolean;
  }>;
  next: (question: Question) => Promise<unknown>;
  configure: (settings: QuizSettings) => Promise<unknown>;
  pause: (ms: number) => Promise<unknown>;
  resume: () => Promise<unknown>;
  /**
   * Fire the question timeout.
   *
   * Present so a test can drive the same transition the Durable Object's alarm
   * causes in production. The object implements it as part of its alarm
   * handler rather than as a callable method.
   */
  timeout?: (() => void) | undefined;
  end: () => Promise<{
    guildId: string | null;
    standings: Array<{ userId: string; points: number }>;
    correct: Record<string, number>;
  } | null>;
}

/** How long the channel gets to read the intro before question one. */
export const INTRO_PAUSE_MS = 10_000;

/** How long the channel gets to read a mid-session standings update. */
export const STANDINGS_PAUSE_MS = 10_000;

/** Standings are posted after every this-many questions. */
export const STANDINGS_EVERY = 10;

/** Everything a round needs to run. */
export interface FlowDeps {
  discord: DiscordEffects;
  session: SessionPort;
  /**
   * The cross-session leaderboard.
   *
   * Injected like `discord` so a flow test needs no database. `noScores` is a
   * working implementation that keeps nothing, which is what a DM gets.
   */
  scores: ScorePort;
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
  /** Null in a DM. Stored with the session so the leaderboard survives however it ends. */
  guildId: string | null,
  settings: QuizSettings
): Promise<boolean> => {
  const result = generate(deps.words, settings.filters, deps.random);
  if (!isQuestion(result)) {
    await deps.discord.say(channelId, noWordsMessage);
    return false;
  }

  await deps.session.begin(
    channelId,
    guildId,
    result,
    settings.session,
    settings.filters
  );

  // The rules first, then a pause. A session used to open with a question
  // nobody had agreed the terms of — how many guesses, how long, what is being
  // drilled — so the first question doubled as the moment everyone worked out
  // how the game runs.
  //
  // The first question is NOT posted here. `pause` arms the session's alarm and
  // this returns; the alarm calls back through `handleResume`, which posts it.
  // Posting it now would make the pause purely decorative.
  await deps.discord.post(
    channelId,
    introEmbed(settings, Math.round(INTRO_PAUSE_MS / 1000))
  );
  await deps.session.pause(INTRO_PAUSE_MS);
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

/**
 * A pause has ended; ask the question that was waiting.
 *
 * Pauses work by returning rather than blocking. `setTimeout` inside a Worker
 * dies with the isolate, so a wait that outlived an eviction would never
 * resume — the session object holds it on the same alarm as the question
 * timeout, and the alarm calls back here.
 *
 * The very first question is a special case: `questionNumber` is already 1 and
 * the question is already stored, so it is posted as-is rather than advanced
 * past.
 */
export const handleResume = async (
  deps: FlowDeps,
  channelId: string
): Promise<void> => {
  const view = await deps.session.current();
  if (view === null || view.state !== `paused`) return;

  const pending = view.context.question;
  if (pending !== null && view.context.attempts.length === 0) {
    await deps.session.resume();
    await deps.discord.post(
      channelId,
      questionEmbed(
        pending,
        view.context.questionNumber,
        view.context.config.length
      ),
      questionButtons()
    );
    return;
  }

  await advance(deps, channelId);
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

/**
 * Close out a finished session: post the final standings and bank them.
 *
 * Every path that ends a session goes through here. There are three of them —
 * the last question answered, the last question timing out, and `/quiz end` —
 * and a leaderboard that only recorded some of them would be quietly wrong in
 * a way nobody could spot from the numbers.
 *
 * The scores are recorded before the embed is posted so a failed post cannot
 * lose them; `record` reports its own failures and never throws, so the
 * standings still reach the channel either way.
 */
export const finish = async (
  deps: FlowDeps,
  channelId: string,
  outcome: {
    guildId: string | null;
    standings: Array<{ userId: string; points: number }>;
    correct: Record<string, number>;
  },
  questionNumber: number
): Promise<void> => {
  // No guild means a DM, which has no leaderboard to write to.
  if (outcome.guildId !== null) {
    // Guarded rather than trusted. `d1Scores` swallows its own failures, but
    // that is its promise to keep, not a fact this function can rely on — and
    // if it ever breaks, the session people just played must still end with
    // the standings they earned. The leaderboard is a record of play, not part
    // of it.
    try {
      await deps.scores.record(
        outcome.guildId,
        outcome.standings.map((entry) => ({
          userId: entry.userId,
          points: entry.points,
          correct: outcome.correct[entry.userId] ?? 0
        }))
      );
    } catch (error) {
      diagnostics.SCORES_UNAVAILABLE({
        action: `record a finished session`,
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }
  await deps.discord.post(
    channelId,
    scoresEmbed(outcome.standings, questionNumber)
  );
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
            : { points: result.outcome.points }),
          ...(result.outcome.total === undefined
            ? {}
            : { total: result.outcome.total })
        },
        view?.context.attempts ?? []
      )
    );
  }

  if (result.final !== undefined) {
    // The machine reached `finished` on this answer. `end` is what carries the
    // guild and the correct counts, so it is called even though the standings
    // are already in hand.
    const outcome = await deps.session.end();
    if (outcome !== null) {
      await finish(deps, channelId, outcome, view?.context.questionNumber ?? 0);
    }
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
    const outcome = await deps.session.end();
    if (outcome !== null) {
      await finish(deps, channelId, outcome, view?.context.questionNumber ?? 0);
    }
    return;
  }

  const settings = view.context;

  // Out of questions. Reached when the session paused on its last question —
  // `paused` cannot carry the usual guard, because that would end a
  // one-question session during its own introduction.
  if (
    settings.config.length !== null &&
    settings.questionNumber >= settings.config.length
  ) {
    const outcome = await deps.session.end();
    if (outcome !== null) {
      await finish(deps, channelId, outcome, settings.questionNumber);
    }
    return;
  }

  // Standings every so often, so a long run has a visible shape rather than
  // being twenty questions and then a number nobody expected. Skipped when the
  // session is about to end anyway, since the final board follows immediately.
  const done = settings.questionNumber;
  const nearlyOver =
    settings.config.length !== null && done >= settings.config.length;
  if (done > 0 && done % STANDINGS_EVERY === 0 && !nearlyOver) {
    await deps.discord.post(
      channelId,
      standingsEmbed(
        Object.entries(settings.scores)
          .map(([userId, points]) => ({ userId, points }))
          .sort((a, b) => b.points - a.points),
        done,
        Math.round(STANDINGS_PAUSE_MS / 1000)
      )
    );
    await deps.session.pause(STANDINGS_PAUSE_MS);
    return;
  }

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
    questionEmbed(result, settings.questionNumber + 1, settings.config.length),
    questionButtons()
  );
};

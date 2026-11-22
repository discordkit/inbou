import { discord } from "@discordkit/client";
import { handleCommand, type CommandDeps } from "./commands.js";
import { discordEffects, followUpEffects, v2Effects } from "./discord.js";
import type { ForwardedEvent } from "./events.js";
import { handleExamInteraction } from "./exam/commands.js";
import examCorpus from "./exam/corpus.json" with { type: "json" };
import {
  handleResume as handleExamResume,
  handleTimeout as handleExamTimeout,
  type ExamDeps,
  type ExamPort
} from "./exam/flow.js";
import type { Item, ReviewLink } from "./exam/items.js";
import type { ExamSession } from "./exam/session.js";
import { handleMessage } from "./messages.js";
import corpus from "./quiz/corpus.json" with { type: "json" };
import {
  handleResume,
  handleTimeout,
  type FlowDeps,
  type SessionPort
} from "./quiz/flow.js";
import { conjugationQuiz } from "./quiz/conjugation.js";
import type { Word } from "./quiz/question.js";
import { alwaysTracked, inbouStores, privacyOver } from "./privacy.js";
import { d1Scores, noScores } from "./scores.js";
import type { QuizSession } from "./session.js";

// Re-exported so the runtime can construct the class this Worker's
// `durable_objects` binding names. Quiz sessions live here rather than in the
// bot Worker so that editing them never restarts the Gateway connection.
export { QuizSession } from "./session.js";
// The same, for mock tests. A separate class: see docs/specs/jlpt-mock-tests.md.
export { ExamSession } from "./exam/session.js";

/**
 * The reloadable half of the bot.
 *
 * Everything under `src/handlers/` can be edited freely during development.
 * This is a separate Worker from the one holding the Gateway connection, so the
 * Cloudflare plugin reloads it on its own — the Durable Object is never torn
 * down and the Discord session survives.
 *
 * The bot Worker forwards each event here over a service binding. Replies go
 * back to Discord over REST, so this Worker needs no Gateway session of its own.
 */
export interface Env {
  /**
   * Bot token. Interaction replies authenticate with the interaction's own
   * token, but posting an ordinary message does not — `createMessage` needs
   * this.
   */
  DISCORD_BOT_TOKEN: string;
  /** One quiz session per channel, keyed by channel id. */
  SESSION: DurableObjectNamespace<QuizSession>;
  /** One mock test per channel, keyed by channel id. */
  EXAM: DurableObjectNamespace<ExamSession>;
  /**
   * Where the 問題6 pictures are hosted, ending in `/`.
   *
   * Optional: without it, a 問題6 card shows its picture's text instead, which still lets the test run.
   */
  ASSET_BASE?: string;
  /**
   * Cross-session scores.
   *
   * Optional because the quiz does not need it: a deployment without the
   * binding plays identically and simply keeps no leaderboard, which is what
   * `noScores` provides. Making it required would turn a missing migration
   * into a bot that cannot run a session at all.
   */
  SCORES?: D1Database;
}

/**
 * The corpus, read once per isolate.
 *
 * Imported at module scope so the JSON is parsed when the Worker boots rather
 * than on every request. It never reaches the Durable Object: that object wakes
 * from hibernation constantly and would re-parse 1.8 MB each time, which is why
 * questions are generated out here and handed to it already resolved.
 */
const words = corpus.words as Word[];

/** The session for one channel. */
const sessionFor = (env: Env, channelId: string): SessionPort =>
  env.SESSION.get(env.SESSION.idFromName(channelId));

const depsFor = (env: Env, channelId: string): FlowDeps => ({
  discord: discordEffects,
  session: sessionFor(env, channelId),
  kind: conjugationQuiz,
  scores: env.SCORES === undefined ? noScores : d1Scores(env.SCORES),
  privacy:
    env.SCORES === undefined
      ? alwaysTracked
      : privacyOver(env.SCORES, inbouStores(env.SCORES)),
  words
});

/** The mock test for one channel. */
const examFor = (env: Env, channelId: string): ExamPort =>
  env.EXAM.get(env.EXAM.idFromName(channelId));

/** Is anything still running? A finished session only waits to be replaced. */
const running = async (
  session: Pick<ExamPort, `current`> | Pick<SessionPort, `current`>
): Promise<boolean> => {
  const view = await session.current();
  return view !== null && view.state !== `finished`;
};

/** The quiz's dependencies, plus what it needs to know about mock tests. */
const commandDepsFor = (env: Env, channelId: string): CommandDeps => ({
  ...depsFor(env, channelId),
  examRunning: async () => running(examFor(env, channelId))
});

/**
 * Reviewed mock-test items, read once per isolate like the word corpus.
 * `exam:build` validated them, and ships no drafts.
 */
const items = examCorpus.items as Item[];
const review: Readonly<Record<string, ReviewLink>> = examCorpus.review;

/** Each 問題6 picture's URL, by item id: corpus.json's names under ASSET_BASE. */
const picturesAt = (base: string | undefined): Record<string, string> =>
  base === undefined
    ? {}
    : Object.fromEntries(
        Object.entries(examCorpus.pictures).map(([id, path]) => [
          id,
          `${base}${path}`
        ])
      );

const examDepsFor = (env: Env, channelId: string): ExamDeps => ({
  discord: discordEffects,
  cards: v2Effects,
  followUps: followUpEffects,
  session: examFor(env, channelId),
  items,
  review,
  pictures: picturesAt(env.ASSET_BASE),
  random: Math.random,
  now: Date.now,
  quizRunning: async () => running(sessionFor(env, channelId))
});

export default {
  /**
   * Take an event and answer at once; the work runs afterwards in `waitUntil`.
   *
   * Every caller here (the bot, and the session objects' alarms) only hands an event over. Answering after the work would tie the work to the caller's request: when the bot's request ended, Cloudflare cancelled the work with it, and the requests waiting for answers shared one pool of six connections with the work's own calls to Discord. Under a class's votes, presses were lost. `waitUntil` gives the work up to 30 seconds of its own, far more than any event needs.
   */
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    // Workers have no `process.env`. Idempotent, so per-request is fine.
    discord.setToken(`Bot ${env.DISCORD_BOT_TOKEN}`);

    const event = await request.json<ForwardedEvent>();
    ctx.waitUntil(handleEvent(env, event));
    return new Response(null, { status: 202 });
  }
} satisfies ExportedHandler<Env>;

/** Route one event. Failures are reported, never thrown: nobody is waiting for them. */
const handleEvent = async (env: Env, event: ForwardedEvent): Promise<void> => {
  try {
    switch (event.type) {
      case `INTERACTION_CREATE`: {
        const channelId = event.data.channelId ?? `dm`;
        // Mock tests first; anything they do not recognise is the quiz's.
        // A command outside a channel has no session to act on. The routers
        // say so; the deps just need somewhere to point.
        if (
          await handleExamInteraction(examDepsFor(env, channelId), event.data)
        )
          break;
        await handleCommand(commandDepsFor(env, channelId), event.data);
        break;
      }
      case `MESSAGE_CREATE`:
        await handleMessage(depsFor(env, event.data.channelId), event.data);
        break;
      case `SESSION_RESUME`:
        // A pause ended. The question was chosen before the wait, so this
        // only has to open it.
        await handleResume(depsFor(env, event.channelId), event.channelId);
        break;
      case `SESSION_TIMEOUT`:
        // The Durable Object's alarm fired. It has already closed the
        // question; this posts the reveal and asks the next one, because
        // neither can be done from inside the object — one needs the corpus,
        // the other needs a REST call.
        await handleTimeout(depsFor(env, event.channelId), event.channelId);
        break;
      case `EXAM_RESUME`:
        await handleExamResume(
          examDepsFor(env, event.channelId),
          event.channelId
        );
        break;
      case `EXAM_TIMEOUT`:
        // Unlike the quiz, the exam object only forwards: closing the
        // question here returns the final ballot the reveal needs.
        await handleExamTimeout(
          examDepsFor(env, event.channelId),
          event.channelId
        );
        break;
    }
  } catch (error) {
    // Report rather than throw: the bot Worker only forwards, and a failure
    // in app logic should not read as an unhealthy connection.
    console.error(`Failed to handle ${event.type}`, error);
  }
};

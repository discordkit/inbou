import type { Interaction } from "@discordkit/client/interactions/types/Interaction";
import type { DiscordEffects, V2Effects } from "../discord.js";
import type { TestId } from "./blueprint.js";
import { drawTest, type Random } from "./draw.js";
import type { Item } from "./items.js";
import {
  answersOf,
  resultsOf,
  type Closed,
  type ExamInput,
  type ExamView,
  type VoteResult
} from "./machine.js";
import {
  closedQuestionMessage,
  introMessage,
  myResultsText,
  questionMessage,
  resultsMessage,
  revealMessage,
  type QuestionView
} from "./render.js";

/**
 * Running a mock test, without knowing it is Discord on the other end.
 *
 * Every dependency is an interface, so a whole test runs against stubs in
 * plain Node. The platform lives at the edge; the decisions live here.
 */

/** What the flow needs from a session, which the Durable Object stub satisfies. */
export interface ExamPort {
  begin: (input: ExamInput) => Promise<ExamView>;
  current: () => Promise<ExamView | null>;
  vote: (userId: string, token: string, option: number) => Promise<VoteResult>;
  close: () => Promise<Closed | null>;
  resume: () => Promise<ExamView | null>;
  next: () => Promise<ExamView | null>;
  pause: (ms: number) => Promise<void>;
  posted: (messageId: string) => Promise<void>;
  end: () => Promise<ExamView | null>;
}

export interface ExamDeps {
  /** Private replies to the person who pressed or typed. */
  discord: Pick<DiscordEffects, `reply`>;
  /** Questions, reveals and results, which are Components V2. */
  cards: V2Effects;
  session: ExamPort;
  /** Reviewed items only. Drafts never reach a channel. */
  items: readonly Item[];
  /** Injected so tests can pin the draw. */
  random: Random;
  /** Injected so tests can pin times. */
  now: () => number;
  /**
   * Is the conjugation quiz running in this channel?
   *
   * Typed answers and button votes in one channel at once would confuse
   * everyone, so a test will not start over a quiz.
   */
  quizRunning: () => Promise<boolean>;
}

/** How long the channel gets to read the intro before question one. */
export const INTRO_PAUSE_MS = 10_000;

/**
 * How long the channel gets to read a reveal before the next question.
 * Longer than tome's trivia, because each reveal teaches something.
 */
export const REVEAL_PAUSE_MS = 10_000;

/**
 * Should the question be edited to show this many answers?
 *
 * Discord allows roughly five edits per five seconds per channel, so an edit
 * per press would be rate-limited on a busy question. Doubling thresholds keep
 * the counter lively for the first few votes and quiet afterwards: eight
 * players cost four edits.
 */
export const showsVoteCount = (voters: number): boolean => {
  if (voters <= 0) return false;
  // A power of two, as a loop: the shared lint config bans bitwise operators.
  for (let step = 1; step <= voters; step *= 2) {
    if (step === voters) return true;
  }
  return false;
};

/**
 * How the open question is rendered.
 *
 * Built from the session every time, so the settle-on-close edit reproduces
 * exactly what was posted.
 */
const viewOf = (view: ExamView): QuestionView | null => {
  const question = view.context.questions.at(view.context.index);
  if (question === undefined) return null;
  return {
    question,
    total: view.context.questions.length,
    endsAt: Math.floor((view.context.deadline ?? 0) / 1000)
  };
};

/**
 * Start a test in a channel.
 *
 * The first question is NOT posted here. The session holds it on the intro,
 * and the alarm calls back through {@link handleResume} to post it.
 */
export const startTest = async (
  deps: ExamDeps,
  interaction: Interaction,
  channelId: string,
  guildId: string | null,
  test: TestId
): Promise<void> => {
  const refuse = async (content: string): Promise<void> => {
    await deps.discord.reply(interaction, { content, ephemeral: true });
  };

  if (await deps.quizRunning()) {
    await refuse(
      `A conjugation quiz is running here. Finish it, or end it with \`/quiz end\`, first.`
    );
    return;
  }
  const existing = await deps.session.current();
  if (existing !== null && existing.state !== `finished`) {
    await refuse(`A mock test is already running here.`);
    return;
  }

  const questions = drawTest(test, deps.items, deps.random);
  if (questions.length === 0) {
    await refuse(`No questions are ready for this test yet.`);
    return;
  }

  // The reply first: an interaction must be answered within three seconds.
  await deps.discord.reply(interaction, {
    content: `Starting the test…`,
    ephemeral: true
  });

  const now = deps.now();
  const introUntil = now + INTRO_PAUSE_MS;
  await deps.session.begin({
    testId: now.toString(36),
    channelId,
    guildId,
    test,
    questions,
    introUntil
  });
  await deps.cards.post(
    channelId,
    introMessage(test, questions.length, Math.floor(introUntil / 1000))
  );
};

/** Post the open question, and note its message so the timeout can settle it. */
const postQuestion = async (
  deps: ExamDeps,
  channelId: string,
  view: ExamView
): Promise<void> => {
  const question = viewOf(view);
  if (question === null) return;
  const messageId = await deps.cards.post(channelId, questionMessage(question));
  // Null means the post failed. The test still runs; there is just nothing to
  // settle when this question closes.
  if (messageId !== null) await deps.session.posted(messageId);
};

/**
 * A wait has ended: open the question that was waiting.
 *
 * The intro holds question ONE before anyone has seen it, so it is opened,
 * not advanced past. `posted` says which wait this was; inferring it from "no
 * votes yet" would re-ask any question nobody answered, forever.
 */
export const handleResume = async (
  deps: ExamDeps,
  channelId: string
): Promise<void> => {
  const view = await deps.session.current();
  if (view === null || view.state !== `paused`) return;

  const opened = view.context.posted
    ? await deps.session.next()
    : await deps.session.resume();
  if (opened?.state !== `asking`) return;
  await postQuestion(deps, channelId, opened);
};

/** The question timer ended: settle it, reveal it, and move on. */
export const handleTimeout = async (
  deps: ExamDeps,
  channelId: string
): Promise<void> => {
  const closed = await deps.session.close();
  if (closed === null) return;
  const { view, question, tally } = closed;

  // Settle the question BEFORE the reveal, so a live-looking question never
  // sits above its own answer.
  const { messageId } = view.context;
  if (messageId !== null) {
    await deps.cards.edit(
      channelId,
      messageId,
      closedQuestionMessage({
        question,
        total: view.context.questions.length,
        endsAt: 0
      })
    );
  }
  await deps.cards.post(channelId, revealMessage(question, tally));

  // The last question reaches `finished` straight from `asking`.
  if (view.state === `finished`) {
    await postResults(deps, channelId, view);
    return;
  }
  await deps.session.pause(REVEAL_PAUSE_MS);
};

/** Record a button press. Every reply is private. */
export const handleVote = async (
  deps: ExamDeps,
  interaction: Interaction,
  channelId: string,
  vote: { userId: string; token: string; option: number }
): Promise<VoteResult> => {
  const result = await deps.session.vote(vote.userId, vote.token, vote.option);
  const chosen = String(vote.option + 1);
  const content =
    result.outcome === `recorded`
      ? `You chose **${chosen}**. You can change it until the question closes.`
      : result.outcome === `changed`
        ? `Changed to **${chosen}**.`
        : result.outcome === `stale`
          ? `That question has already closed.`
          : `No question is open here right now.`;
  await deps.discord.reply(interaction, { content, ephemeral: true });

  // Show that people are answering, never WHAT they answered.
  if (
    result.outcome === `recorded` &&
    result.voters !== undefined &&
    showsVoteCount(result.voters)
  ) {
    const view = await deps.session.current();
    const question = view === null ? null : viewOf(view);
    const messageId = view?.context.messageId ?? null;
    if (view?.state === `asking` && question !== null && messageId !== null) {
      await deps.cards.edit(
        channelId,
        messageId,
        questionMessage({ ...question, voters: result.voters })
      );
    }
  }
  return result;
};

/** Stop early, on request. Counts only the questions that closed. */
export const endTest = async (
  deps: ExamDeps,
  interaction: Interaction,
  channelId: string
): Promise<void> => {
  const before = await deps.session.current();
  if (before === null || before.state === `finished`) {
    await deps.discord.reply(interaction, {
      content: `No mock test is running here.`,
      ephemeral: true
    });
    return;
  }

  const after = await deps.session.end();
  await deps.discord.reply(interaction, {
    content: `Test ended.`,
    ephemeral: true
  });

  // An open question would otherwise keep its live buttons and countdown.
  const open = viewOf(before);
  if (
    before.state === `asking` &&
    open !== null &&
    before.context.messageId !== null
  ) {
    await deps.cards.edit(
      channelId,
      before.context.messageId,
      closedQuestionMessage(open)
    );
  }
  if (after !== null) await postResults(deps, channelId, after);
};

/** Every path that ends a test comes through here, so none misses its results. */
const postResults = async (
  deps: ExamDeps,
  channelId: string,
  view: ExamView
): Promise<void> => {
  const { test, testId } = view.context;
  await deps.cards.post(
    channelId,
    resultsMessage(test, testId, resultsOf(view.context))
  );
};

/** One player's answers, privately, from the results card. */
export const myResults = async (
  deps: ExamDeps,
  interaction: Interaction,
  testId: string,
  userId: string
): Promise<void> => {
  const view = await deps.session.current();
  if (view?.context.testId !== testId) {
    await deps.discord.reply(interaction, {
      content: `Those results belong to an earlier test.`,
      ephemeral: true
    });
    return;
  }
  const result = resultsOf(view.context).find(
    (entry) => entry.userId === userId
  );
  await deps.discord.reply(interaction, {
    content: myResultsText(
      view.context.questions,
      answersOf(view.context, userId),
      result
    ),
    ephemeral: true
  });
};

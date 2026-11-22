import {
  assign,
  createActor,
  setup,
  type Actor,
  type SnapshotFrom
} from "xstate";
import type { TestId } from "./blueprint.js";
import { OPTION_COUNT, type ExamQuestion } from "./draw.js";
import { WEIGHT } from "./items.js";

/**
 * A mock test as an explicit state machine.
 *
 * A poll, not a race. **`VOTE` does not leave `asking`**: everyone answers at
 * once, everyone who is right scores, and the question closes only when its
 * timer runs out. `TIMEOUT` is the normal exit and the only place answers are
 * settled. The conjugation quiz is the opposite — the first correct answer ends
 * its question — which is why the two are separate machines. See the spec,
 * section 8.
 *
 * Accuracy, not speed. There is no timestamp on a vote, so a correct answer in
 * the last second is worth exactly what it is worth in the first.
 *
 * States rather than nullable fields, for the reason the quiz machine gives: a
 * closed question with a live deadline is the stale-alarm bug, and `deadline`
 * only means anything in `asking` and `paused`.
 */

/** Votes on one question, by player. The value is the option pressed. */
export type Ballot = Record<string, number>;

/**
 * How to reply privately to a player after their vote: the interaction's application and token.
 *
 * A token can post as the bot for fifteen minutes, so it is a credential: kept only for the card it was pressed on, never logged, and gone when the next card opens.
 */
export interface Reply {
  application: string;
  token: string;
}

/** What starts a test. */
export interface ExamInput {
  /**
   * Names this run of the test, so a results button from an earlier test in
   * the same channel cannot show this one's results.
   */
  testId: string;
  channelId: string;
  guildId: string | null;
  test: TestId;
  questions: ExamQuestion[];
  /** When the intro ends and question one opens. */
  introUntil: number;
  /** The intro's message, edited once question one opens. Null if it failed. */
  introId: string | null;
}

export interface ExamContext {
  testId: string;
  /** The intro's message, so its countdown can be replaced once the test starts. */
  introId: string | null;
  channelId: string;
  /** Null in a DM. Stored because the session can end on its alarm. */
  guildId: string | null;
  test: TestId;
  /**
   * The whole test, drawn once at the start.
   *
   * Stored rather than drawn question by question, so nothing about the draw
   * outlives the session — every card is back in its deck for the next test.
   */
  questions: ExamQuestion[];
  /**
   * 0-based; the first question on the card open, or just closed. A card is
   * usually one question; a passage's blanks share one.
   */
  index: number;
  /**
   * Votes on the open card, by question index, then by player.
   *
   * Keyed by player, and that is load-bearing: a player who changes their mind
   * overwrites their entry, so nobody can hold two votes on one question and
   * the record is always their latest choice.
   */
  votes: Partial<Record<number, Ballot>>;
  /**
   * Each player's latest press on the open card, so its reveal can tell them privately why their choice was wrong. Only for cards that explain their wrong options; a grammar card keeps none.
   *
   * Optional because a test saved before this field existed may still be running when it deploys.
   */
  replies?: Partial<Record<string, Reply>>;
  /** The final votes on each closed question, by question index. */
  ballots: Ballot[];
  /** Epoch ms. Set only while `asking` (the timer) or `paused` (the wait). */
  deadline: number | null;
  /**
   * Has the channel been shown the current question?
   *
   * False only during the intro, which holds question one before anyone sees
   * it. The flow needs to tell that wait apart from the break after a reveal,
   * and inferring it from "no votes yet" re-asks any question nobody answered,
   * forever — a bug tome found. So the machine says so outright.
   */
  posted: boolean;
  /**
   * The message the open question was posted as, so the timeout can settle it.
   * Null until Discord accepts the post, and for a post that failed.
   */
  messageId: string | null;
}

export type ExamEvent =
  /** A vote on one question of the open card, by its index in the test. */
  | {
      type: `VOTE`;
      userId: string;
      question: number;
      option: number;
      /** Set only on a card that explains its wrong options. */
      reply?: Reply;
    }
  | { type: `TIMEOUT` }
  /** Open the next stored question. */
  | { type: `NEXT`; now: number }
  /** Open the current question, without advancing past it. The intro holds one. */
  | { type: `RESUME`; now: number }
  /** Hold before the next question, so the channel can read the reveal. */
  | { type: `PAUSE`; until: number }
  /** The open question reached the channel, as this message. */
  | { type: `POSTED`; messageId: string }
  | { type: `END` };

/**
 * The questions on the card at `index`: the question there, and any after it
 * that share its card. Cards are contiguous, because a passage's questions are
 * drawn together.
 */
export const cardAt = (
  questions: readonly ExamQuestion[],
  index: number
): ExamQuestion[] => {
  const card = questions.at(index)?.card;
  const on: ExamQuestion[] = [];
  for (const question of questions.slice(index)) {
    if (question.card !== card) break;
    on.push(question);
  }
  return on;
};

/** Was the card that just closed the last one? */
const testOver = ({ context }: { context: ExamContext }): boolean =>
  context.index + cardAt(context.questions, context.index).length >=
  context.questions.length;

/**
 * Start the clock on the card at `index` and clear the previous votes.
 *
 * A card's time is the sum of its questions' times: four blanks of a passage
 * get the time four questions would, with the passage counted once.
 */
const openQuestion = assign<
  ExamContext,
  ExamEvent,
  undefined,
  ExamEvent,
  never
>({
  votes: {},
  // The last card's tokens are spent: nothing more is said about it.
  replies: {},
  posted: true,
  // The previous card's message, deliberately dropped: carrying it would make
  // the next timeout settle a message the channel has moved past.
  messageId: null,
  deadline: ({ context, event }) =>
    event.type === `NEXT` || event.type === `RESUME`
      ? event.now +
        cardAt(context.questions, context.index).reduce(
          (sum, question) => sum + question.timeoutMs,
          0
        )
      : null
});

const advance = assign<ExamContext, ExamEvent, undefined, ExamEvent, never>({
  index: ({ context }) =>
    context.index + cardAt(context.questions, context.index).length
});

const holdUntil = assign<ExamContext, ExamEvent, undefined, ExamEvent, never>({
  deadline: ({ event }) => (event.type === `PAUSE` ? event.until : null)
});

export const examMachine = setup({
  types: {
    context: {} as ExamContext,
    events: {} as ExamEvent,
    input: {} as ExamInput
  },
  guards: { testOver }
}).createMachine({
  id: `exam`,
  // The intro is a pause like any other: question one is stored, not shown.
  initial: `paused`,
  context: ({ input }) => ({
    testId: input.testId,
    introId: input.introId,
    channelId: input.channelId,
    guildId: input.guildId,
    test: input.test,
    questions: input.questions,
    index: 0,
    votes: {},
    replies: {},
    ballots: [],
    deadline: input.introUntil,
    posted: false,
    messageId: null
  }),
  states: {
    /** A question is open and its timer is running. */
    asking: {
      on: {
        /**
         * A vote. Stays in `asking`: this is the whole difference from a race.
         * The upsert replaces any earlier vote, so changing an answer is free.
         */
        VOTE: {
          actions: assign({
            votes: ({ context, event }) => ({
              ...context.votes,
              [event.question]: {
                ...context.votes[event.question],
                [event.userId]: event.option
              }
            }),
            // The latest press wins, as the vote does: its token is the freshest.
            replies: ({ context, event }) =>
              event.reply === undefined
                ? context.replies
                : { ...context.replies, [event.userId]: event.reply }
          })
        },
        // Only here: a `POSTED` arriving later would be for a closed question.
        POSTED: {
          actions: assign({ messageId: ({ event }) => event.messageId })
        },
        TIMEOUT: {
          target: `revealing`,
          // Every question on the card is settled at once, in order, so
          // `ballots` stays indexed like `questions`.
          actions: assign({
            ballots: ({ context }) => [
              ...context.ballots,
              ...cardAt(context.questions, context.index).map(
                (_, offset) => context.votes[context.index + offset] ?? {}
              )
            ],
            deadline: null
          })
        },
        END: { target: `finished` }
      }
    },

    /**
     * Holding between questions, or before the first.
     *
     * The wait runs on the same alarm as the question timer rather than a
     * `setTimeout`, because a Worker's timers die with its isolate.
     */
    paused: {
      on: {
        RESUME: { target: `asking`, actions: openQuestion },
        NEXT: { target: `asking`, actions: [advance, openQuestion] },
        END: { target: `finished` }
      }
    },

    /**
     * The question has closed and its answer is being shown.
     *
     * Falls through to `finished` after the last question, so the flow reveals
     * it and then posts the results.
     */
    revealing: {
      always: { guard: `testOver`, target: `finished` },
      on: {
        NEXT: { target: `asking`, actions: [advance, openQuestion] },
        PAUSE: { target: `paused`, actions: holdUntil },
        END: { target: `finished` }
      }
    },

    /**
     * Over. Nothing more is scored and no alarm is armed.
     *
     * The questions and ballots are KEPT: the last reveal and the results are
     * posted after this state is reached. An open question's votes are not
     * settled — a test ended early counts only the questions that closed.
     */
    finished: {
      type: `final`,
      entry: assign({ deadline: null })
    }
  }
});

export type ExamActor = Actor<typeof examMachine>;
export type ExamSnapshot = SnapshotFrom<typeof examMachine>;
export type ExamState = ExamSnapshot[`value`];

/** One player's result on one closed question. */
export interface Answer {
  number: number;
  /** The option they ended on, or null if they did not answer. */
  chose: number | null;
  correct: boolean;
  /** What it earned: the question's weight if correct, else 0. */
  points: number;
}

/** How a player did across the whole test. */
export interface Result {
  userId: string;
  points: number;
  /** The most anyone could have earned on the questions that closed. */
  max: number;
  correct: number;
  /** How many questions closed. */
  asked: number;
}

/**
 * Every closed question, and what each player did on it.
 *
 * Derived from the ballots rather than kept as running totals, so a score can
 * never drift from the votes that made it.
 */
const closed = (
  context: ExamContext
): Array<{ question: ExamQuestion; ballot: Ballot }> =>
  context.ballots.flatMap((ballot, index) => {
    const question = context.questions.at(index);
    return question === undefined ? [] : [{ question, ballot }];
  });

/** Everyone who voted on anything, with their results, best first. */
export const resultsOf = (context: ExamContext): Result[] => {
  const questions = closed(context);
  const max = questions.reduce(
    (sum, { question }) => sum + WEIGHT[question.difficulty],
    0
  );
  const players = new Set(
    questions.flatMap(({ ballot }) => Object.keys(ballot))
  );

  return [...players]
    .map((userId) => {
      let points = 0;
      let correct = 0;
      for (const { question, ballot } of questions) {
        if (ballot[userId] === question.correct) {
          points += WEIGHT[question.difficulty];
          correct += 1;
        }
      }
      return { userId, points, max, correct, asked: questions.length };
    })
    .sort((a, b) => b.points - a.points || b.correct - a.correct);
};

/** One player's answer to every closed question, for their private results. */
export const answersOf = (context: ExamContext, userId: string): Answer[] =>
  closed(context).map(({ question, ballot }) => {
    const chose = ballot[userId] ?? null;
    const correct = chose === question.correct;
    return {
      number: question.number,
      chose,
      correct,
      points: correct ? WEIGHT[question.difficulty] : 0
    };
  });

/** How the room answered the question that just closed. */
export interface Tally {
  /** Votes per option, in display order. */
  counts: number[];
  correct: number;
  /** Players who got it right. */
  scorers: string[];
}

export const tallyOf = (
  question: ExamQuestion,
  ballot: Ballot,
  optionCount: number
): Tally => {
  const counts = Array.from({ length: optionCount }, () => 0);
  const scorers: string[] = [];
  for (const [userId, option] of Object.entries(ballot)) {
    if (option >= 0 && option < optionCount) {
      counts[option] = (counts.at(option) ?? 0) + 1;
    }
    if (option === question.correct) scorers.push(userId);
  }
  return { counts, correct: question.correct, scorers };
};

/** A snapshot, flattened for callers that only read it. */
export interface ExamView {
  state: ExamState;
  context: ExamContext;
}

export const viewOf = (actor: ExamActor): ExamView => {
  const snapshot = actor.getSnapshot();
  return { state: snapshot.value, context: snapshot.context };
};

/** What a vote did, so the player can be told. */
export interface VoteResult {
  outcome:
    | `recorded`
    | `changed`
    /** Pressed a button from a question that has already closed. */
    | `stale`
    /** No test here, or none taking answers right now. */
    | `not-open`;
  /** The option they are now on, for the private acknowledgement. */
  option?: number;
  /**
   * The question voted on, when its card holds several — a passage's blanks —
   * so the acknowledgement can say which row it was.
   */
  number?: number;
  /**
   * How many players have answered anything on the card, present only when
   * this vote brought a new one. The counter shows players, not presses: one
   * player answering four rows of a passage is still one.
   */
  voters?: number;
}

/**
 * Apply a vote, if it may count.
 *
 * Here rather than in the Durable Object so the flow tests' in-memory session
 * runs the same rules: a stub that re-implemented them would be a second copy,
 * free to drift. The session never trusts its caller, so the option is bounded
 * again here even though `parseVote` already did.
 *
 * The token picks the question: every button carries its own question's, so a
 * press on a passage's third row votes on the third blank and nothing else.
 */
export const castVote = (
  actor: ExamActor,
  vote: { userId: string; token: string; option: number; reply?: Reply }
): VoteResult => {
  const before = actor.getSnapshot();
  if (before.value !== `asking`) return { outcome: `not-open` };
  const { questions, index, votes } = before.context;
  const card = cardAt(questions, index);
  const offset = card.findIndex((question) => question.token === vote.token);
  if (offset === -1) return { outcome: `stale` };
  if (
    !Number.isInteger(vote.option) ||
    vote.option < 0 ||
    vote.option >= OPTION_COUNT
  ) {
    return { outcome: `stale` };
  }

  const question = index + offset;
  const hadVoted = Object.hasOwn(votes[question] ?? {}, vote.userId);
  // A token is a credential: kept only where a reveal will use it.
  const explains = card.some((on) => on.whys !== undefined);
  actor.send({
    type: `VOTE`,
    userId: vote.userId,
    question,
    option: vote.option,
    ...(explains && vote.reply !== undefined ? { reply: vote.reply } : {})
  });

  const playersIn = (ballots: ExamContext[`votes`]): number =>
    new Set(
      Object.values(ballots).flatMap((ballot) => Object.keys(ballot ?? {}))
    ).size;
  const players = playersIn(actor.getSnapshot().context.votes);
  return {
    outcome: hadVoted ? `changed` : `recorded`,
    option: vote.option,
    ...(card.length > 1 ? { number: card[offset]?.number } : {}),
    ...(players > playersIn(votes) ? { voters: players } : {})
  };
};

/** A card that just closed, with what its reveal needs. */
export interface Closed {
  view: ExamView;
  /** Each question on the card, with how the room answered it. */
  results: Array<{ question: ExamQuestion; tally: Tally }>;
}

/**
 * Close the open card and settle its votes.
 *
 * Returns what the reveal needs, because this is the moment the ballots are
 * final. Null if no card is open.
 */
export const closeQuestion = (actor: ExamActor): Closed | null => {
  if (actor.getSnapshot().value !== `asking`) return null;
  actor.send({ type: `TIMEOUT` });

  const view = viewOf(actor);
  const { index, questions, ballots } = view.context;
  const results = cardAt(questions, index).flatMap((question, offset) => {
    const ballot = ballots.at(index + offset);
    return ballot === undefined
      ? []
      : [{ question, tally: tallyOf(question, ballot, OPTION_COUNT) }];
  });
  return results.length === 0 ? null : { view, results };
};

/** What a Durable Object persists. See the quiz machine for why it is typed. */
export interface PersistedExam {
  snapshot: ReturnType<ExamActor[`getPersistedSnapshot`]>;
}

/** Ignored by {@link restore}: a restored actor takes its context from the snapshot. */
const RESTORE_INPUT: ExamInput = {
  testId: ``,
  channelId: ``,
  guildId: null,
  test: `bunpou`,
  questions: [],
  introUntil: 0,
  introId: null
};

export const persist = (actor: ExamActor): PersistedExam => ({
  snapshot: actor.getPersistedSnapshot()
});

export const restore = (persisted: PersistedExam): ExamActor => {
  const actor = createActor(examMachine, {
    snapshot: persisted.snapshot,
    input: RESTORE_INPUT
  });
  actor.start();
  return actor;
};

/** Begin a test, held on its intro until `introUntil`. */
export const begin = (input: ExamInput): ExamActor => {
  const actor = createActor(examMachine, { input });
  actor.start();
  return actor;
};

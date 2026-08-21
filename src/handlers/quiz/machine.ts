import {
  assign,
  createActor,
  setup,
  type Actor,
  type SnapshotFrom
} from "xstate";
import type { Question } from "./question.js";

/**
 * A quiz session as an explicit state machine.
 *
 * The previous shape encoded its states as a combination of `question === null`,
 * `deadline === null` and `finished` — which let `{ question: null, deadline:
 * set }` exist: a closed question with a live timer. That is not a hypothetical;
 * it is the stale-alarm bug this project already shipped once, where an alarm
 * left armed after an answer fired against the *next* question and closed it
 * early. A test caught it only after being rewritten to assert on the stored
 * alarm rather than the field that was supposed to mirror it.
 *
 * Three states, and the illegal combinations simply cannot be built:
 *
 *   asking     a question is open and the clock is running
 *   revealing  it just closed; the channel is being told what the answer was
 *   finished   the session is over and nothing more is scored
 *
 * `deadline` is meaningful only in `asking`, so "closed question, live alarm"
 * has nowhere to live. The Durable Object reads the state name to decide
 * whether to arm or clear the alarm, rather than inferring it from a field.
 *
 * XState was chosen over hand-rolled transitions because @saeris/vscode-jisho
 * already uses it, so it is a known quantity in the organisation, and it costs
 * 5.3 KB gzipped with no dependencies.
 */

export interface Scores {
  [userId: string]: number;
}

export interface Attempt {
  userId: string;
  /** What they typed, folded to kana for the round-end embed. */
  answer: string;
  correct: boolean;
}

export interface SessionConfig {
  /** How many questions, or `null` for endless. */
  length: number | null;
  timeoutMs: number;
  /** Consecutive timeouts that end an endless session. */
  quitAfterTimeouts: number;
}

export const DEFAULT_CONFIG: SessionConfig = {
  length: 10,
  timeoutMs: 120_000,
  quitAfterTimeouts: 3
};

export interface SessionContext {
  channelId: string;
  config: SessionConfig;
  /** 1-based; the question currently open or just closed. */
  questionNumber: number;
  question: Question | null;
  attempts: Attempt[];
  scores: Scores;
  /** Consecutive timeouts, cleared by any answered question. */
  timeoutStreak: number;
  /** Epoch ms when the open question expires. Only set while `asking`. */
  deadline: number | null;
  /** Why the last question closed, for the reveal embed. */
  closedBy: `answer` | `timeout` | null;
}

export type SessionEvent =
  | {
      type: `ANSWER`;
      userId: string;
      typed: string;
      correct: boolean;
      now: number;
    }
  | { type: `TIMEOUT` }
  | { type: `NEXT`; question: Question; now: number }
  | { type: `END` };

/** Has this player already used their one guess this question? */
const alreadyAnswered = ({
  context,
  event
}: {
  context: SessionContext;
  event: SessionEvent;
}): boolean =>
  event.type === `ANSWER` &&
  context.attempts.some((a) => a.userId === event.userId);

const isCorrect = ({ event }: { event: SessionEvent }): boolean =>
  event.type === `ANSWER` && event.correct;

/**
 * Is the session over?
 *
 * A fixed session ends once it has asked its last question. An endless one ends
 * when the room goes quiet, measured as *consecutive* timeouts — one hard
 * question nobody gets is not the same signal as everyone having wandered off.
 */
const sessionOver = ({ context }: { context: SessionContext }): boolean =>
  context.config.length === null
    ? context.timeoutStreak >= context.config.quitAfterTimeouts
    : context.questionNumber >= context.config.length;

const recordAttempt = assign<
  SessionContext,
  SessionEvent,
  undefined,
  SessionEvent,
  never
>({
  attempts: ({ context, event }) =>
    event.type === `ANSWER`
      ? [
          ...context.attempts,
          { userId: event.userId, answer: event.typed, correct: event.correct }
        ]
      : context.attempts
});

export const sessionMachine = setup({
  types: {
    context: {} as SessionContext,
    events: {} as SessionEvent,
    input: {} as {
      channelId: string;
      question: Question;
      config: SessionConfig;
      now: number;
    }
  },
  guards: { alreadyAnswered, isCorrect, sessionOver }
}).createMachine({
  id: `session`,
  initial: `asking`,
  context: ({ input }) => ({
    channelId: input.channelId,
    config: input.config,
    questionNumber: 1,
    question: input.question,
    attempts: [],
    scores: {},
    timeoutStreak: 0,
    deadline: input.now + input.config.timeoutMs,
    closedBy: null
  }),
  states: {
    /** A question is open and the clock is running. */
    asking: {
      on: {
        ANSWER: [
          {
            // One guess per player. A second message is ignored rather than
            // penalised, so nobody can brute force the answer and nobody loses
            // anything by typing in the channel.
            guard: `alreadyAnswered`,
            actions: []
          },
          {
            guard: `isCorrect`,
            target: `revealing`,
            actions: [
              recordAttempt,
              assign({
                scores: ({ context, event }) =>
                  event.type === `ANSWER`
                    ? {
                        ...context.scores,
                        [event.userId]: (context.scores[event.userId] ?? 0) + 1
                      }
                    : context.scores,
                // An answered question means the room is awake.
                timeoutStreak: 0,
                deadline: null,
                closedBy: `answer` as const
              })
            ]
          },
          { actions: recordAttempt }
        ],
        TIMEOUT: {
          target: `revealing`,
          actions: assign({
            timeoutStreak: ({ context }) => context.timeoutStreak + 1,
            deadline: null,
            closedBy: `timeout` as const
          })
        },
        END: { target: `finished`, actions: assign({ deadline: null }) }
      }
    },

    /**
     * The question has closed and the channel is being shown the answer.
     *
     * A distinct state rather than a flag: it is where the reveal embed is
     * posted, and it is what makes "closed question with a live alarm"
     * impossible — `deadline` is cleared on entry and only `NEXT` sets it again.
     */
    revealing: {
      always: { guard: `sessionOver`, target: `finished` },
      on: {
        NEXT: {
          target: `asking`,
          actions: assign({
            questionNumber: ({ context }) => context.questionNumber + 1,
            question: ({ event }) =>
              event.type === `NEXT` ? event.question : null,
            attempts: [],
            closedBy: null,
            deadline: ({ context, event }) =>
              event.type === `NEXT`
                ? event.now + context.config.timeoutMs
                : null
          })
        },
        END: { target: `finished` }
      }
    },

    /** Over. Nothing more is scored and no alarm is armed. */
    finished: {
      type: `final`,
      entry: assign({ question: null, deadline: null })
    }
  }
});

export type SessionActor = Actor<typeof sessionMachine>;
export type SessionSnapshot = SnapshotFrom<typeof sessionMachine>;

/** Scores as a leaderboard, highest first. */
export const leaderboard = (
  context: SessionContext
): Array<{ userId: string; points: number }> =>
  Object.entries(context.scores)
    .map(([userId, points]) => ({ userId, points }))
    .sort((a, b) => b.points - a.points);

/**
 * The state a Durable Object persists.
 *
 * XState snapshots are designed to be serialised and restored, which is exactly
 * what a hibernating Durable Object needs: the isolate is discarded between
 * questions, so the machine has to be rebuilt from storage on every wake.
 */
export interface PersistedSession {
  snapshot: unknown;
}

export const persist = (actor: SessionActor): PersistedSession => ({
  snapshot: actor.getPersistedSnapshot()
});

/** Rebuild a running machine from what was stored. */
export const restore = (persisted: PersistedSession): SessionActor => {
  const actor = createActor(sessionMachine, {
    snapshot: persisted.snapshot as never
  });
  actor.start();
  return actor;
};

/** Begin a session. */
export const begin = (
  channelId: string,
  question: Question,
  config: SessionConfig,
  now: number
): SessionActor => {
  const actor = createActor(sessionMachine, {
    input: { channelId, question, config, now }
  });
  actor.start();
  return actor;
};

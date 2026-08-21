import {
  assign,
  createActor,
  setup,
  type Actor,
  type SnapshotFrom
} from "xstate";
import type { Filters, Question } from "./question.js";

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
  /**
   * How many attempts each player gets per question.
   *
   * More than one because a near miss deserves another go — but bounded, or a
   * fast typist could brute force the answer. Each wrong guess costs a point of
   * what a later correct one is worth, so precision still pays.
   */
  guesses: number;
}

export const DEFAULT_CONFIG: SessionConfig = {
  length: 10,
  // A minute. Two was measured as too long in the channel — the round stalls
  // and people drift off — while thirty seconds is not enough to read the
  // prompt and type a conjugation.
  timeoutMs: 60_000,
  quitAfterTimeouts: 3,
  guesses: 3
};

/**
 * What a correct answer is worth, given how many wrong guesses preceded it.
 *
 * First time is worth the most and each miss costs one, so a player who reads
 * the form carefully scores above one who works through the possibilities.
 * Never below one: landing it on the last guess is still landing it.
 */
export const pointsFor = (wrongGuesses: number, guesses: number): number =>
  Math.max(1, guesses + 1 - wrongGuesses);

export interface SessionContext {
  channelId: string;
  config: SessionConfig;
  /**
   * The filters this session draws questions from.
   *
   * Stored with the session rather than held by the caller: the Durable Object
   * hibernates between questions, so anything the next question needs has to
   * survive that. Without this, question two would be drawn from the whole
   * corpus and quietly ignore the level the channel chose.
   */
  filters: Filters;
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
  | { type: `CONFIGURE`; config: SessionConfig; filters: Filters }
  /** Hold before the next question, so the channel can read what just happened. */
  | { type: `PAUSE`; until: number }
  /** Start the clock on a question already stored, without advancing past it. */
  | { type: `RESUME`; now: number }
  | { type: `END` };

/** Has this player used every attempt this question? */
const outOfGuesses = ({
  context,
  event
}: {
  context: SessionContext;
  event: SessionEvent;
}): boolean =>
  event.type === `ANSWER` &&
  context.attempts.filter((a) => a.userId === event.userId).length >=
    context.config.guesses;

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

/**
 * Apply new settings without disturbing the open question.
 *
 * `/quiz config` takes effect from the *next* question: changing the timeout
 * mid-question would move a deadline players are already racing, and changing
 * the filters cannot retroactively alter what was asked. So this writes the
 * config and leaves `deadline` alone.
 */
const applyConfig = assign<
  SessionContext,
  SessionEvent,
  undefined,
  SessionEvent,
  never
>({
  config: ({ context, event }) =>
    event.type === `CONFIGURE` ? event.config : context.config,
  filters: ({ context, event }) =>
    event.type === `CONFIGURE` ? event.filters : context.filters
});

export const sessionMachine = setup({
  types: {
    context: {} as SessionContext,
    events: {} as SessionEvent,
    input: {} as {
      channelId: string;
      question: Question;
      config: SessionConfig;
      filters: Filters;
      now: number;
    }
  },
  guards: { outOfGuesses, isCorrect, sessionOver }
}).createMachine({
  id: `session`,
  initial: `asking`,
  context: ({ input }) => ({
    channelId: input.channelId,
    config: input.config,
    filters: input.filters,
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
            // Out of attempts. Further messages are ignored rather than
            // penalised, so nobody can brute force the answer and nobody loses
            // anything by continuing to talk in the channel.
            guard: `outOfGuesses`,
            actions: []
          },
          {
            guard: `isCorrect`,
            target: `revealing`,
            actions: [
              recordAttempt,
              assign({
                scores: ({ context, event }) => {
                  if (event.type !== `ANSWER`) return context.scores;
                  // Wrong guesses this player already made on this question.
                  const missed = context.attempts.filter(
                    (a) => a.userId === event.userId && !a.correct
                  ).length;
                  return {
                    ...context.scores,
                    [event.userId]:
                      (context.scores[event.userId] ?? 0) +
                      pointsFor(missed, context.config.guesses)
                  };
                },
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
        // The intro pause happens here: the session starts in `asking` with
        // question one already stored, and holds before anyone sees it.
        PAUSE: {
          target: `paused`,
          actions: assign({
            deadline: ({ event }) =>
              event.type === `PAUSE` ? event.until : null
          })
        },
        CONFIGURE: { actions: applyConfig },
        END: { target: `finished`, actions: assign({ deadline: null }) }
      }
    },

    /**
     * Holding between questions.
     *
     * The intro and the periodic standings both need the channel to have a
     * moment to read before the next prompt lands. The wait runs on the same
     * alarm as the question timeout rather than a `setTimeout`, because a
     * Worker's JS timers die with the isolate — a paused session would simply
     * never resume, which is the failure the timeout already taught us about.
     */
    paused: {
      // Deliberately NOT guarded on `sessionOver`. This state covers two
      // different waits: the intro, which holds question one *before* anyone
      // has answered it, and the standings break between questions. Ending here
      // on the question count would finish a one-question session during its
      // own introduction. `revealing` carries the guard instead, since that is
      // the state a resolved question passes through.
      on: {
        // Opens the question already in context rather than advancing to a new
        // one. The intro pause holds question ONE, which is stored and counted
        // before anyone sees it — `NEXT` there would skip straight to two.
        RESUME: {
          target: `asking`,
          actions: assign({
            attempts: [],
            closedBy: null,
            deadline: ({ context, event }) =>
              event.type === `RESUME`
                ? event.now + context.config.timeoutMs
                : null
          })
        },
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
        CONFIGURE: { actions: applyConfig },
        END: { target: `finished` }
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
        PAUSE: {
          target: `paused`,
          actions: assign({
            deadline: ({ event }) =>
              event.type === `PAUSE` ? event.until : null
          })
        },
        CONFIGURE: { actions: applyConfig },
        END: { target: `finished` }
      }
    },

    /** Over. Nothing more is scored and no alarm is armed. */
    /**
     * Over. Nothing more is scored and no alarm is armed.
     *
     * `question` is deliberately KEPT. The last question reaches this state
     * directly from `asking`, and its reveal has not been posted yet — clearing
     * it here left the final round with nothing to show, so the session ended
     * silently. Only the deadline goes, because that is what arms the alarm.
     */
    finished: {
      type: `final`,
      entry: assign({ deadline: null })
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
  /**
   * XState's own persisted-snapshot shape, not `unknown`.
   *
   * Typing it precisely is what lets `restore` hand it straight back to
   * `createActor` without a cast — and a cast here would be load-bearing, since
   * a snapshot that failed to restore would silently reset a session's scores
   * on the next wake from hibernation.
   */
  snapshot: ReturnType<SessionActor[`getPersistedSnapshot`]>;
}

/** Ignored by {@link restore}; see the note there. */
const RESTORE_INPUT = {
  channelId: ``,
  question: null as unknown as Question,
  config: DEFAULT_CONFIG,
  filters: { levels: [], types: [], classes: [], forms: [] } as Filters,
  now: 0
};

export const persist = (actor: SessionActor): PersistedSession => ({
  snapshot: actor.getPersistedSnapshot()
});

/**
 * Rebuild a running machine from what was stored.
 *
 * `input` is required by the type even here, because the machine declares one —
 * but restoring takes its context from the snapshot and ignores it. Passing a
 * placeholder satisfies the signature without pretending the value is used; the
 * round-trip test proves the restored context comes from the snapshot rather
 * than from this.
 */
export const restore = (persisted: PersistedSession): SessionActor => {
  const actor = createActor(sessionMachine, {
    snapshot: persisted.snapshot,
    input: RESTORE_INPUT
  });
  actor.start();
  return actor;
};

/** Begin a session. */
export const begin = (
  channelId: string,
  question: Question,
  config: SessionConfig,
  filters: Filters,
  now: number
): SessionActor => {
  const actor = createActor(sessionMachine, {
    input: { channelId, question, config, filters, now }
  });
  actor.start();
  return actor;
};

import type { Question } from "./question.js";

/**
 * The rules of a session, as data.
 *
 * Kept separate from the Durable Object so the state machine can be tested as
 * plain functions: every transition here is a pure `(state, event) -> state`,
 * and the object's job is only to persist the result and set an alarm. A state
 * machine that can only be exercised through workerd is one whose edge cases
 * go untested.
 */

export interface Scores {
  /** Discord user id -> points this session. */
  [userId: string]: number;
}

export interface Attempt {
  userId: string;
  /** What they typed, folded to kana for display in the round-end embed. */
  answer: string;
  correct: boolean;
}

export interface SessionConfig {
  /** How many questions, or `null` for endless. */
  length: number | null;
  /** Milliseconds a question stays open. */
  timeoutMs: number;
  /** Consecutive timeouts that end an endless session. */
  quitAfterTimeouts: number;
}

export interface SessionState {
  channelId: string;
  config: SessionConfig;
  /** 1-based; the question currently open. */
  questionNumber: number;
  question: Question | null;
  /** Attempts at the open question, one per player. */
  attempts: Attempt[];
  scores: Scores;
  /** Consecutive timeouts, reset by any answered question. */
  timeoutStreak: number;
  /** When the open question expires, as an epoch millisecond timestamp. */
  deadline: number | null;
  finished: boolean;
}

/** What happened, for the caller to turn into Discord messages. */
export type Outcome =
  | { kind: `ignored`; reason: `not-playing` | `already-answered` | `finished` }
  | { kind: `wrong` }
  | { kind: `correct`; userId: string; points: number }
  | { kind: `timeout` };

export const DEFAULT_CONFIG: SessionConfig = {
  length: 10,
  timeoutMs: 120_000,
  quitAfterTimeouts: 3
};

export const start = (
  channelId: string,
  question: Question,
  config: SessionConfig,
  now: number
): SessionState => ({
  channelId,
  config,
  questionNumber: 1,
  question,
  attempts: [],
  scores: {},
  timeoutStreak: 0,
  deadline: now + config.timeoutMs,
  finished: false
});

/**
 * Record an answer.
 *
 * `correct` is decided by the caller, which owns the scorer — this function is
 * about what an answer *does* to the session, not whether it is right.
 *
 * One guess per player per question: a second message from someone who has
 * already answered is ignored rather than penalised, so a player cannot brute
 * force the answer and cannot lose anything by typing in the channel.
 */
export const answer = (
  state: SessionState,
  userId: string,
  typed: string,
  correct: boolean
): { state: SessionState; outcome: Outcome } => {
  if (state.finished || state.question === null) {
    return { state, outcome: { kind: `ignored`, reason: `finished` } };
  }
  if (state.attempts.some((a) => a.userId === userId)) {
    return { state, outcome: { kind: `ignored`, reason: `already-answered` } };
  }

  const attempts = [...state.attempts, { userId, answer: typed, correct }];

  if (!correct) {
    return { state: { ...state, attempts }, outcome: { kind: `wrong` } };
  }

  // The first correct answer takes the point and closes the question. Later
  // messages find `question === null` and are ignored, so a race between two
  // near-simultaneous answers is settled by arrival order — which the Gateway
  // already sequences for us.
  const points = (state.scores[userId] ?? 0) + 1;
  return {
    state: {
      ...state,
      attempts,
      scores: { ...state.scores, [userId]: points },
      question: null,
      deadline: null,
      timeoutStreak: 0
    },
    outcome: { kind: `correct`, userId, points }
  };
};

/** Close the open question because nobody answered in time. */
export const timeout = (
  state: SessionState
): { state: SessionState; outcome: Outcome } => {
  if (state.finished || state.question === null) {
    return { state, outcome: { kind: `ignored`, reason: `finished` } };
  }
  return {
    state: {
      ...state,
      question: null,
      deadline: null,
      timeoutStreak: state.timeoutStreak + 1
    },
    outcome: { kind: `timeout` }
  };
};

/**
 * Is the session over?
 *
 * A fixed session ends once it has asked its last question. An endless one ends
 * when the room goes quiet, measured as consecutive timeouts — consecutive
 * because a single unanswered hard question is not the same signal as everyone
 * having wandered off.
 */
export const isOver = (state: SessionState): boolean => {
  if (state.config.length === null) {
    return state.timeoutStreak >= state.config.quitAfterTimeouts;
  }
  return state.questionNumber >= state.config.length;
};

/**
 * Move to the next question, or finish.
 *
 * Called only once the open question has closed. The caller supplies the next
 * question because generating one needs the corpus, which the session object
 * deliberately does not carry.
 */
export const advance = (
  state: SessionState,
  next: Question,
  now: number
): SessionState => {
  if (state.finished) return state;
  if (isOver(state)) return { ...state, finished: true, deadline: null };

  return {
    ...state,
    questionNumber: state.questionNumber + 1,
    question: next,
    attempts: [],
    deadline: now + state.config.timeoutMs
  };
};

/** End the session early, for `/quiz end`. */
export const finish = (state: SessionState): SessionState => ({
  ...state,
  question: null,
  deadline: null,
  finished: true
});

/** Scores as a leaderboard, highest first. */
export const leaderboard = (
  state: SessionState
): Array<{ userId: string; points: number }> =>
  Object.entries(state.scores)
    .map(([userId, points]) => ({ userId, points }))
    .sort((a, b) => b.points - a.points);

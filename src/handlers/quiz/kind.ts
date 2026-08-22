import type { Embed } from "@discordkit/client";

/**
 * What one kind of quiz has to provide.
 *
 * The session machine, the Durable Object and the flow never read a question's
 * fields — they carry it, time it and score it. Everything that knows what a
 * question *is* lives behind this interface, so a second quiz (JLPT-style
 * multiple choice) plugs in without touching any of them.
 */

/**
 * Common to every quiz. Each kind adds its own fields.
 *
 * The session machine and the Durable Object still name the concrete
 * `Question`, not this. Retargeting them was tried and reverted: they hand the
 * question back through an RPC surface the flow renders from, so widening the
 * type only moved the narrowing into casts at that boundary. Generalise them
 * when a second kind exists and the real shape is known.
 */
export interface BaseQuestion {
  /** Identifies the source material, for corpus checks and repeat avoidance. */
  wordId: string;
  /** What the channel is shown. */
  prompt: string;
}

export interface Judgement {
  correct: boolean;
  /** What the input was compared against. */
  expected: string;
  /** The input in its compared form, for showing a player their attempt. */
  normalized: string;
}

export interface Grader<Q> {
  /**
   * Is this message aimed at the question, or channel conversation?
   *
   * Every message in the channel reaches the handler, so without this "lol
   * same" takes a ❌ and costs somebody an attempt.
   */
  isAttempt: (input: string, question: Q) => boolean;
  grade: (input: string, question: Q) => Judgement;
}

/** The embeds a quiz kind renders. Session-level embeds are shared. */
export interface Presenter<Q> {
  question: (question: Q, number: number, total: number | null) => Embed;
  reveal: (
    question: Q,
    outcome: { winner: string | null; points?: number; total?: number },
    attempts: ReadonlyArray<{
      userId: string;
      answer: string;
      correct: boolean;
    }>
  ) => Embed;
  hint: (question: Q) => Embed;
  review: (
    miss: { question: Q; answer: string; questionNumber: number },
    attempted: boolean
  ) => Embed;
}

export interface QuizKind<Q extends BaseQuestion> {
  grader: Grader<Q>;
  present: Presenter<Q>;
}

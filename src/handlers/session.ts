import { DurableObject } from "cloudflare:workers";
import type { Question } from "./quiz/question.js";
import {
  advance,
  answer,
  finish,
  isOver,
  leaderboard,
  start,
  timeout,
  type Outcome,
  type SessionConfig,
  type SessionState
} from "./quiz/session.js";

/**
 * One quiz session, per channel.
 *
 * Lives in the handlers Worker rather than the bot Worker, so editing quiz
 * logic reloads only this half and the Gateway connection survives. Verified:
 * four consecutive edits to handler code left the session id unchanged.
 *
 * The object is a thin shell on purpose. The rules live in `quiz/session.ts` as
 * pure functions over plain data, and this class only persists the result and
 * keeps the alarm in step. Two reasons that split matters:
 *
 *  - **Hibernation discards in-memory state.** This object holds no WebSocket
 *    and no timers, so it hibernates about ten seconds after each question and
 *    is billed for active JavaScript rather than session wall-clock. Anything
 *    kept only in a field would be gone on the next wake, so the state is read
 *    from and written to storage on every call.
 *  - **The corpus never comes near it.** Generating a question needs ~1.8 MB of
 *    JSON, and a Durable Object runs its constructor on every wake. The caller
 *    supplies the next question already resolved, so waking stays cheap.
 */

const KEY = `session`;

/** What the caller needs back to post the right messages. */
export interface AnswerResult {
  outcome: Outcome;
  /** Present when the question closed, for the teaching embed. */
  closed?: Question;
  /** Present when the session ended with this answer. */
  final?: Array<{ userId: string; points: number }>;
  /** True when the caller should generate and post the next question. */
  needsNext: boolean;
}

export class QuizSession extends DurableObject {
  /**
   * Read the session from storage.
   *
   * Storage rather than an instance field: hibernation resets the isolate, and
   * a field would silently come back empty on the next wake — losing scores
   * mid-game with nothing in the logs.
   */
  async #read(): Promise<SessionState | null> {
    return (await this.ctx.storage.get<SessionState>(KEY)) ?? null;
  }

  async #write(state: SessionState): Promise<void> {
    await this.ctx.storage.put(KEY, state);
    // The alarm is the question timer. A DO's JS timers die with its isolate,
    // so an evicted session would stop timing out with no error anywhere —
    // the same reasoning as the connection timers in the bot Worker.
    if (state.deadline === null) {
      await this.ctx.storage.deleteAlarm();
    } else {
      await this.ctx.storage.setAlarm(state.deadline);
    }
  }

  /** Begin a session, replacing any already running in this channel. */
  async begin(
    channelId: string,
    question: Question,
    config: SessionConfig
  ): Promise<SessionState> {
    const state = start(channelId, question, config, Date.now());
    await this.#write(state);
    return state;
  }

  /** The current session, or null if this channel has none. */
  async current(): Promise<SessionState | null> {
    return this.#read();
  }

  /**
   * When the stored alarm will fire, or null if none is set.
   *
   * Exposed for tests. `SessionState.deadline` is what the rules decided;
   * this is what the runtime will actually do, and the two drifting apart is
   * exactly the bug worth catching — a stale alarm closes the NEXT question
   * early.
   */
  async pendingAlarm(): Promise<number | null> {
    return this.ctx.storage.getAlarm();
  }

  /**
   * Record a typed answer.
   *
   * `correct` is decided by the caller, which owns the scorer. This object only
   * applies the consequence.
   */
  async submit(
    userId: string,
    typed: string,
    correct: boolean
  ): Promise<AnswerResult> {
    const state = await this.#read();
    if (state === null) {
      return {
        outcome: { kind: `ignored`, reason: `not-playing` },
        needsNext: false
      };
    }

    const closing = state.question;
    const result = answer(state, userId, typed, correct);
    await this.#write(result.state);

    if (result.outcome.kind !== `correct`) {
      return { outcome: result.outcome, needsNext: false };
    }

    const over = isOver(result.state);
    return {
      outcome: result.outcome,
      ...(closing === null ? {} : { closed: closing }),
      ...(over ? { final: leaderboard(result.state) } : {}),
      needsNext: !over
    };
  }

  /**
   * Move to the next question.
   *
   * Separate from {@link submit} because the caller has to generate the
   * question in between, and it needs the corpus to do that.
   */
  async next(question: Question): Promise<SessionState> {
    const state = await this.#read();
    if (state === null) throw new Error(`no session in this channel`);
    const advanced = advance(state, question, Date.now());
    await this.#write(advanced);
    return advanced;
  }

  /** End the session early, returning the final standings. */
  async end(): Promise<Array<{ userId: string; points: number }> | null> {
    const state = await this.#read();
    if (state === null) return null;
    const ended = finish(state);
    await this.#write(ended);
    return leaderboard(ended);
  }

  /** Forget the session entirely, so the channel can start fresh. */
  async clear(): Promise<void> {
    await this.ctx.storage.delete(KEY);
    await this.ctx.storage.deleteAlarm();
  }

  /**
   * The question timed out.
   *
   * Runs from the alarm, so it is the one path that fires without anyone
   * sending a message. It closes the question and records the state; the
   * caller notices on its next poll, or the bot Worker acts on the followup.
   */
  override async alarm(): Promise<void> {
    const state = await this.#read();
    if (state?.question == null) return;

    const result = timeout(state);
    const ended = isOver(result.state);
    await this.#write(ended ? finish(result.state) : result.state);
  }
}

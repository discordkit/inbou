import { DurableObject } from "cloudflare:workers";
import {
  begin,
  leaderboard,
  persist,
  restore,
  type PersistedSession,
  type SessionConfig,
  type SessionContext,
  type SessionSnapshot
} from "./quiz/machine.js";
import type { Question } from "./quiz/question.js";

/**
 * One quiz session, per channel.
 *
 * Lives in the handlers Worker rather than the bot Worker, so editing quiz
 * logic reloads only this half and the Gateway connection survives. Verified:
 * four consecutive edits to handler code left the session id unchanged.
 *
 * The rules are an XState machine in `quiz/machine.ts`; this class persists it
 * and keeps the alarm in step. Two constraints shape that division:
 *
 *  - **Hibernation discards in-memory state.** This object holds no WebSocket
 *    and no timers, so it hibernates about ten seconds after each question and
 *    is billed for active JavaScript rather than session wall-clock. The
 *    machine is therefore rebuilt from a persisted snapshot on every call
 *    rather than held in a field.
 *  - **The corpus never comes near it.** Generating a question needs ~1.8 MB of
 *    JSON, and a Durable Object runs its constructor on every wake. The caller
 *    supplies the next question already resolved, so waking stays cheap.
 *
 * The alarm is armed from the machine's *state name*, not from a boolean. Only
 * `asking` has a deadline, so "closed question with a live alarm" — the stale
 * alarm that once closed the following question early — cannot be expressed.
 */

const KEY = `session`;

/** A snapshot flattened for callers that only need to render it. */
export interface SessionView {
  state: `asking` | `revealing` | `finished`;
  context: SessionContext;
}

/** What the caller needs back to post the right messages. */
export interface AnswerResult {
  outcome:
    | {
        kind: `ignored`;
        reason: `not-playing` | `already-answered` | `finished`;
      }
    | { kind: `wrong` }
    | { kind: `correct`; userId: string; points: number };
  /** Present when the question closed, for the teaching embed. */
  closed?: Question;
  /** Present when the session ended with this answer. */
  final?: Array<{ userId: string; points: number }>;
  /** True when the caller should generate and post the next question. */
  needsNext: boolean;
}

const view = (snapshot: SessionSnapshot): SessionView => ({
  state: snapshot.value,
  context: snapshot.context
});

export class QuizSession extends DurableObject {
  /**
   * Rebuild the machine from storage.
   *
   * Storage rather than an instance field: hibernation resets the isolate, and
   * a field would silently come back empty on the next wake — losing scores
   * mid-game with nothing in the logs.
   */
  async #load(): Promise<ReturnType<typeof restore> | null> {
    const persisted = await this.ctx.storage.get<PersistedSession>(KEY);
    return persisted === undefined ? null : restore(persisted);
  }

  async #save(actor: ReturnType<typeof restore>): Promise<void> {
    const snapshot = actor.getSnapshot();
    await this.ctx.storage.put(KEY, persist(actor));

    // The alarm is the question timer, and it follows the machine's state. A
    // DO's JS timers die with its isolate, so an evicted session would stop
    // timing out with no error anywhere — the same reasoning as the connection
    // timers in the bot Worker.
    const deadline =
      snapshot.value === `asking` ? snapshot.context.deadline : null;
    if (deadline === null) {
      await this.ctx.storage.deleteAlarm();
    } else {
      await this.ctx.storage.setAlarm(deadline);
    }
  }

  /** Begin a session, replacing any already running in this channel. */
  async begin(
    channelId: string,
    question: Question,
    config: SessionConfig
  ): Promise<SessionView> {
    const actor = begin(channelId, question, config, Date.now());
    await this.#save(actor);
    return view(actor.getSnapshot());
  }

  /** The current session, or null if this channel has none. */
  async current(): Promise<SessionView | null> {
    const actor = await this.#load();
    return actor === null ? null : view(actor.getSnapshot());
  }

  /**
   * When the stored alarm will fire, or null if none is set.
   *
   * Exposed for tests. The machine's `deadline` is what the rules decided; this
   * is what the runtime will actually do, and the two drifting apart is exactly
   * the bug worth catching — a stale alarm closes the NEXT question early.
   */
  async pendingAlarm(): Promise<number | null> {
    return  this.ctx.storage.getAlarm();
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
    const actor = await this.#load();
    if (actor === null) {
      return {
        outcome: { kind: `ignored`, reason: `not-playing` },
        needsNext: false
      };
    }

    const before = actor.getSnapshot();
    if (before.value === `finished`) {
      return {
        outcome: { kind: `ignored`, reason: `finished` },
        needsNext: false
      };
    }
    if (before.value === `revealing`) {
      // The question already closed; a late answer is not scored.
      return {
        outcome: { kind: `ignored`, reason: `finished` },
        needsNext: false
      };
    }
    if (before.context.attempts.some((a) => a.userId === userId)) {
      return {
        outcome: { kind: `ignored`, reason: `already-answered` },
        needsNext: false
      };
    }

    const closing = before.context.question;
    actor.send({ type: `ANSWER`, userId, typed, correct, now: Date.now() });
    const after = actor.getSnapshot();
    await this.#save(actor);

    if (!correct) return { outcome: { kind: `wrong` }, needsNext: false };

    const points = after.context.scores[userId] ?? 0;
    const over = after.value === `finished`;
    return {
      outcome: { kind: `correct`, userId, points },
      ...(closing === null ? {} : { closed: closing }),
      ...(over ? { final: leaderboard(after.context) } : {}),
      needsNext: !over
    };
  }

  /**
   * Move to the next question.
   *
   * Separate from {@link submit} because the caller has to generate the
   * question in between, and it needs the corpus to do that.
   */
  async next(question: Question): Promise<SessionView> {
    const actor = await this.#load();
    if (actor === null) throw new Error(`no session in this channel`);
    actor.send({ type: `NEXT`, question, now: Date.now() });
    await this.#save(actor);
    return view(actor.getSnapshot());
  }

  /** End the session early, returning the final standings. */
  async end(): Promise<Array<{ userId: string; points: number }> | null> {
    const actor = await this.#load();
    if (actor === null) return null;
    actor.send({ type: `END` });
    await this.#save(actor);
    return leaderboard(actor.getSnapshot().context);
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
   * sending a message.
   */
  override async alarm(): Promise<void> {
    const actor = await this.#load();
    if (actor === null) return;
    if (actor.getSnapshot().value !== `asking`) return;

    actor.send({ type: `TIMEOUT` });
    await this.#save(actor);
  }
}

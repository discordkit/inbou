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
import type { Filters, Question } from "./quiz/question.js";

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
/**
 * What a finished session leaves behind.
 *
 * Returned by {@link QuizSession.end} rather than assembled by the caller: the
 * points, the guild and the correct counts all live in the machine's context,
 * and reading them separately would mean three round trips to the object for
 * one fact about one moment.
 */
export interface SessionOutcome {
  /** Null in a DM, where there is no leaderboard to write to. */
  guildId: string | null;
  standings: Array<{ userId: string; points: number }>;
  /** How many each player answered correctly, keyed by user id. */
  correct: Record<string, number>;
}

export interface SessionView {
  state: `asking` | `revealing` | `paused` | `finished`;
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
    | {
        kind: `correct`;
        userId: string;
        /** What this answer earned. */
        points: number;
        /** Their session total afterwards. */
        total: number;
      };
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

/** What the session object needs from its environment. */
interface SessionEnv {
  /** This Worker, bound to itself. See the alarm handler for why. */
  SELF: Fetcher;
}

export class QuizSession extends DurableObject<SessionEnv> {
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
    // `paused` arms it too: the wait between questions runs on the same alarm,
    // because a Worker's JS timers die with the isolate and a paused session
    // would otherwise never resume.
    const deadline =
      snapshot.value === `asking` || snapshot.value === `paused`
        ? snapshot.context.deadline
        : null;
    if (deadline === null) {
      await this.ctx.storage.deleteAlarm();
    } else {
      await this.ctx.storage.setAlarm(deadline);
    }
  }

  /** Begin a session, replacing any already running in this channel. */
  async begin(
    channelId: string,
    guildId: string | null,
    question: Question,
    config: SessionConfig,
    filters: Filters
  ): Promise<SessionView> {
    const actor = begin(
      channelId,
      guildId,
      question,
      config,
      filters,
      Date.now()
    );
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
    if (before.value !== `asking`) {
      // Nothing is being asked. `revealing` means the question already closed,
      // and `paused` is the intro or a standings break — scoring then would
      // hand a point to whoever typed during the countdown, for a question the
      // channel has not been shown.
      return {
        outcome: { kind: `ignored`, reason: `finished` },
        needsNext: false
      };
    }
    // Out of attempts. The count comes from the session's own config rather
    // than a hard-coded one-per-player: this object used to reject every second
    // guess, which made the machine's `outOfGuesses` guard unreachable and
    // multi-guess quietly not work at all.
    const used = before.context.attempts.filter(
      (a) => a.userId === userId
    ).length;
    if (used >= before.context.config.guesses) {
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

    // What THIS answer earned, not the running total. Reporting the total made
    // the reveal say "20 points" for a four-point answer on question ten, which
    // is precisely the confusion the per-answer figure exists to remove.
    const earned =
      (after.context.scores[userId] ?? 0) -
      (before.context.scores[userId] ?? 0);
    const over = after.value === `finished`;
    return {
      outcome: {
        kind: `correct`,
        userId,
        points: earned,
        total: after.context.scores[userId] ?? 0
      },
      ...(closing === null ? {} : { closed: closing }),
      ...(over ? { final: leaderboard(after.context) } : {}),
      needsNext: !over
    };
  }

  /**
   * Open the question already stored, without advancing past it.
   *
   * Used when a pause ends over a question nobody has seen yet — the intro
   * holds question one, which is already stored and counted.
   */
  async resume(): Promise<SessionView | null> {
    const actor = await this.#load();
    if (actor === null) return null;
    actor.send({ type: `RESUME`, now: Date.now() });
    await this.#save(actor);
    return view(actor.getSnapshot());
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

  /**
   * Hold before the next question, so the channel can read what just happened.
   *
   * Runs on the same alarm as the question timeout. A `setTimeout` would not
   * survive the isolate being evicted, and a paused session that never resumes
   * looks exactly like the bot having stopped.
   */
  async pause(ms: number): Promise<void> {
    const actor = await this.#load();
    if (actor === null) return;
    actor.send({ type: `PAUSE`, until: Date.now() + ms });
    await this.#save(actor);
  }
  /**
   * Apply new settings, from the next question onward.
   *
   * Never mid-question: moving a deadline players are already racing would be
   * unfair, and new filters cannot change what has already been asked.
   */
  async configure(settings: {
    session: SessionConfig;
    filters: Filters;
  }): Promise<void> {
    const actor = await this.#load();
    if (actor === null) return;
    actor.send({
      type: `CONFIGURE`,
      config: settings.session,
      filters: settings.filters
    });
    await this.#save(actor);
  }

  /**
   * End the session early, returning the final standings.
   *
   * The guild and the per-player correct counts come back with the points
   * because this is the moment the session becomes a leaderboard entry, and
   * the caller cannot recover either afterwards — `clear` drops the state, and
   * the guild was never on the event that ends a timed-out session.
   */
  async end(): Promise<SessionOutcome | null> {
    const actor = await this.#load();
    if (actor === null) return null;
    actor.send({ type: `END` });
    await this.#save(actor);
    const { context } = actor.getSnapshot();
    return {
      guildId: context.guildId,
      standings: leaderboard(context),
      correct: context.correct
    };
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

    const state = actor.getSnapshot().value;
    // A pause ending is not a timeout — the question already closed. Both wake
    // the Worker the same way; it reads the state to know which happened.
    if (state === `asking`) {
      actor.send({ type: `TIMEOUT` });
      await this.#save(actor);
    } else if (state !== `paused`) {
      return;
    }

    // Hand the rest back to the Worker. This object can close the question,
    // but posting the reveal is a REST call and choosing the next question
    // needs the corpus — neither belongs in an object that wakes from
    // hibernation on every question.
    const { channelId } = actor.getSnapshot().context;
    await this.env.SELF.fetch(`https://handlers/event`, {
      method: `POST`,
      body: JSON.stringify({
        type: state === `paused` ? `SESSION_RESUME` : `SESSION_TIMEOUT`,
        channelId
      })
    });
  }
}

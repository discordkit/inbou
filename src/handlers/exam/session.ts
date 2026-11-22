import { DurableObject } from "cloudflare:workers";
import {
  begin,
  castVote,
  closeQuestion,
  persist,
  restore,
  viewOf,
  type Closed,
  type ExamActor,
  type ExamEvent,
  type ExamInput,
  type ExamView,
  type PersistedExam,
  type Reply,
  type VoteResult
} from "./machine.js";

/**
 * One mock test, per channel.
 *
 * A separate class from `QuizSession`, not a mode of it: the quiz is a race and
 * this is a poll, and their rules are opposites. See the spec, section 8.
 *
 * It follows the quiz session's two constraints:
 *
 *  - **Hibernation discards in-memory state**, so the machine is rebuilt from
 *    storage on every call rather than held in a field.
 *  - **The corpus never comes near it.** The flow draws the whole test in the
 *    handlers Worker and hands over the resolved questions, a few kilobytes.
 *
 * The rules themselves live in `machine.ts` — including which votes count —
 * so this class only loads, applies and saves. The alarm is armed from the
 * machine's state name, not from a flag: only `asking` (the question timer)
 * and `paused` (the wait) have a deadline, so a closed question with a live
 * alarm cannot be expressed.
 */

const KEY = `exam`;

/** What the object needs from its environment. */
interface ExamEnv {
  /** This Worker, bound to itself. See the alarm handler for why. */
  SELF: Fetcher;
}

export class ExamSession extends DurableObject<ExamEnv> {
  /** Storage rather than a field: hibernation resets the isolate. */
  async #load(): Promise<ExamActor | null> {
    const persisted = await this.ctx.storage.get<PersistedExam>(KEY);
    return persisted === undefined ? null : restore(persisted);
  }

  async #save(actor: ExamActor): Promise<void> {
    const snapshot = actor.getSnapshot();
    await this.ctx.storage.put(KEY, persist(actor));

    // JS timers die with the isolate, so the timer is the alarm.
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

  async #send(event: ExamEvent): Promise<ExamView | null> {
    const actor = await this.#load();
    if (actor === null) return null;
    actor.send(event);
    await this.#save(actor);
    return viewOf(actor);
  }

  /** Begin a test, replacing any finished one in this channel. */
  async begin(input: ExamInput): Promise<ExamView> {
    const actor = begin(input);
    await this.#save(actor);
    return viewOf(actor);
  }

  /** The test in this channel, or null if there has never been one. */
  async current(): Promise<ExamView | null> {
    const actor = await this.#load();
    return actor === null ? null : viewOf(actor);
  }

  /**
   * When the stored alarm will fire. Exposed for tests: `deadline` is what the
   * rules decided, this is what the runtime will do, and the two drifting apart
   * is the stale-alarm bug.
   */
  async pendingAlarm(): Promise<number | null> {
    return this.ctx.storage.getAlarm();
  }

  async vote(
    userId: string,
    token: string,
    option: number,
    reply?: Reply
  ): Promise<VoteResult> {
    const actor = await this.#load();
    if (actor === null) return { outcome: `not-open` };
    const result = castVote(actor, {
      userId,
      token,
      option,
      ...(reply === undefined ? {} : { reply })
    });
    if (result.outcome === `recorded` || result.outcome === `changed`) {
      await this.#save(actor);
    }
    return result;
  }

  async close(): Promise<Closed | null> {
    const actor = await this.#load();
    if (actor === null) return null;
    const closed = closeQuestion(actor);
    if (closed !== null) await this.#save(actor);
    return closed;
  }

  /** Open the current question without advancing. The intro holds question one. */
  async resume(): Promise<ExamView | null> {
    return this.#send({ type: `RESUME`, now: Date.now() });
  }

  /** Open the next question. */
  async next(): Promise<ExamView | null> {
    return this.#send({ type: `NEXT`, now: Date.now() });
  }

  /** Hold before the next question, on the same alarm as the timer. */
  async pause(ms: number): Promise<void> {
    await this.#send({ type: `PAUSE`, until: Date.now() + ms });
  }

  /** Remember which message the open question was posted as. */
  async posted(messageId: string): Promise<void> {
    await this.#send({ type: `POSTED`, messageId });
  }

  /**
   * End the test. Kept, not cleared: the results button reads it afterwards,
   * until the next test in this channel replaces it.
   */
  async end(): Promise<ExamView | null> {
    return this.#send({ type: `END` });
  }

  /**
   * The one path that fires without anyone pressing anything.
   *
   * Only forwards. Closing the question and posting the reveal happen in the
   * flow, which can make REST calls; this object hibernates between questions.
   */
  override async alarm(): Promise<void> {
    const actor = await this.#load();
    if (actor === null) return;

    const state = actor.getSnapshot().value;
    // Anything else means a stale alarm, which is ignored rather than acted on.
    if (state !== `asking` && state !== `paused`) return;

    const { channelId } = actor.getSnapshot().context;
    const response = await this.env.SELF.fetch(`https://handlers/event`, {
      method: `POST`,
      body: JSON.stringify({
        type: state === `paused` ? `EXAM_RESUME` : `EXAM_TIMEOUT`,
        channelId
      })
    });
    // The handlers answer at once and work afterwards; nothing here reads the answer.
    await response.body?.cancel();
  }
}

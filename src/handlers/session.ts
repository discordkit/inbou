import { DurableObject } from "cloudflare:workers";

/**
 * SPIKE — does the handlers Worker get to own a Durable Object?
 *
 * The two-Worker split exists so app logic can be edited without tearing down
 * the Gateway session. Quiz sessions need durable per-channel state and a
 * timer that survives eviction, which means a Durable Object; the open
 * question was whether that object can live on the handlers side, where the
 * code changes, rather than in the bot Worker, where changes cost a session.
 *
 * It can. Verified under `vp run dev`: wrangler reports `QuizSession` against
 * `inbou-handlers` and `InbouBot` against `inbou` as separate SQLite-backed
 * namespaces, and four consecutive edits to handler code left the Gateway
 * session id unchanged while this object's storage kept counting.
 *
 * This class is deliberately minimal — it proves the wiring, not a session
 * model. Replace it when the real one lands; see
 * `docs/specs/conjugation-quiz.md`.
 */
export class QuizSession extends DurableObject {
  /**
   * The probe table.
   *
   * `ctx.storage.sql` is synchronous, so none of the methods below need to be
   * async for storage's sake — only `setAlarm` and `getAlarm` return promises.
   */
  #table(): void {
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY, n INTEGER NOT NULL)`
    );
  }

  /** Increment the counter at `id` and return its new value. */
  #increment(id: number): number {
    this.#table();
    this.ctx.storage.sql.exec(
      `INSERT INTO probe (id, n) VALUES (?, 1)
       ON CONFLICT (id) DO UPDATE SET n = n + 1`,
      id
    );
    return this.#read(id);
  }

  #read(id: number): number {
    this.#table();
    const [row] = this.ctx.storage.sql
      .exec<{ n: number }>(`SELECT n FROM probe WHERE id = ?`, id)
      .toArray();
    return row?.n ?? 0;
  }

  /**
   * Bump a counter in SQLite and hand back the new value.
   *
   * Storage rather than an instance field on purpose: an instance field would
   * survive only as long as the isolate, so a passing test would prove nothing
   * about durability. Reading it back from SQL is what shows the storage
   * backend is really wired up.
   */
  bump(): number {
    return this.#increment(1);
  }

  /** Schedule the alarm the question timeout will eventually use. */
  async scheduleIn(ms: number): Promise<void> {
    await this.ctx.storage.setAlarm(Date.now() + ms);
  }

  /** Whether an alarm is pending, and when. */
  async alarmAt(): Promise<number | null> {
    return this.ctx.storage.getAlarm();
  }

  /** Records that the alarm fired, so a test can observe it from outside. */
  override alarm(): void {
    this.#increment(99);
  }

  /** How many times the alarm has fired. */
  alarmCount(): number {
    return this.#read(99);
  }
}

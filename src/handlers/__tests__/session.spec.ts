import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { QuizSession } from "../session.js";

/**
 * SPIKE — can quiz sessions live in the handlers Worker?
 *
 * The two-Worker split exists so app logic reloads without restarting the
 * Gateway session. That only helps the quiz if its Durable Object can live on
 * the handlers side too; otherwise session state would drag the bot Worker
 * back into the edit loop and every change would cost a Discord IDENTIFY.
 *
 * These drive a real Durable Object declared by the HANDLERS Worker, so they
 * prove the binding resolves, SQLite storage works there, and alarms — which
 * the question timeout depends on — actually fire.
 */

// The pool types `env` from the ambient `Cloudflare.Env`, which wrangler
// generates from wrangler.jsonc. This project doesn't run `wrangler types`, so
// narrow it here rather than commit a generated file.
const sessionEnv = env as unknown as {
  SESSION: DurableObjectNamespace<QuizSession>;
};

const session = (name: string): DurableObjectStub<QuizSession> =>
  sessionEnv.SESSION.get(sessionEnv.SESSION.idFromName(name));

describe(`quizSession in the handlers Worker`, () => {
  it(`resolves a Durable Object declared outside the bot Worker`, async () => {
    // WHY: this is the spike's whole question. If the plugin could not give an
    // auxiliary Worker its own DO namespace, session state would have to live
    // in the bot Worker and every quiz edit would cost a Gateway session.
    await expect(session(`binding-probe`).bump()).resolves.toBe(1);
  });

  it(`persists state across calls, keyed per channel`, async () => {
    // WHY: sessions are per channel. Two channels must not share a question,
    // a score, or a timer — and the count has to come back from storage rather
    // than an instance field, or an evicted object would silently reset.
    const a = session(`channel-a`);
    const b = session(`channel-b`);

    await a.bump();
    await a.bump();

    await expect(a.bump()).resolves.toBe(3);
    // A different channel starts from scratch despite the same class.
    await expect(b.bump()).resolves.toBe(1);
  });

  it(`schedules an alarm, which the question timeout depends on`, async () => {
    // WHY: the spec replaces "skip" with a timeout, and a DO's JS timers die
    // with its isolate. Only an alarm survives eviction, so if alarms did not
    // work here the timeout would silently never fire for an idle channel.
    const stub = session(`alarm-probe`);
    await expect(stub.alarmAt()).resolves.toBeNull();

    await stub.scheduleIn(60_000);
    const at = await stub.alarmAt();

    expect(at).not.toBeNull();
    expect(at).toBeGreaterThan(Date.now());
  });

  it(`runs the alarm handler when the alarm comes due`, async () => {
    // WHY: scheduling is not firing. The timeout only works if the handler
    // actually runs, so this schedules one in the past and waits for the
    // runtime to deliver it.
    const stub = session(`alarm-fires`);
    await expect(stub.alarmCount()).resolves.toBe(0);

    await stub.scheduleIn(0);

    await expect
      .poll(async () => stub.alarmCount(), { timeout: 5_000 })
      .toBeGreaterThan(0);
  });
});

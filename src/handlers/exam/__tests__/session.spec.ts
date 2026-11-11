import { env } from "cloudflare:workers";
import { describe, expect, it } from "vite-plus/test";
import type { ExamQuestion } from "../draw.js";
import type { ExamSession } from "../session.js";

/**
 * The mock-test session inside workerd.
 *
 * The rules are covered in `machine.spec.ts`. These drive the real Durable
 * Object to prove what is not pure: state survives storage rather than living
 * in a field that hibernation discards, and the alarm the runtime will fire
 * matches what the rules decided. The alarm is read back from storage — a test
 * that read `deadline` instead once passed against broken alarm code.
 */

// The pool types `env` from wrangler.jsonc; narrow it as session.spec.ts does.
const examEnv = env as unknown as { EXAM: DurableObjectNamespace<ExamSession> };

const session = (name: string): DurableObjectStub<ExamSession> =>
  examEnv.EXAM.get(examEnv.EXAM.idFromName(name));

const question = (number: number): ExamQuestion => ({
  itemId: `n5-b1-${String(number).padStart(4, `0`)}`,
  slot: 1,
  mondai: 1,
  number,
  prompt: `ぶん（1）です。`,
  options: [`あ`, `い`, `う`, `え`],
  correct: 0,
  difficulty: 1,
  points: [`point`],
  en: `Sentence.`,
  note: `n`,
  token: `tok${String(number)}`,
  timeoutMs: 60_000
});

const input = (channelId: string, introUntil: number) => ({
  testId: `t1`,
  channelId,
  guildId: `guild`,
  test: `bunpou` as const,
  questions: [question(1), question(2)],
  introUntil
});

describe(`the exam session`, () => {
  it(`arms its alarm for the intro, the question, the pause — and never after a close`, async () => {
    // WHY: the alarm is the only timer a hibernating object has. Left armed
    // after a question closes, it fires on the NEXT question and closes it
    // early — the stale-alarm bug.
    const stub = session(`alarm-${String(Math.random())}`);
    const introUntil = Date.now() + 600_000;
    await stub.begin(input(`chan`, introUntil));
    await expect(stub.pendingAlarm()).resolves.toBe(introUntil);

    const opened = await stub.resume();
    expect(opened?.state).toBe(`asking`);
    await expect(stub.pendingAlarm()).resolves.toBe(opened?.context.deadline);

    await stub.close();
    await expect(stub.pendingAlarm()).resolves.toBeNull();

    await stub.pause(600_000);
    await expect(stub.pendingAlarm()).resolves.not.toBeNull();

    await stub.end();
    await expect(stub.pendingAlarm()).resolves.toBeNull();
  });

  it(`keeps votes across calls, and drops a stale one`, async () => {
    // WHY: each call may wake a fresh isolate. A vote held in a field would
    // vanish; a stale vote that was saved would count.
    const stub = session(`votes-${String(Math.random())}`);
    await stub.begin(input(`chan`, Date.now() + 600_000));
    await stub.resume();

    expect((await stub.vote(`ann`, `tok1`, 2)).outcome).toBe(`recorded`);
    expect((await stub.vote(`ben`, `old`, 1)).outcome).toBe(`stale`);
    expect((await stub.current())?.context.votes).toEqual({ ann: 2 });
  });

  it(`gives each channel its own test`, async () => {
    // WHY: one channel's test must not take another channel's votes.
    const a = session(`chan-a-${String(Math.random())}`);
    const b = session(`chan-b-${String(Math.random())}`);
    await a.begin(input(`a`, Date.now() + 600_000));
    await expect(b.current()).resolves.toBeNull();
  });
});

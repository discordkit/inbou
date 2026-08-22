import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Question } from "../quiz/question.js";
import { DEFAULT_CONFIG } from "../quiz/machine.js";
import type { QuizSession } from "../session.js";

/**
 * Does the session survive the runtime, not just the unit tests?
 *
 * The rules are covered as pure functions in `sessionState.spec.ts`. These
 * drive a real Durable Object inside workerd, which is the only way to prove
 * the parts that are not pure: that state round-trips through storage rather
 * than living in a field hibernation would discard, that each channel gets its
 * own object, and that the alarm the question timeout depends on really fires.
 */

// The pool types `env` from the ambient `Cloudflare.Env`, which wrangler
// generates from wrangler.jsonc. This project doesn't run `wrangler types`, so
// narrow it here rather than commit a generated file.
const sessionEnv = env as unknown as {
  SESSION: DurableObjectNamespace<QuizSession>;
};

const session = (name: string): DurableObjectStub<QuizSession> =>
  sessionEnv.SESSION.get(sessionEnv.SESSION.idFromName(name));

const GUILD = `guild-1`;
const ANY_FILTERS = { levels: [], types: [], classes: [], forms: [] };

const question = (id: string): Question => ({
  wordId: id,
  prompt: `うりません`,
  form: `non-past-negative`,
  answer: `うらない`,
  stem: `うら`,
  answerKanji: `売らない`,
  dictionary: `売る`,
  reading: `うる`,
  gloss: `to sell`,
  type: `verb`,
  verbClass: `godan-r`
});

describe(`quizSession in the handlers Worker`, () => {
  it(`resolves a Durable Object declared outside the bot Worker`, async () => {
    // WHY: the architecture rests on this. If the handlers Worker could not own
    // its own object, session state would have to live in the bot Worker and
    // every quiz edit would cost a Gateway session.
    const stub = session(`binding-probe`);
    await stub.clear();
    await expect(stub.current()).resolves.toBeNull();
  });

  it(`round-trips state through storage`, async () => {
    // WHY: this object hibernates about ten seconds after each question, which
    // discards everything in memory. State kept in a field would come back
    // empty on the next wake and quietly lose the scores mid-game.
    const stub = session(`round-trip`);
    await stub.clear();
    await stub.begin(
      `chan-1`,
      GUILD,
      question(`1`),
      DEFAULT_CONFIG,
      ANY_FILTERS
    );

    const state = await stub.current();
    expect(state?.context.channelId).toBe(`chan-1`);
    expect(state?.context.question?.answer).toBe(`うらない`);
    expect(state?.context.questionNumber).toBe(1);
    expect(state?.state).toBe(`asking`);
  });

  it(`keeps one session per channel`, async () => {
    // WHY: sessions are per channel. Two channels sharing a question, a score
    // or a timer would make either one unplayable.
    const a = session(`channel-a`);
    const b = session(`channel-b`);
    await a.clear();
    await b.clear();

    await a.begin(`chan-a`, GUILD, question(`1`), DEFAULT_CONFIG, ANY_FILTERS);
    await a.submit(`mika`, `うらない`, true);

    // Four points: correct on the first of three guesses.
    expect((await a.current())?.context.scores).toEqual({ mika: 4 });
    await expect(b.current()).resolves.toBeNull();
  });

  it(`scores the first correct answer and closes the question`, async () => {
    const stub = session(`scoring`);
    await stub.clear();
    await stub.begin(`chan`, GUILD, question(`1`), DEFAULT_CONFIG, ANY_FILTERS);

    const wrong = await stub.submit(`drake`, `うった`, false);
    expect(wrong.outcome).toEqual({ kind: `wrong` });

    const right = await stub.submit(`mika`, `うらない`, true);
    // `points` is what THIS answer earned; `total` is the running score. The
    // reveal reported only the total, so a four-point answer on question ten
    // read as "20 points".
    expect(right.outcome).toEqual({
      kind: `correct`,
      userId: `mika`,
      points: 4,
      total: 4
    });
    // The teaching embed needs the question that just closed.
    expect(right.closed?.answer).toBe(`うらない`);
    expect(right.needsNext).toBe(true);
  });

  it(`accepts every guess the config allows`, async () => {
    // WHY: this shipped broken and the flow tests could not see it. They drive
    // a stub built from the machine, which was correct all along — the object
    // kept its own one-guess-per-player check from before the rule changed, so
    // it rejected every second attempt and the machine's guard was unreachable.
    // In the channel a player's second and third guesses simply vanished: no
    // reaction, no score, no explanation.
    const stub = session(`multi-guess`);
    await stub.clear();
    await stub.begin(`chan`, GUILD, question(`1`), DEFAULT_CONFIG, ANY_FILTERS);

    const first = await stub.submit(`saeris`, `いきません`, false);
    const second = await stub.submit(`saeris`, `いきなかった`, false);
    expect(first.outcome).toEqual({ kind: `wrong` });
    expect(second.outcome).toEqual({ kind: `wrong` });

    // The third lands, and is worth two — four less one for each miss.
    const third = await stub.submit(`saeris`, `うらない`, true);
    expect(third.outcome).toEqual({
      kind: `correct`,
      userId: `saeris`,
      points: 2,
      total: 2
    });
  });

  it(`does not score an answer sent during a pause`, async () => {
    // WHY: the intro and the standings breaks both hold the session in
    // `paused`. Nothing is being asked, so a message arriving then is chatter —
    // scoring it would hand a point to whoever typed during the countdown.
    const stub = session(`answer-while-paused`);
    await stub.clear();
    await stub.begin(`chan`, GUILD, question(`1`), DEFAULT_CONFIG, ANY_FILTERS);
    await stub.pause(10_000);

    const result = await stub.submit(`mika`, `うらない`, true);
    expect(result.outcome.kind).toBe(`ignored`);
  });

  it(`stops once a player is out of guesses`, async () => {
    // WHY: the limit still has to hold, or a fast typist could brute force the
    // answer by working through the possibilities.
    const stub = session(`out-of-guesses`);
    await stub.clear();
    await stub.begin(
      `chan`,
      GUILD,
      question(`1`),
      { ...DEFAULT_CONFIG, guesses: 2 },
      ANY_FILTERS
    );

    await stub.submit(`saeris`, `a`, false);
    await stub.submit(`saeris`, `b`, false);
    const third = await stub.submit(`saeris`, `うらない`, true);

    expect(third.outcome).toEqual({
      kind: `ignored`,
      reason: `already-answered`
    });
  });

  it(`reports what one answer earned, not the running total`, async () => {
    // WHY: this shipped wrong, and only shows on the SECOND question — with one
    // question the two numbers are identical, so a single-question test cannot
    // tell them apart. In the channel a four-point answer on question ten read
    // as "20 points", which is exactly what made the final leaderboard look
    // arbitrary.
    const stub = session(`per-answer-points`);
    await stub.clear();
    await stub.begin(`chan`, GUILD, question(`1`), DEFAULT_CONFIG, ANY_FILTERS);
    await stub.submit(`mika`, `うらない`, true);
    await stub.next(question(`2`));

    const second = await stub.submit(`mika`, `うらない`, true);
    expect(second.outcome).toEqual({
      kind: `correct`,
      userId: `mika`,
      points: 4,
      total: 8
    });
  });

  it(`reports the final standings on the last question`, async () => {
    // WHY: the caller posts a leaderboard instead of a next question. Getting
    // this wrong would either drop the final scores or ask an extra question.
    const stub = session(`final`);
    await stub.clear();
    await stub.begin(
      `chan`,
      GUILD,
      question(`1`),
      { ...DEFAULT_CONFIG, length: 1 },
      ANY_FILTERS
    );

    const result = await stub.submit(`mika`, `うらない`, true);
    expect(result.needsNext).toBe(false);
    expect(result.final).toEqual([{ userId: `mika`, points: 4 }]);
  });

  it(`ignores answers when the channel has no session`, async () => {
    // WHY: every message in an active channel reaches the handler. A channel
    // that is not playing must not be charged for one, and must not throw.
    const stub = session(`idle`);
    await stub.clear();
    const result = await stub.submit(`drake`, `うらない`, true);
    expect(result.outcome).toEqual({ kind: `ignored`, reason: `not-playing` });
  });

  it(`schedules the timeout as an alarm`, async () => {
    // WHY: the spec replaces "skip" with a timeout, and a DO's JS timers die
    // with its isolate. Only an alarm survives eviction, so without this an
    // idle channel's question would stay open forever.
    const stub = session(`alarm-set`);
    await stub.clear();
    await stub.begin(
      `chan`,
      GUILD,
      question(`1`),
      {
        ...DEFAULT_CONFIG,
        timeoutMs: 60_000
      },
      ANY_FILTERS
    );

    const state = await stub.current();
    expect(state?.context.deadline).toBeGreaterThan(Date.now());
    // The stored alarm, not just the state that decided it.
    await expect(stub.pendingAlarm()).resolves.toBeGreaterThan(Date.now());
  });

  it(`closes the question when the alarm fires`, async () => {
    // WHY: scheduling is not firing. This sets a deadline in the past so the
    // runtime delivers the alarm, then watches the question close and the
    // streak advance — the path that ends a quiet endless session.
    const stub = session(`alarm-fires`);
    await stub.clear();
    await stub.begin(
      `chan`,
      GUILD,
      question(`1`),
      {
        ...DEFAULT_CONFIG,
        timeoutMs: 0
      },
      ANY_FILTERS
    );

    // The machine leaves `asking` when the alarm fires, which is also what
    // clears the stored alarm.
    await expect
      .poll(async () => (await stub.current())?.state, { timeout: 5_000 })
      .toBe(`revealing`);
    expect((await stub.current())?.context.timeoutStreak).toBe(1);
  });

  it(`clears the alarm once the question is answered`, async () => {
    // WHY: a stale alarm would fire against the next question and close it
    // early, cutting the round short for no visible reason.
    const stub = session(`alarm-cleared`);
    await stub.clear();
    await stub.begin(`chan`, GUILD, question(`1`), DEFAULT_CONFIG, ANY_FILTERS);
    await stub.submit(`mika`, `うらない`, true);

    expect((await stub.current())?.context.deadline).toBeNull();
    // The stored alarm has to be gone too. Checking only `deadline` would
    // pass while a real alarm stayed armed, and it would fire against the
    // next question.
    await expect(stub.pendingAlarm()).resolves.toBeNull();
  });
});

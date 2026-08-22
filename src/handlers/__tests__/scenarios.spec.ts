import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import schema from "../../../migrations/0001_scores.sql?raw";
import { DEFAULT_CONFIG } from "../quiz/machine.js";
import type { Question } from "../quiz/question.js";
import { d1Scores } from "../scores.js";
import type { QuizSession } from "../session.js";

/**
 * What a server full of people actually does to this bot.
 *
 * The other suites test one path at a time. These are the situations a real
 * channel produces: two rooms playing at once, somebody starting a session on
 * top of a running one, an answer arriving after the question closed. They run
 * against real Durable Objects and a real database because that is where these
 * particular mistakes would be invisible — a stub cannot get object identity
 * wrong.
 */

const workerEnv = env as unknown as {
  SESSION: DurableObjectNamespace<QuizSession>;
  SCORES: D1Database;
};

const session = (channel: string): DurableObjectStub<QuizSession> =>
  workerEnv.SESSION.get(workerEnv.SESSION.idFromName(channel));

const ANY_FILTERS = { levels: [], types: [], classes: [], forms: [] };

const question = (id: string, answer = `うらない`): Question => ({
  wordId: id,
  prompt: `売る → plain non-past negative`,
  form: `non-past-negative`,
  answer,
  stem: `うら`,
  dictionary: `売る`,
  reading: `うる`,
  gloss: `to sell`,
  type: `verb`,
  verbClass: `godan-r`
});

describe(`two channels at once`, () => {
  it(`keeps each channel's question and scores to itself`, async () => {
    // WHY: sessions are keyed by channel, and the club runs more than one
    // room. If identity leaked, an answer in #beginners would close the
    // question in #advanced — and the person who typed it would score for a
    // question they never saw.
    const a = session(`chan-a`);
    const b = session(`chan-b`);
    await a.begin(
      `chan-a`,
      `g1`,
      question(`a1`, `あるかない`),
      DEFAULT_CONFIG,
      ANY_FILTERS
    );
    await b.begin(
      `chan-b`,
      `g1`,
      question(`b1`, `たべない`),
      DEFAULT_CONFIG,
      ANY_FILTERS
    );

    await a.submit(`drake`, `あるかない`, true);

    const viewA = await a.current();
    const viewB = await b.current();
    expect(viewA?.context.scores.drake).toBeGreaterThan(0);
    // B is untouched: still asking, nobody scored.
    expect(viewB?.state).toBe(`asking`);
    expect(viewB?.context.scores).toEqual({});
  });

  it(`lets one player score in both channels independently`, async () => {
    // WHY: somebody watching two rooms is normal, not abuse. Their score in
    // one must not be reachable from the other while the sessions run.
    const a = session(`chan-c`);
    const b = session(`chan-d`);
    await a.begin(`chan-c`, `g1`, question(`c1`), DEFAULT_CONFIG, ANY_FILTERS);
    await b.begin(`chan-d`, `g1`, question(`d1`), DEFAULT_CONFIG, ANY_FILTERS);

    await a.submit(`mika`, `うらない`, true);

    expect((await a.current())?.context.scores.mika).toBeGreaterThan(0);
    expect((await b.current())?.context.scores.mika).toBeUndefined();
  });
});

describe(`starting on top of a running session`, () => {
  it(`replaces the session rather than corrupting it`, async () => {
    // WHY: the command layer guards against this, but the object must not be
    // left half-overwritten if the guard is ever bypassed — a second `begin`
    // is what `/quiz start` would do, and a session with question A's state
    // and question B's word would score nobody correctly.
    const s = session(`chan-e`);
    await s.begin(`chan-e`, `g1`, question(`e1`), DEFAULT_CONFIG, ANY_FILTERS);
    await s.submit(`drake`, `うらない`, true);
    await s.begin(
      `chan-e`,
      `g1`,
      question(`e2`, `たべない`),
      DEFAULT_CONFIG,
      ANY_FILTERS
    );

    const view = await s.current();
    // A clean slate: question one again, nobody's old score carried over.
    expect(view?.state).toBe(`asking`);
    expect(view?.context.scores).toEqual({});
    expect(view?.context.questionNumber).toBe(1);
  });
});

describe(`answers that should not score`, () => {
  it(`ignores an answer when no session exists`, async () => {
    // WHY: every message in every channel reaches the handler. A channel that
    // has never run a quiz must not produce a reaction or an error.
    const s = session(`chan-quiet`);
    const result = await s.submit(`drake`, `うらない`, true);
    expect(result.outcome.kind).toBe(`ignored`);
  });

  it(`ignores an answer after the session finished`, async () => {
    // WHY: the reveal invites more typing, and somebody always answers just
    // after the last question closes. Scoring it would change a leaderboard
    // that was already posted.
    const s = session(`chan-f`);
    await s.begin(
      `chan-f`,
      `g1`,
      question(`f1`),
      { ...DEFAULT_CONFIG, length: 1 },
      ANY_FILTERS
    );
    await s.submit(`drake`, `うらない`, true);

    const late = await s.submit(`mika`, `うらない`, true);
    expect(late.outcome.kind).toBe(`ignored`);
  });

  it(`ignores an answer typed during a pause`, async () => {
    // WHY: the intro countdown and the standings break are both `paused`. The
    // question is stored but nobody has been shown it, so scoring then hands a
    // point to whoever happened to be typing.
    const s = session(`chan-g`);
    await s.begin(`chan-g`, `g1`, question(`g1`), DEFAULT_CONFIG, ANY_FILTERS);
    await s.pause(10_000);

    const during = await s.submit(`drake`, `うらない`, true);
    expect(during.outcome.kind).toBe(`ignored`);
  });

  it(`ignores further guesses once a player is out of attempts`, async () => {
    // WHY: the cap is what stops brute force. Past it a player's messages are
    // ordinary chatter again — no reaction, no penalty, nothing consumed.
    const s = session(`chan-h`);
    await s.begin(
      `chan-h`,
      `g1`,
      question(`h1`),
      { ...DEFAULT_CONFIG, guesses: 2 },
      ANY_FILTERS
    );
    // Both allowed guesses must actually be taken. Asserting only that the
    // third is refused passes just as well when the cap is wrongly 1 — the
    // second is rejected, so the third is too, for the wrong reason. That is
    // the bug that shipped once already.
    const first = await s.submit(`drake`, `うった`, false);
    const second = await s.submit(`drake`, `うります`, false);
    expect(first.outcome.kind).toBe(`wrong`);
    expect(second.outcome.kind).toBe(`wrong`);

    const third = await s.submit(`drake`, `うらない`, true);
    expect(third.outcome.kind).toBe(`ignored`);
    // And somebody else can still win it.
    const other = await s.submit(`mika`, `うらない`, true);
    expect(other.outcome.kind).toBe(`correct`);
  });

  it(`gives the question to whoever answered first`, async () => {
    // WHY: two people racing is the normal case, not the edge one. The Gateway
    // gives an order and the first correct answer takes it; the second must be
    // ignored rather than overwriting the winner.
    const s = session(`chan-i`);
    await s.begin(`chan-i`, `g1`, question(`i1`), DEFAULT_CONFIG, ANY_FILTERS);

    const first = await s.submit(`drake`, `うらない`, true);
    const second = await s.submit(`mika`, `うらない`, true);

    expect(first.outcome.kind).toBe(`correct`);
    expect(second.outcome.kind).toBe(`ignored`);
    expect((await s.current())?.context.scores.mika).toBeUndefined();
  });
});

describe(`recovering from a bad state`, () => {
  it(`re-arms the alarm when a session is replaced`, async () => {
    // WHY: the alarm is the question timer, and there is one per object. A
    // session started over a running one must not inherit the old deadline —
    // a stale alarm closes the NEW question early, which reads in the channel
    // as the bot timing out a question nobody had time to answer.
    const s = session(`chan-j`);
    await s.begin(
      `chan-j`,
      `g1`,
      question(`j1`),
      { ...DEFAULT_CONFIG, timeoutMs: 600_000 },
      ANY_FILTERS
    );
    const firstAlarm = await s.pendingAlarm();

    await s.begin(
      `chan-j`,
      `g1`,
      question(`j2`),
      { ...DEFAULT_CONFIG, timeoutMs: 30_000 },
      ANY_FILTERS
    );
    const secondAlarm = await s.pendingAlarm();

    expect(firstAlarm).not.toBeNull();
    expect(secondAlarm).not.toBeNull();
    // The new, shorter deadline — not the old one left behind.
    expect(secondAlarm).toBeLessThan(firstAlarm ?? 0);
  });

  it(`clears the alarm when a session ends`, async () => {
    // WHY: an alarm outliving its session wakes the object for a question that
    // no longer exists, and every wake costs duration against the free tier.
    const s = session(`chan-k`);
    await s.begin(`chan-k`, `g1`, question(`k1`), DEFAULT_CONFIG, ANY_FILTERS);
    await s.end();

    await expect(s.pendingAlarm()).resolves.toBeNull();
  });

  it(`survives being cleared and started again`, async () => {
    // WHY: `/quiz end` then `/quiz start` is the normal way to change settings
    // mid-evening. Storage left behind would make the new session inherit the
    // old one's scores.
    const s = session(`chan-l`);
    await s.begin(`chan-l`, `g1`, question(`l1`), DEFAULT_CONFIG, ANY_FILTERS);
    await s.submit(`drake`, `うらない`, true);
    await s.clear();

    await expect(s.current()).resolves.toBeNull();

    await s.begin(`chan-l`, `g1`, question(`l2`), DEFAULT_CONFIG, ANY_FILTERS);
    expect((await s.current())?.context.scores).toEqual({});
  });
});

describe(`what /review can still see`, () => {
  it(`keeps a miss across the object going away and coming back`, async () => {
    // WHY: the session object hibernates between questions, and a miss that
    // lived in an instance field would come back empty on the next wake — so
    // `/review` would work while testing locally and report nothing in a real
    // channel, where hibernation actually happens.
    const s = session(`chan-m`);
    await s.begin(`chan-m`, `g1`, question(`m1`), DEFAULT_CONFIG, ANY_FILTERS);
    await s.submit(`drake`, `うった`, false);
    await s.submit(`mika`, `うらない`, true);
    await s.next(question(`m2`, `たべない`));

    // A fresh stub for the same id: whatever survives here came from storage.
    const reopened = session(`chan-m`);
    const view = await reopened.current();
    expect(view?.context.misses.drake?.answer).toBe(`うった`);
    expect(view?.context.misses.drake?.question.wordId).toBe(`m1`);
  });
});

describe(`the leaderboard under real use`, () => {
  it(`merges a player's scores from different channels in one guild`, async () => {
    // WHY: scores are per guild, not per channel. Someone who plays in two
    // rooms has one standing in the server, which is what makes it a club
    // leaderboard rather than a room leaderboard.
    for (const statement of schema
      .split(`;`)
      .map((line: string) => line.replace(/^\s*--.*$/gmu, ``).trim())
      .filter((line: string) => line !== ``)) {
      await workerEnv.SCORES.exec(statement.replace(/\s+/gu, ` `));
    }
    const scores = d1Scores(workerEnv.SCORES);
    await scores.record(`guild-x`, [
      { userId: `drake`, points: 4, correct: 1 }
    ]);
    await scores.record(`guild-x`, [
      { userId: `drake`, points: 3, correct: 1 }
    ]);

    await expect(scores.forUser(`guild-x`, `drake`)).resolves.toMatchObject({
      points: 7,
      sessions: 2
    });
  });
});

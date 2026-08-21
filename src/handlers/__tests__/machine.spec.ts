import { describe, expect, it } from "vitest";
import {
  begin,
  DEFAULT_CONFIG,
  leaderboard,
  persist,
  restore,
  type SessionConfig
} from "../quiz/machine.js";
import type { Question } from "../quiz/question.js";

/**
 * The session rules, as machine transitions.
 *
 * These replace the pure-function tests the machine superseded. The point of
 * the rewrite was to make illegal states unrepresentable rather than merely
 * untested, so several of these assert on the *state name* — which is what the
 * Durable Object now reads to decide whether an alarm should be armed.
 */

const question = (id: string): Question => ({
  wordId: id,
  prompt: `うりません`,
  form: `non-past-negative`,
  answer: `うらない`,
  dictionary: `売る`,
  reading: `うる`,
  gloss: `to sell`,
  type: `verb`,
  verbClass: `godan-r`
});

const NOW = 1_700_000_000_000;
const session = (config: Partial<SessionConfig> = {}) =>
  begin(`chan`, question(`1`), { ...DEFAULT_CONFIG, ...config }, NOW);

const right = (userId: string) =>
  ({
    type: `ANSWER`,
    userId,
    typed: `うらない`,
    correct: true,
    now: NOW
  }) as const;
const wrong = (userId: string) =>
  ({
    type: `ANSWER`,
    userId,
    typed: `うった`,
    correct: false,
    now: NOW
  }) as const;

describe(`one guess per player per question`, () => {
  it(`ignores a second guess from the same player`, () => {
    // WHY: the spec's rule. Without it a player could brute force the answer by
    // typing repeatedly, which would end the race for everyone else.
    const actor = session();
    actor.send(wrong(`drake`));
    actor.send(right(`drake`));

    expect(actor.getSnapshot().value).toBe(`asking`);
    expect(actor.getSnapshot().context.scores.drake).toBeUndefined();
  });

  it(`lets a different player still answer`, () => {
    // WHY: the guess limit is per player, not per question. If one wrong guess
    // closed the question for everyone, a single fast typist could spoil it.
    const actor = session();
    actor.send(wrong(`drake`));
    actor.send(right(`mika`));

    expect(actor.getSnapshot().context.scores).toEqual({ mika: 1 });
  });

  it(`does not penalise a wrong guess`, () => {
    // WHY: the bot is a teaching tool. A wrong guess costs the attempt and
    // nothing else, so nobody is discouraged from trying.
    const actor = session();
    actor.send(wrong(`drake`));

    expect(actor.getSnapshot().value).toBe(`asking`);
    expect(actor.getSnapshot().context.scores).toEqual({});
  });
});

describe(`the race`, () => {
  it(`leaves asking for revealing on the first correct answer`, () => {
    // WHY: first correct wins, and the state change is what clears the alarm.
    const actor = session();
    actor.send(right(`mika`));

    expect(actor.getSnapshot().value).toBe(`revealing`);
    expect(actor.getSnapshot().context.closedBy).toBe(`answer`);
  });

  it(`clears the deadline whenever the question closes`, () => {
    // WHY: this is the illegal state the machine exists to prevent. A closed
    // question that kept its deadline would leave an alarm armed, and it would
    // fire against the NEXT question and close it early.
    const answered = session();
    answered.send(right(`mika`));
    expect(answered.getSnapshot().value).not.toBe(`asking`);
    expect(answered.getSnapshot().context.deadline).toBeNull();

    const timedOut = session();
    timedOut.send({ type: `TIMEOUT` });
    expect(timedOut.getSnapshot().value).not.toBe(`asking`);
    expect(timedOut.getSnapshot().context.deadline).toBeNull();
  });

  it(`accumulates points across questions`, () => {
    const actor = session();
    actor.send(right(`mika`));
    actor.send({ type: `NEXT`, question: question(`2`), now: NOW });
    actor.send(right(`mika`));

    expect(actor.getSnapshot().context.scores).toEqual({ mika: 2 });
  });
});

describe(`timeouts`, () => {
  it(`closes the question and counts the timeout`, () => {
    const actor = session();
    actor.send({ type: `TIMEOUT` });

    expect(actor.getSnapshot().value).toBe(`revealing`);
    expect(actor.getSnapshot().context.timeoutStreak).toBe(1);
    expect(actor.getSnapshot().context.closedBy).toBe(`timeout`);
  });

  it(`resets the streak when someone answers`, () => {
    // WHY: "consecutive" is the whole point. A hard question that nobody gets
    // is not the same signal as the room having gone quiet, so an answered
    // question has to clear the count or an active session would end early.
    const actor = session({ length: null });
    actor.send({ type: `TIMEOUT` });
    actor.send({ type: `NEXT`, question: question(`2`), now: NOW });
    expect(actor.getSnapshot().context.timeoutStreak).toBe(1);

    actor.send(right(`mika`));
    expect(actor.getSnapshot().context.timeoutStreak).toBe(0);
  });

  it(`sets a deadline from the configured timeout`, () => {
    // WHY: the deadline is what the Durable Object's alarm is set from. A wrong
    // value would leave a question open forever or close it instantly.
    expect(session({ timeoutMs: 90_000 }).getSnapshot().context.deadline).toBe(
      NOW + 90_000
    );
  });
});

describe(`when a session ends`, () => {
  it(`ends a fixed session after its last question`, () => {
    const actor = session({ length: 2 });
    actor.send(right(`mika`));
    actor.send({ type: `NEXT`, question: question(`2`), now: NOW });
    expect(actor.getSnapshot().value).toBe(`asking`);

    actor.send(right(`mika`));
    // Question 2 of 2 closed, so `revealing` falls straight through to final.
    expect(actor.getSnapshot().value).toBe(`finished`);
  });

  it(`ends an endless session after consecutive timeouts`, () => {
    // WHY: an endless session needs some way to stop, and a quiet room is the
    // signal. Without this the alarm would keep firing on an empty channel.
    const actor = session({ length: null, quitAfterTimeouts: 3 });
    actor.send({ type: `TIMEOUT` });
    actor.send({ type: `NEXT`, question: question(`2`), now: NOW });
    actor.send({ type: `TIMEOUT` });
    actor.send({ type: `NEXT`, question: question(`3`), now: NOW });
    expect(actor.getSnapshot().value).toBe(`asking`);

    actor.send({ type: `TIMEOUT` });
    expect(actor.getSnapshot().value).toBe(`finished`);
  });

  it(`never ends an endless session on question count`, () => {
    // WHY: `length: null` means endless. If the count check applied, an endless
    // session would stop at whatever the default length happened to be.
    const actor = session({ length: null });
    for (let n = 0; n < 40; n += 1) {
      actor.send(right(`mika`));
      actor.send({ type: `NEXT`, question: question(String(n)), now: NOW });
    }
    expect(actor.getSnapshot().value).toBe(`asking`);
    expect(actor.getSnapshot().context.questionNumber).toBe(41);
  });

  it(`clears the deadline when the session finishes`, () => {
    // WHY: a finished session must not leave an alarm armed on a channel that
    // is no longer playing.
    const actor = session();
    actor.send({ type: `END` });
    expect(actor.getSnapshot().value).toBe(`finished`);
    expect(actor.getSnapshot().context.deadline).toBeNull();
    expect(actor.getSnapshot().context.question).toBeNull();
  });
});

describe(`persistence`, () => {
  it(`survives a round trip through storage`, () => {
    // WHY: the Durable Object hibernates between questions, which discards the
    // machine. If the snapshot did not restore faithfully, scores and the
    // current question would reset mid-game.
    const actor = session({ length: null });
    actor.send(right(`mika`));
    actor.send({ type: `NEXT`, question: question(`7`), now: NOW });

    const wire: unknown = JSON.parse(JSON.stringify(persist(actor)));
    const revived = restore(wire as ReturnType<typeof persist>);

    expect(revived.getSnapshot().value).toBe(`asking`);
    expect(revived.getSnapshot().context.scores).toEqual({ mika: 1 });
    expect(revived.getSnapshot().context.question?.wordId).toBe(`7`);
    expect(revived.getSnapshot().context.questionNumber).toBe(2);
  });

  it(`keeps accepting events after being restored`, () => {
    // WHY: a restored machine that could not transition would freeze the
    // session on the first question after a hibernation.
    const actor = session();
    const wire: unknown = JSON.parse(JSON.stringify(persist(actor)));
    const revived = restore(wire as ReturnType<typeof persist>);
    revived.send(right(`mika`));

    expect(revived.getSnapshot().value).toBe(`revealing`);
    expect(revived.getSnapshot().context.scores).toEqual({ mika: 1 });
  });
});

describe(`leaderboard`, () => {
  it(`ranks players by points, highest first`, () => {
    const actor = session({ length: null });
    actor.send(right(`mika`));
    actor.send({ type: `NEXT`, question: question(`2`), now: NOW });
    actor.send(right(`drake`));
    actor.send({ type: `NEXT`, question: question(`3`), now: NOW });
    actor.send(right(`mika`));

    expect(leaderboard(actor.getSnapshot().context)).toEqual([
      { userId: `mika`, points: 2 },
      { userId: `drake`, points: 1 }
    ]);
  });

  it(`is empty when nobody has scored`, () => {
    expect(leaderboard(session().getSnapshot().context)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import type { Question } from "../quiz/question.js";
import {
  advance,
  answer,
  DEFAULT_CONFIG,
  finish,
  isOver,
  leaderboard,
  start,
  timeout,
  type SessionConfig
} from "../quiz/session.js";

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
  start(`chan`, question(`1`), { ...DEFAULT_CONFIG, ...config }, NOW);

describe(`one guess per player per question`, () => {
  it(`ignores a second guess from the same player`, () => {
    // WHY: the spec's rule. Without it a player could brute force the answer by
    // typing repeatedly, which would end the race for everyone else.
    const first = answer(session(), `drake`, `うった`, false);
    const second = answer(first.state, `drake`, `うらない`, true);
    expect(second.outcome).toEqual({
      kind: `ignored`,
      reason: `already-answered`
    });
    expect(second.state.scores.drake).toBeUndefined();
  });

  it(`lets a different player still answer`, () => {
    // WHY: the guess limit is per player, not per question. If one wrong guess
    // closed the question for everyone, a single fast typist could spoil it.
    const first = answer(session(), `drake`, `うった`, false);
    const second = answer(first.state, `mika`, `うらない`, true);
    expect(second.outcome).toEqual({
      kind: `correct`,
      userId: `mika`,
      points: 1
    });
  });

  it(`does not penalise a wrong guess`, () => {
    // WHY: the bot is a teaching tool. A wrong guess costs the attempt and
    // nothing else, so nobody is discouraged from trying.
    const after = answer(session(), `drake`, `うった`, false);
    expect(after.outcome).toEqual({ kind: `wrong` });
    expect(after.state.scores).toEqual({});
    expect(after.state.question).not.toBeNull();
  });
});

describe(`the race`, () => {
  it(`closes the question on the first correct answer`, () => {
    // WHY: first correct wins. Leaving the question open would let a second
    // player score for an answer already given.
    const after = answer(session(), `mika`, `うらない`, true);
    expect(after.state.question).toBeNull();
    expect(after.state.deadline).toBeNull();
  });

  it(`ignores answers that arrive after the question closed`, () => {
    // WHY: two near-simultaneous answers are settled by arrival order, which
    // the Gateway already sequences. The loser is ignored rather than scored.
    const won = answer(session(), `mika`, `うらない`, true);
    const late = answer(won.state, `drake`, `うらない`, true);
    expect(late.outcome).toEqual({ kind: `ignored`, reason: `finished` });
    expect(late.state.scores).toEqual({ mika: 1 });
  });

  it(`accumulates points across questions`, () => {
    let state = answer(session(), `mika`, `うらない`, true).state;
    state = advance(state, question(`2`), NOW);
    state = answer(state, `mika`, `うらない`, true).state;
    expect(state.scores).toEqual({ mika: 2 });
  });
});

describe(`timeouts`, () => {
  it(`closes the question and counts the timeout`, () => {
    const after = timeout(session());
    expect(after.outcome).toEqual({ kind: `timeout` });
    expect(after.state.question).toBeNull();
    expect(after.state.timeoutStreak).toBe(1);
  });

  it(`resets the streak when someone answers`, () => {
    // WHY: "consecutive" is the whole point. A hard question that nobody gets
    // is not the same signal as the room having gone quiet, so an answered
    // question has to clear the count or an active session would end early.
    let state = timeout(session({ length: null })).state;
    state = advance(state, question(`2`), NOW);
    expect(state.timeoutStreak).toBe(1);
    state = answer(state, `mika`, `うらない`, true).state;
    expect(state.timeoutStreak).toBe(0);
  });

  it(`sets a deadline from the configured timeout`, () => {
    // WHY: the deadline is what the Durable Object's alarm is set from. A wrong
    // value would leave a question open forever or close it instantly.
    expect(session({ timeoutMs: 90_000 }).deadline).toBe(NOW + 90_000);
  });
});

describe(`when a session ends`, () => {
  it(`ends a fixed session after its last question`, () => {
    let state = session({ length: 3 });
    for (let n = 2; n <= 3; n += 1) {
      state = answer(state, `mika`, `うらない`, true).state;
      state = advance(state, question(String(n)), NOW);
    }
    expect(state.questionNumber).toBe(3);
    expect(isOver(state)).toBe(true);

    state = answer(state, `mika`, `うらない`, true).state;
    state = advance(state, question(`4`), NOW);
    expect(state.finished).toBe(true);
    expect(state.questionNumber).toBe(3);
  });

  it(`ends an endless session after consecutive timeouts`, () => {
    // WHY: an endless session needs some way to stop, and a quiet room is the
    // signal. Without this the alarm would keep firing on an empty channel.
    let state = session({ length: null, quitAfterTimeouts: 3 });
    for (let n = 0; n < 2; n += 1) {
      state = timeout(state).state;
      state = advance(state, question(`x`), NOW);
      expect(state.finished).toBe(false);
    }
    state = timeout(state).state;
    expect(isOver(state)).toBe(true);
    state = advance(state, question(`x`), NOW);
    expect(state.finished).toBe(true);
  });

  it(`never ends an endless session on question count`, () => {
    // WHY: `length: null` means endless. If the count check applied, an endless
    // session would stop at whatever the default length happened to be.
    let state = session({ length: null });
    for (let n = 0; n < 40; n += 1) {
      state = answer(state, `mika`, `うらない`, true).state;
      state = advance(state, question(String(n)), NOW);
    }
    expect(state.finished).toBe(false);
    expect(state.questionNumber).toBe(41);
  });

  it(`stops accepting answers once finished`, () => {
    // WHY: `/quiz end` closes the session. A message arriving just afterwards
    // must not score, or the final leaderboard would change after it was shown.
    const ended = finish(session());
    const late = answer(ended, `mika`, `うらない`, true);
    expect(late.outcome).toEqual({ kind: `ignored`, reason: `finished` });
    expect(late.state.scores).toEqual({});
  });
});

describe(`leaderboard`, () => {
  it(`ranks players by points, highest first`, () => {
    let state = session({ length: null });
    state = answer(state, `mika`, `うらない`, true).state;
    state = advance(state, question(`2`), NOW);
    state = answer(state, `drake`, `うらない`, true).state;
    state = advance(state, question(`3`), NOW);
    state = answer(state, `mika`, `うらない`, true).state;

    expect(leaderboard(state)).toEqual([
      { userId: `mika`, points: 2 },
      { userId: `drake`, points: 1 }
    ]);
  });

  it(`is empty when nobody has scored`, () => {
    expect(leaderboard(session())).toEqual([]);
  });
});

import { describe, expect, it } from "vite-plus/test";
import type { ExamQuestion } from "../draw.js";
import { WEIGHT, type Difficulty } from "../items.js";
import {
  answersOf,
  begin,
  castVote,
  closeQuestion,
  persist,
  restore,
  resultsOf,
  viewOf,
  type ExamActor
} from "../machine.js";

/**
 * The poll rules.
 *
 * Everything that decides a score is here, so these tests carry the promises a
 * student relies on: everyone who is right scores, only your last vote
 * counts, speed is worth nothing, and a press on an old question never counts.
 */

const question = (
  number: number,
  difficulty: Difficulty = 1,
  correct = 0
): ExamQuestion => ({
  itemId: `n5-b1-${String(number).padStart(4, `0`)}`,
  slot: 1,
  mondai: 1,
  number,
  prompt: `ぶん（1）です。`,
  answered: `ぶん__あ__です。`,
  options: [`あ`, `い`, `う`, `え`],
  correct,
  difficulty,
  points: [`point`],
  en: `Sentence.`,
  note: `n`,
  token: `tok${String(number)}`,
  timeoutMs: 30_000
});

/** A test with its first question open. */
const started = (questions: ExamQuestion[]): ExamActor => {
  const actor = begin({
    testId: `t1`,
    channelId: `chan`,
    guildId: `guild`,
    test: `bunpou`,
    questions,
    introUntil: 1_000,
    introId: null
  });
  actor.send({ type: `RESUME`, now: 1_000 });
  return actor;
};

const vote = (
  actor: ExamActor,
  userId: string,
  option: number,
  token = `tok1`
) => castVote(actor, { userId, token, option });

describe(`a vote`, () => {
  it(`does not close the question`, () => {
    // WHY: this is the poll. In the race quiz the first right answer ends
    // the question for everyone; here everyone answers at once.
    const actor = started([question(1), question(2)]);
    vote(actor, `ann`, 0);
    expect(viewOf(actor).state).toBe(`asking`);
  });

  it(`replaces the voter's earlier vote, and says so`, () => {
    // WHY: changing your mind is allowed and free. The reply has to say
    // "changed", or the player cannot tell the second press landed.
    const actor = started([question(1)]);
    expect(vote(actor, `ann`, 1).outcome).toBe(`recorded`);
    expect(vote(actor, `ann`, 0).outcome).toBe(`changed`);
    expect(viewOf(actor).context.votes).toEqual({ ann: 0 });
  });

  it(`from an old question's button is stale and changes nothing`, () => {
    // WHY: old buttons stay on screen. Without the token, pressing question
    // 1's button during question 2 would vote in question 2.
    const actor = started([question(1)]);
    expect(vote(actor, `ann`, 0, `old`).outcome).toBe(`stale`);
    expect(viewOf(actor).context.votes).toEqual({});
  });

  it(`outside the four options is rejected`, () => {
    // WHY: the session never trusts its caller. A forged id with option 7
    // must not become a vote.
    const actor = started([question(1)]);
    expect(vote(actor, `ann`, 7).outcome).toBe(`stale`);
  });

  it(`while no question is open does nothing`, () => {
    // WHY: during the intro and between questions there is nothing to vote on.
    const actor = begin({
      testId: `t1`,
      channelId: `chan`,
      guildId: null,
      test: `bunpou`,
      questions: [question(1)],
      introUntil: 1_000,
      introId: null
    });
    expect(vote(actor, `ann`, 0).outcome).toBe(`not-open`);
  });
});

describe(`scoring`, () => {
  it(`scores everyone who is right, not only the first`, () => {
    // WHY: the rule that separates a poll from a race, and the one a careless
    // refactor would break.
    const actor = started([question(1, 1, 2)]);
    vote(actor, `ann`, 2);
    vote(actor, `ben`, 2);
    vote(actor, `cat`, 0);
    closeQuestion(actor);
    const results = resultsOf(viewOf(actor).context);
    expect(results.find((r) => r.userId === `ann`)?.points).toBe(WEIGHT[1]);
    expect(results.find((r) => r.userId === `ben`)?.points).toBe(WEIGHT[1]);
    expect(results.find((r) => r.userId === `cat`)?.points).toBe(0);
  });

  it(`counts only the final vote`, () => {
    // WHY: a player who was right and then changed to wrong scores nothing,
    // and the other way round scores in full.
    const actor = started([question(1, 1, 0)]);
    vote(actor, `ann`, 0);
    vote(actor, `ann`, 3);
    vote(actor, `ben`, 3);
    vote(actor, `ben`, 0);
    closeQuestion(actor);
    const results = resultsOf(viewOf(actor).context);
    expect(results.find((r) => r.userId === `ann`)?.points).toBe(0);
    expect(results.find((r) => r.userId === `ben`)?.points).toBe(WEIGHT[1]);
  });

  it(`weights a correct answer by difficulty, and nothing else`, () => {
    // WHY: accuracy, not speed. A vote has no timestamp at all, so there is
    // no way for the last second to be worth less than the first.
    const actor = started([question(1, 3, 0), question(2, 1, 0)]);
    vote(actor, `ann`, 0);
    closeQuestion(actor);
    actor.send({ type: `NEXT`, now: 999_999 });
    vote(actor, `ann`, 0, `tok2`);
    closeQuestion(actor);
    const [ann] = resultsOf(viewOf(actor).context);
    expect(ann?.points).toBe(WEIGHT[3] + WEIGHT[1]);
    expect(ann?.max).toBe(WEIGHT[3] + WEIGHT[1]);
  });

  it(`counts only the questions that closed when a test ends early`, () => {
    // WHY: ending mid-question must not count votes the timer never settled,
    // and the maximum must not include questions nobody saw.
    const actor = started([question(1), question(2), question(3)]);
    vote(actor, `ann`, 0);
    closeQuestion(actor);
    actor.send({ type: `NEXT`, now: 2_000 });
    vote(actor, `ann`, 0, `tok2`);
    actor.send({ type: `END` });
    const [ann] = resultsOf(viewOf(actor).context);
    expect(ann).toMatchObject({ points: WEIGHT[1], max: WEIGHT[1], asked: 1 });
  });

  it(`lists an unanswered question as no answer, not as option 1`, () => {
    // WHY: option index 0 is a real answer. A missing vote read as 0 would
    // tell a student they chose 1.
    const actor = started([question(1, 1, 2), question(2, 1, 2)]);
    vote(actor, `ann`, 2);
    closeQuestion(actor);
    actor.send({ type: `NEXT`, now: 2_000 });
    closeQuestion(actor);
    expect(answersOf(viewOf(actor).context, `ann`)).toEqual([
      { number: 1, chose: 2, correct: true, points: WEIGHT[1] },
      { number: 2, chose: null, correct: false, points: 0 }
    ]);
  });
});

describe(`the session's shape`, () => {
  it(`finishes after the last question closes`, () => {
    // WHY: the flow posts the results when it sees `finished`. A test that
    // stayed in `revealing` would never show anyone their score.
    const actor = started([question(1)]);
    closeQuestion(actor);
    expect(viewOf(actor).state).toBe(`finished`);
  });

  it(`holds a deadline only while a question is open or a wait is running`, () => {
    // WHY: the Durable Object arms its alarm from this. A deadline left on a
    // closed question is the stale alarm that closes the NEXT one early.
    const actor = started([question(1), question(2)]);
    expect(viewOf(actor).context.deadline).toBe(31_000);
    closeQuestion(actor);
    expect(viewOf(actor).context.deadline).toBeNull();
    actor.send({ type: `PAUSE`, until: 50_000 });
    expect(viewOf(actor).context.deadline).toBe(50_000);
  });

  it(`opens the intro's question without skipping it`, () => {
    // WHY: question one is stored before anyone sees it. Advancing past it
    // would start every test at question two.
    const actor = started([question(1), question(2)]);
    expect(viewOf(actor).context.index).toBe(0);
    expect(viewOf(actor).context.posted).toBe(true);
  });

  it(`survives a round trip through storage`, () => {
    // WHY: the Durable Object hibernates between questions. A snapshot that
    // did not restore would reset everyone's score mid-test.
    const actor = started([question(1, 2, 1), question(2)]);
    vote(actor, `ann`, 1);
    const restored = restore(
      JSON.parse(JSON.stringify(persist(actor))) as ReturnType<typeof persist>
    );
    closeQuestion(restored);
    expect(resultsOf(viewOf(restored).context)[0]?.points).toBe(WEIGHT[2]);
  });
});

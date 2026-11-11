import type { Interaction } from "@discordkit/client/interactions/types/Interaction";
import { describe, expect, it } from "vite-plus/test";
import {
  endTest,
  handleResume,
  handleTimeout,
  handleVote,
  myResults,
  startTest,
  type ExamDeps,
  type ExamPort
} from "../flow.js";
import type { FormItem } from "../items.js";
import {
  begin,
  castVote,
  closeQuestion,
  viewOf,
  type ExamActor,
  type ExamEvent
} from "../machine.js";

/**
 * A whole mock test, against stubs.
 *
 * The session here is in memory, but its rules are not copied: votes and
 * closing go through `castVote` and `closeQuestion`, the same functions the
 * Durable Object calls. A stub that re-implemented them would be a second copy
 * free to drift — inbou has been bitten by that twice.
 */

const memorySession = (): ExamPort => {
  let actor: ExamActor | null = null;
  const send = (event: ExamEvent) => {
    if (actor === null) return null;
    actor.send(event);
    return viewOf(actor);
  };
  return {
    begin: async (input) => {
      actor = begin(input);
      return viewOf(actor);
    },
    current: async () => (actor === null ? null : viewOf(actor)),
    vote: async (userId, token, option) =>
      actor === null
        ? { outcome: `not-open` }
        : castVote(actor, { userId, token, option }),
    close: async () => (actor === null ? null : closeQuestion(actor)),
    resume: async () => send({ type: `RESUME`, now: 0 }),
    next: async () => send({ type: `NEXT`, now: 0 }),
    pause: async (ms) => {
      send({ type: `PAUSE`, until: ms });
    },
    posted: async (messageId) => {
      send({ type: `POSTED`, messageId });
    },
    end: async () => send({ type: `END` })
  };
};

type Call =
  | { kind: `reply`; content: string }
  | { kind: `post`; id: string; body: string }
  | { kind: `edit`; id: string; body: string };

const item = (n: number): FormItem => ({
  id: `n5-b1-${String(n).padStart(4, `0`)}`,
  type: `form`,
  status: `reviewed`,
  sentence: `ぶん${String(n)}（1）です。`,
  en: `Sentence ${String(n)}.`,
  slots: [
    {
      answer: `あ`,
      wrong: [`い`, `う`, `え`],
      difficulty: 1,
      points: [`point-${String(n)}`],
      note: `Note ${String(n)}.`
    }
  ]
});

const interaction = {} as unknown as Interaction;

/** What a post or edit sent. A private reply has no message body. */
const bodyOf = (call: Call | undefined): string =>
  call === undefined || call.kind === `reply` ? `` : call.body;

/** A seeded generator, so every run draws the same test. */
const seeded = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
};

const setup = (options: { quizRunning?: boolean; items?: FormItem[] } = {}) => {
  const calls: Call[] = [];
  let posted = 0;
  const deps: ExamDeps = {
    discord: {
      reply: async (_interaction, body) => {
        calls.push({ kind: `reply`, content: body.content ?? `` });
      }
    },
    cards: {
      post: async (_channel, components) => {
        posted += 1;
        const id = `m${String(posted)}`;
        calls.push({ kind: `post`, id, body: JSON.stringify(components) });
        return id;
      },
      edit: async (_channel, id, components) => {
        calls.push({ kind: `edit`, id, body: JSON.stringify(components) });
      }
    },
    session: memorySession(),
    items: options.items ?? [item(1), item(2), item(3)],
    // Seeded, not a constant: a constant would give every question the same
    // token, and the stale-press check would have nothing to tell apart.
    random: seeded(42),
    now: () => 1_000_000,
    quizRunning: async () => options.quizRunning ?? false
  };
  return { deps, calls };
};

/** Start a test and open question one. */
const started = async (options?: Parameters<typeof setup>[0]) => {
  const run = setup(options);
  await startTest(run.deps, interaction, `chan`, `guild`, `bunpou`);
  await handleResume(run.deps, `chan`);
  return run;
};

const tokenOfOpen = async (deps: ExamDeps): Promise<string> => {
  const view = await deps.session.current();
  return view?.context.questions.at(view.context.index)?.token ?? ``;
};

/** The option that is correct on the open question. */
const correctOfOpen = async (deps: ExamDeps): Promise<number> => {
  const view = await deps.session.current();
  return view?.context.questions.at(view.context.index)?.correct ?? -1;
};

describe(`starting a test`, () => {
  it(`refuses while the conjugation quiz is running here`, async () => {
    // WHY: typed answers and button votes in one channel would confuse
    // everyone, and the quiz would grade chat about the test.
    const { deps, calls } = setup({ quizRunning: true });
    await startTest(deps, interaction, `chan`, `guild`, `bunpou`);
    await expect(deps.session.current()).resolves.toBeNull();
    expect(calls).toEqual([
      {
        kind: `reply`,
        content: expect.stringContaining(`conjugation quiz`) as string
      }
    ]);
  });

  it(`refuses while another test is running here`, async () => {
    // WHY: starting over a running test would wipe everyone's votes.
    const { deps } = await started();
    const token = await tokenOfOpen(deps);
    await startTest(deps, interaction, `chan`, `guild`, `bunpou`);
    await expect(tokenOfOpen(deps)).resolves.toBe(token);
  });

  it(`answers privately first, then posts the intro, and holds question one`, async () => {
    // WHY: Discord drops an interaction not answered within three seconds,
    // and question one must wait for the intro to be read.
    const { deps, calls } = setup();
    await startTest(deps, interaction, `chan`, `guild`, `bunpou`);
    expect(calls.map((call) => call.kind)).toEqual([`reply`, `post`]);
    expect((await deps.session.current())?.state).toBe(`paused`);
  });
});

describe(`running a test`, () => {
  it(`opens question one after the intro, not question two`, async () => {
    // WHY: the intro holds question one unseen. Advancing past it would
    // quietly start every test at question two.
    const { deps, calls } = await started();
    expect(bodyOf(calls.at(-1))).toContain(`1 / 3`);
    expect((await deps.session.current())?.context.messageId).toBe(`m2`);
  });

  it(`settles the question before posting its reveal`, async () => {
    // WHY: a live-looking question above its own answer reads as still open.
    const { deps, calls } = await started();
    // The draw shuffles, so read which item question one turned out to be.
    const note = (await deps.session.current())?.context.questions.at(0)?.note;
    const before = calls.length;
    await handleTimeout(deps, `chan`);
    const after = calls.slice(before);
    expect(after.map((call) => call.kind)).toEqual([`edit`, `post`]);
    expect(after[0]).toMatchObject({ kind: `edit`, id: `m2` });
    expect(bodyOf(after[1])).toContain(note);
  });

  it(`posts the results after the last question, and does not pause`, async () => {
    // WHY: a test that ended without results would leave every player
    // wondering what they scored.
    const { deps, calls } = await started();
    for (let i = 0; i < 3; i += 1) {
      await handleTimeout(deps, `chan`);
      await handleResume(deps, `chan`);
    }
    expect((await deps.session.current())?.state).toBe(`finished`);
    expect(bodyOf(calls.at(-1))).toContain(`results`);
  });

  it(`acknowledges a vote privately, and a change as a change`, async () => {
    // WHY: votes are private until the reveal; the reply is the only sign a
    // press landed, and "changed" is the only sign the second one did.
    const { deps, calls } = await started();
    const token = await tokenOfOpen(deps);
    await handleVote(deps, interaction, `chan`, {
      userId: `ann`,
      token,
      option: 1
    });
    await handleVote(deps, interaction, `chan`, {
      userId: `ann`,
      token,
      option: 2
    });
    const replies = calls.filter((call) => call.kind === `reply`).slice(-2);
    expect(
      replies.map((call) => (call.kind === `reply` ? call.content : ``))
    ).toEqual([
      expect.stringContaining(`You chose **2**`) as string,
      `Changed to **3**.`
    ]);
  });

  it(`tells a press on a closed question that it closed`, async () => {
    const { deps, calls } = await started();
    const token = await tokenOfOpen(deps);
    await handleTimeout(deps, `chan`);
    await handleResume(deps, `chan`);
    await handleVote(deps, interaction, `chan`, {
      userId: `ann`,
      token,
      option: 0
    });
    expect(calls.at(-1)).toEqual({
      kind: `reply`,
      content: `That question has already closed.`
    });
  });

  it(`updates the answer count at 1, 2 and 4 voters, not at 3`, async () => {
    // WHY: Discord allows about five edits per five seconds per channel. An
    // edit per press would be rate-limited on a busy question.
    const { deps, calls } = await started();
    const token = await tokenOfOpen(deps);
    const counts: string[] = [];
    for (const userId of [`a`, `b`, `c`, `d`]) {
      const before = calls.length;
      await handleVote(deps, interaction, `chan`, { userId, token, option: 0 });
      const edit = calls.slice(before).find((call) => call.kind === `edit`);
      counts.push(
        edit === undefined
          ? `-`
          : (/(\d) answered/u.exec(edit.body)?.[1] ?? `?`)
      );
    }
    expect(counts).toEqual([`1`, `2`, `-`, `4`]);
  });
});

describe(`ending and results`, () => {
  it(`ends early: settles the open question and posts the results`, async () => {
    // WHY: End test is the one way out. Leaving the open question live
    // would let people vote on a test that is over.
    const { deps, calls } = await started();
    const before = calls.length;
    await endTest(deps, interaction, `chan`);
    const after = calls.slice(before);
    expect(after.map((call) => call.kind)).toEqual([`reply`, `edit`, `post`]);
    expect(bodyOf(after[2])).toContain(`results`);
  });

  it(`scores two players on what they finally chose`, async () => {
    // WHY: the whole loop, end to end: votes, a change of mind, closing,
    // and the results card that reads them back.
    const { deps, calls } = await started({ items: [item(1)] });
    const token = await tokenOfOpen(deps);
    const right = await correctOfOpen(deps);
    const wrong = (right + 1) % 4;
    await handleVote(deps, interaction, `chan`, {
      userId: `ann`,
      token,
      option: wrong
    });
    await handleVote(deps, interaction, `chan`, {
      userId: `ann`,
      token,
      option: right
    });
    await handleVote(deps, interaction, `chan`, {
      userId: `ben`,
      token,
      option: wrong
    });
    await handleTimeout(deps, `chan`);
    const results = bodyOf(calls.at(-1));
    expect(results).toMatch(/<@ann> \*\*2\*\* \/ 2/u);
    expect(results).toMatch(/<@ben> \*\*0\*\* \/ 2/u);
  });

  it(`will not show one test's results from an older test's button`, async () => {
    // WHY: the session is replaced by the next test. An old button must not
    // show a student someone else's sitting.
    const { deps, calls } = await started();
    await endTest(deps, interaction, `chan`);
    await myResults(deps, interaction, `not-this-test`, `ann`);
    expect(calls.at(-1)).toEqual({
      kind: `reply`,
      content: `Those results belong to an earlier test.`
    });
  });
});

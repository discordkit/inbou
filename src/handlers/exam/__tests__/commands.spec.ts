import type { Interaction } from "@discordkit/client/interactions/types/Interaction";
import { describe, expect, it } from "vite-plus/test";
import { handleExamInteraction } from "../commands.js";
import type { ExamDeps, ExamPort } from "../flow.js";

/**
 * The mock tests' router, which sits in front of the quiz's.
 *
 * Its one dangerous mistake is claiming an interaction that is not its own:
 * the quiz's router would never see it, and the command would do nothing.
 */

/** Records which session methods were reached; none of them do anything. */
const recordingDeps = () => {
  const reached: string[] = [];
  const session = new Proxy({} as ExamPort, {
    get: (_target, method: string) => async () => {
      reached.push(method);
      return null;
    }
  });
  const deps: ExamDeps = {
    discord: { reply: async () => {} },
    cards: { post: async () => `m1`, edit: async () => {} },
    session,
    items: [],
    random: Math.random,
    now: Date.now,
    quizRunning: async () => false
  };
  return { deps, reached };
};

const command = (name: string, subcommand: string): Interaction =>
  ({
    type: 2,
    channelId: `chan`,
    guildId: `guild`,
    member: { user: { id: `ann` } },
    data: { name, options: [{ type: 1, name: subcommand }] }
  }) as unknown as Interaction;

const button = (customId: string): Interaction =>
  ({
    type: 3,
    channelId: `chan`,
    guildId: `guild`,
    member: { user: { id: `ann` } },
    data: { customId }
  }) as unknown as Interaction;

describe(`the exam router`, () => {
  it(`ends the test from /bunpou end`, async () => {
    // WHY: the escape hatch when the End test button never reached the
    // channel. The first live test needed exactly this and did not have it.
    const { deps, reached } = recordingDeps();
    await expect(
      handleExamInteraction(deps, command(`bunpou`, `end`))
    ).resolves.toBe(true);
    expect(reached).toContain(`current`);
  });

  it(`leaves the quiz's commands and buttons to the quiz`, async () => {
    // WHY: this router runs first. Claiming /quiz or a quiz button would
    // swallow it, and the quiz would silently stop answering.
    const { deps, reached } = recordingDeps();
    await expect(
      handleExamInteraction(deps, command(`quiz`, `start`))
    ).resolves.toBe(false);
    await expect(
      handleExamInteraction(deps, button(`quiz:hint`))
    ).resolves.toBe(false);
    expect(reached).toEqual([]);
  });

  it(`claims its own buttons`, async () => {
    const { deps } = recordingDeps();
    await expect(handleExamInteraction(deps, button(`exam:end`))).resolves.toBe(
      true
    );
  });
});

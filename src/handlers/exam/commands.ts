import { InteractionType } from "@discordkit/client";
import type { Interaction } from "@discordkit/client/interactions/types/Interaction";
import { diagnostics } from "../diagnostics.js";
import { readCustomId, readInvoker, readOptions } from "../quiz/options.js";
import {
  endTest,
  handleVote,
  myResults,
  startTest,
  type ExamDeps
} from "./flow.js";
import type { TestId } from "./blueprint.js";
import { BUTTON, parseResults, parseVote } from "./render.js";

/** Each test's slash command. `start` and `end` work the same for every test. */
export const TESTS: Readonly<Partial<Record<string, TestId>>> = {
  bunpou: `bunpou`,
  dokkai: `dokkai`
};

/**
 * Route the interactions that belong to mock tests.
 *
 * Separate from the quiz's router so the two engines stay apart. Returns
 * whether it handled the interaction; anything it does not recognise goes on
 * to the quiz's router.
 */
export const handleExamInteraction = async (
  deps: ExamDeps,
  interaction: Interaction
): Promise<boolean> => {
  const channelId = interaction.channelId ?? null;

  if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
    const customId = readCustomId(interaction.data);
    if (customId?.startsWith(`exam:`) !== true) return false;
    const userId = readInvoker(interaction);
    if (channelId === null || userId === null) return true;

    if (customId === BUTTON.end) {
      await endTest(deps, interaction, channelId);
      return true;
    }
    const vote = parseVote(customId);
    if (vote !== null) {
      await handleVote(deps, interaction, channelId, {
        userId,
        token: vote.token,
        option: vote.index
      });
      return true;
    }
    const testId = parseResults(customId);
    if (testId !== null) {
      await myResults(deps, interaction, testId, userId);
      return true;
    }
    diagnostics.UNKNOWN_INTERACTION({ name: customId });
    return true;
  }

  if (interaction.type !== InteractionType.APPLICATION_COMMAND) return false;
  const name = interaction.data?.name;
  const test = name === undefined ? undefined : TESTS[name];

  if (test !== undefined) {
    if (channelId === null) {
      await deps.discord.reply(interaction, {
        content: `That command only works in a channel.`,
        ephemeral: true
      });
      return true;
    }
    const { subcommand } = readOptions(interaction.data?.options);
    if (subcommand === `start`) {
      await startTest(
        deps,
        interaction,
        channelId,
        interaction.guildId ?? null,
        test
      );
      return true;
    }
    // The End test button's twin. Needed when the card holding the button
    // never reached the channel, or has scrolled out of reach.
    if (subcommand === `end`) {
      await endTest(deps, interaction, channelId);
      return true;
    }
    diagnostics.UNKNOWN_INTERACTION({ name: `${name} ${subcommand ?? ``}` });
    await deps.discord.reply(interaction, {
      content: `I do not have a handler for that yet.`,
      ephemeral: true
    });
    return true;
  }

  return false;
};

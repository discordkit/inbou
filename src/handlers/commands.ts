import { InteractionType } from "@discordkit/client";
import type { Interaction } from "@discordkit/client/interactions/types/Interaction";
import { diagnostics } from "./diagnostics.js";
import type { DiscordEffects } from "./discord.js";
import { isSettings, parseSettings } from "./quiz/config.js";
import { startSession, type FlowDeps } from "./quiz/flow.js";
import { readOptions } from "./quiz/options.js";
import { BUTTON, hintEmbed, scoresEmbed } from "./quiz/render.js";

/**
 * Slash commands.
 *
 * Every reply here goes through {@link DiscordEffects}, so the routing is
 * testable without a token. The commands split cleanly by who should see the
 * answer: `/quiz start` posts to the channel because it starts a shared
 * activity, while `/hint` and any error message reply **ephemerally** — those
 * are for one person, and an interaction reply is the only way the bot can be
 * private at all.
 */

/** What a command needs beyond the flow's own dependencies. */
export interface CommandDeps extends FlowDeps {
  discord: DiscordEffects;
}

const CHANNEL_MISSING = `That command only works in a channel.`;

/**
 * `/quiz start` — begin a session in this channel.
 *
 * Replies ephemerally on success rather than posting twice: the question embed
 * is the visible result, and a second public "started" message would just be
 * noise above it.
 */
const start = async (
  deps: CommandDeps,
  interaction: Interaction,
  channelId: string,
  options: Parameters<typeof parseSettings>[0]
): Promise<void> => {
  const settings = parseSettings(options);
  if (!isSettings(settings)) {
    await deps.discord.reply(interaction, {
      content: settings.errors.map((e) => `• ${e.message}`).join(`\n`),
      ephemeral: true
    });
    return;
  }

  const existing = await deps.session.current();
  if (existing !== null && existing.state !== `finished`) {
    await deps.discord.reply(interaction, {
      content: `A session is already running here. Use \`/quiz end\` first.`,
      ephemeral: true
    });
    return;
  }

  await deps.discord.reply(interaction, {
    content: `Starting a session…`,
    ephemeral: true
  });
  await startSession(deps, channelId, settings);
};

/** `/quiz config` — change the running session's settings from the next question. */
const config = async (
  deps: CommandDeps,
  interaction: Interaction,
  options: Parameters<typeof parseSettings>[0]
): Promise<void> => {
  const view = await deps.session.current();
  if (view === null || view.state === `finished`) {
    await deps.discord.reply(interaction, {
      content: `No session is running here. Start one with \`/quiz start\`.`,
      ephemeral: true
    });
    return;
  }

  const settings = parseSettings(options, {
    filters: view.context.filters,
    session: { ...view.context.config }
  } as never);
  if (!isSettings(settings)) {
    await deps.discord.reply(interaction, {
      content: settings.errors.map((e) => `• ${e.message}`).join(`\n`),
      ephemeral: true
    });
    return;
  }

  await deps.session.configure(settings);
  await deps.discord.reply(interaction, {
    content: `Updated. This applies from the next question.`,
    ephemeral: true
  });
};

/** `/quiz end` — stop early and post the standings. */
const end = async (
  deps: CommandDeps,
  interaction: Interaction,
  channelId: string
): Promise<void> => {
  const view = await deps.session.current();
  if (view === null || view.state === `finished`) {
    await deps.discord.reply(interaction, {
      content: `No session is running here.`,
      ephemeral: true
    });
    return;
  }

  const standings = await deps.session.end();
  await deps.discord.reply(interaction, {
    content: `Session ended.`,
    ephemeral: true
  });
  if (standings !== null) {
    await deps.discord.post(
      channelId,
      scoresEmbed(standings, view.context.questionNumber)
    );
  }
};

/**
 * `/hint` — a private nudge.
 *
 * The whole point of the ephemeral reply: a hint that everyone could see would
 * end the race, and one sent by DM would make the player leave the channel.
 * This is the one place Discord lets the bot be private, because an interaction
 * carries a token.
 */
const hint = async (
  deps: CommandDeps,
  interaction: Interaction
): Promise<void> => {
  const view = await deps.session.current();
  const question = view?.context.question;
  if (view === null || view.state !== `asking` || question == null) {
    await deps.discord.reply(interaction, {
      content: `No question is open right now.`,
      ephemeral: true
    });
    return;
  }

  await deps.discord.reply(interaction, {
    embed: hintEmbed(question),
    ephemeral: true
  });
};

/**
 * Route an incoming interaction.
 *
 * Only application commands are handled. Components and modal submits arrive
 * through the same event, so they are ignored explicitly rather than falling
 * through to a reply that would not match what the user did.
 */
export const handleCommand = async (
  deps: CommandDeps,
  interaction: Interaction
): Promise<void> => {
  const channelId = interaction.channelId;

  // A button under the question. Same actions as the slash commands, reached
  // without typing — which matters in a channel where typing is how you answer.
  if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
    if (channelId === undefined || channelId === null) return;
    const customId = (interaction.data as { customId?: string } | undefined)
      ?.customId;

    if (customId === BUTTON.hint) {
      await hint(deps, interaction);
      return;
    }
    if (customId === BUTTON.end) {
      await end(deps, interaction, channelId);
      return;
    }

    diagnostics.UNKNOWN_INTERACTION({ name: customId ?? `unnamed component` });
    return;
  }

  if (interaction.type !== InteractionType.APPLICATION_COMMAND) return;

  const name = interaction.data?.name;
  if (name === undefined) return;

  if (channelId === undefined || channelId === null) {
    await deps.discord.reply(interaction, {
      content: CHANNEL_MISSING,
      ephemeral: true
    });
    return;
  }

  const invocation = readOptions(interaction.data?.options);

  if (name === `hint`) {
    await hint(deps, interaction);
    return;
  }

  if (name === `quiz`) {
    switch (invocation.subcommand) {
      case `start`:
        await start(deps, interaction, channelId, invocation.options);
        return;
      case `config`:
        await config(deps, interaction, invocation.options);
        return;
      case `end`:
        await end(deps, interaction, channelId);
        return;
      default:
        break;
    }
  }

  // An unregistered name means the deployed command list and this switch have
  // drifted. Say so rather than leaving the interaction to time out, which
  // shows the user "the application did not respond".
  diagnostics.UNKNOWN_INTERACTION({
    name: `${name}${invocation.subcommand === undefined ? `` : ` ${invocation.subcommand}`}`
  });
  await deps.discord.reply(interaction, {
    content: `I do not have a handler for that yet.`,
    ephemeral: true
  });
};

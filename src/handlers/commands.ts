import { InteractionType } from "@discordkit/client";
import type { Interaction } from "@discordkit/client/interactions/types/Interaction";
import { diagnostics } from "./diagnostics.js";
import { feedbackUrl, type FeedbackKind } from "./feedback.js";
import type { Scope } from "./privacy.js";
import type { DiscordEffects } from "./discord.js";
import { isSettings, parseSettings } from "./quiz/config.js";
import { finish, startSession, type FlowDeps } from "./quiz/flow.js";
import {
  readCustomId,
  readInvoker,
  readOptions,
  readTextOption,
  readUserOption
} from "./quiz/options.js";
import {
  BUTTON,
  feedbackEmbed,
  forgetButtons,
  forgetPreviewEmbed,
  forgottenEmbed,
  leaderboardEmbed,
  optOutButtons,
  readForgetButton,
  readOptOutButton,
  standingEmbed,
  trackingEmbed
} from "./quiz/render.js";

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
  // `guildId` is absent in a DM, where there is no leaderboard to write to.
  await startSession(deps, channelId, interaction.guildId ?? null, settings);
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

  const outcome = await deps.session.end();
  await deps.discord.reply(interaction, {
    content: `Session ended.`,
    ephemeral: true
  });
  // Through `finish` rather than posting directly, so a session stopped early
  // banks its scores the same way one that ran to the end does. Ending a
  // session is not the same as discarding it.
  if (outcome !== null) {
    await finish(deps, channelId, outcome, view.context.questionNumber);
  }
};

/**
 * `/review` — a private second look at the question you got wrong.
 *
 * Ephemeral for the same reason `/hint` is: a public recap would show the
 * channel an answer somebody else is still racing for. Unlike `/hint` it is
 * about a question that has already closed, so it teaches rather than helps.
 *
 * Falls back to the last question when the player has no misses — somebody who
 * has just walked in and missed the reveal is a large part of who runs this.
 */
const review = async (
  deps: CommandDeps,
  interaction: Interaction
): Promise<void> => {
  const userId = readInvoker(interaction);
  if (userId === null) {
    await deps.discord.reply(interaction, {
      content: `I could not tell who asked.`,
      ephemeral: true
    });
    return;
  }

  const view = await deps.session.current();
  if (view === null) {
    await deps.discord.reply(interaction, {
      content: `No session is running here. Start one with \`/quiz start\`.`,
      ephemeral: true
    });
    return;
  }

  const miss = view.context.misses[userId];
  if (miss !== undefined) {
    await deps.discord.reply(interaction, {
      embed: deps.kind.present.review(miss, true),
      ephemeral: true
    });
    return;
  }

  // Nothing wrong yet. The open question is not shown — that would be `/hint`
  // without the restraint, handing over the answer to a question still being
  // raced. Only a question that has already closed can be reviewed.
  const question = view.context.question;
  if (question === null || view.state === `asking`) {
    await deps.discord.reply(interaction, {
      content: `Nothing to review yet. Once a question closes, \`/review\` shows it.`,
      ephemeral: true
    });
    return;
  }

  await deps.discord.reply(interaction, {
    embed: deps.kind.present.review(
      { question, answer: ``, questionNumber: view.context.questionNumber },
      false
    ),
    ephemeral: true
  });
};

/**
 * `/privacy` — what the bot keeps, and how to stop it.
 *
 * Ephemeral throughout. Somebody asking to be forgotten should not have to
 * announce it to the channel, and the reply names their own stored counts.
 */
const privacy = async (
  deps: CommandDeps,
  interaction: Interaction,
  subcommand: string,
  options: unknown
): Promise<void> => {
  const userId = readInvoker(interaction);
  if (userId === null) {
    await deps.discord.reply(interaction, {
      content: `I could not tell who asked.`,
      ephemeral: true
    });
    return;
  }

  const guildId = interaction.guildId;
  const everywhere = readTextOption(options, `scope`) === `everywhere`;

  // Everything except an everywhere-erasure is per guild, and a DM has none.
  if (guildId === undefined && !everywhere) {
    await deps.discord.reply(interaction, {
      content: `That is a per-server setting, so it only works in a server. \`/privacy forget scope:everywhere\` works anywhere.`,
      ephemeral: true
    });
    return;
  }

  const scope: Scope = everywhere
    ? { kind: `everywhere` }
    : { kind: `guild`, guildId: guildId ?? `` };

  if (subcommand === `forget`) {
    // Previewed rather than deleted, because this cannot be undone and the
    // player is entitled to know what they are giving up first.
    const found = await deps.privacy.preview(userId, scope);
    const total = found.reduce((sum, entry) => sum + entry.rows, 0);
    await deps.discord.reply(interaction, {
      embed: forgetPreviewEmbed(found, everywhere),
      ...(total === 0 ? {} : { components: forgetButtons(userId, everywhere) }),
      ephemeral: true
    });
    return;
  }

  if (subcommand === `tracking`) {
    const setting = readTextOption(options, `state`);
    if (setting === `on` || setting === `off`) {
      await deps.privacy.setTracking(guildId ?? ``, userId, setting === `on`);
    }
    const tracked = await deps.privacy.isTracked(guildId ?? ``, userId);
    await deps.discord.reply(interaction, {
      embed: trackingEmbed(tracked),
      ephemeral: true
    });
    return;
  }

  await deps.discord.reply(interaction, {
    content: `Use \`/privacy tracking\` or \`/privacy forget\`.`,
    ephemeral: true
  });
};

/**
 * `/quiz scores` — the guild leaderboard, or one player's standing.
 *
 * Public rather than ephemeral: a leaderboard nobody else can see defeats the
 * point of keeping one. `/hint` is private because seeing it would end the
 * race; standings are the opposite.
 */
const scores = async (
  deps: CommandDeps,
  interaction: Interaction,
  channelId: string,
  options: unknown
): Promise<void> => {
  const guildId = interaction.guildId;
  if (guildId === undefined) {
    await deps.discord.reply(interaction, {
      content: `Scores are kept per server, so this only works in one.`,
      ephemeral: true
    });
    return;
  }

  const userId = readUserOption(options);
  if (userId !== null) {
    const standing = await deps.scores.forUser(guildId, userId);
    // The interaction still needs acknowledging — the embed is public, and an
    // unanswered interaction shows "the application did not respond".
    await deps.discord.reply(interaction, {
      content: `Posted below.`,
      ephemeral: true
    });
    await deps.discord.post(channelId, standingEmbed(userId, standing));
    return;
  }

  const top = await deps.scores.top(guildId);
  await deps.discord.reply(interaction, {
    content: `Posted below.`,
    ephemeral: true
  });
  await deps.discord.post(channelId, leaderboardEmbed(top));
};

/**
 * `/feedback` — open a pre-filled GitHub issue.
 *
 * Ephemeral, because the link carries the reporter's own ids and the channel
 * has no reason to see them. The bot cannot file the issue itself: that would
 * need a repository token held by a bot anyone in the server can invoke.
 */
const feedback = async (
  deps: CommandDeps,
  interaction: Interaction,
  kind: FeedbackKind,
  summary: string
): Promise<void> => {
  const view = await deps.session.current();
  const running = view === null || view.state === `finished` ? null : view;

  const url = feedbackUrl(kind, summary, {
    userId: readInvoker(interaction),
    guildId: interaction.guildId ?? null,
    channelId: interaction.channelId ?? null,
    locale: interaction.locale ?? null,
    session:
      running === null
        ? null
        : {
            length: running.context.config.length,
            timeoutMs: running.context.config.timeoutMs,
            guesses: running.context.config.guesses,
            levels: running.context.filters.levels,
            forms: running.context.filters.forms
          }
  });

  await deps.discord.reply(interaction, {
    embed: feedbackEmbed(kind, url),
    ephemeral: true
  });
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
    embed: deps.kind.present.hint(question),
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
    const customId = readCustomId(interaction.data);

    if (customId === BUTTON.hint) {
      await hint(deps, interaction);
      return;
    }
    if (customId === BUTTON.end) {
      await end(deps, interaction, channelId);
      return;
    }

    // The follow-up offered after an erasure.
    const optOut = customId === null ? null : readOptOutButton(customId);
    if (optOut !== null) {
      const presser = readInvoker(interaction);
      if (presser === null || presser !== optOut) {
        await deps.discord.reply(interaction, {
          content: `That button is not yours.`,
          ephemeral: true
        });
        return;
      }
      await deps.privacy.setTracking(interaction.guildId ?? ``, optOut, false);
      await deps.discord.reply(interaction, {
        embed: trackingEmbed(false),
        ephemeral: true
      });
      return;
    }

    const forget = customId === null ? null : readForgetButton(customId);
    if (forget !== null) {
      // The id names who it was built for. Ephemeral messages are private, so
      // this is belt and braces — but the action is irreversible, and one
      // comparison is a cheap way to be sure it is self-service only.
      const presser = readInvoker(interaction);
      if (presser === null || presser !== forget.userId) {
        await deps.discord.reply(interaction, {
          content: `That button is not yours.`,
          ephemeral: true
        });
        return;
      }
      const guildId = interaction.guildId ?? ``;
      const erased = await deps.privacy.forget(
        forget.userId,
        forget.everywhere ? { kind: `everywhere` } : { kind: `guild`, guildId }
      );

      // Erasure took the tracking preference with it, so the player is now
      // tracked again whether or not they were before. Saying so — and
      // offering the one-press way back out — is the difference between a
      // deletion they understand and one that quietly resets their choice.
      const trackedFromNow = await deps.privacy.isTracked(
        guildId,
        forget.userId
      );
      await deps.discord.reply(interaction, {
        embed: forgottenEmbed(erased, trackedFromNow),
        ...(trackedFromNow ? { components: optOutButtons(forget.userId) } : {}),
        ephemeral: true
      });
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

  if (name === `review`) {
    await review(deps, interaction);
    return;
  }

  if (name === `privacy`) {
    await privacy(
      deps,
      interaction,
      invocation.subcommand ?? ``,
      interaction.data?.options
    );
    return;
  }

  if (name === `feedback`) {
    const kind = invocation.subcommand === `idea` ? `idea` : `bug`;
    await feedback(
      deps,
      interaction,
      kind,
      readTextOption(interaction.data?.options, `summary`)
    );
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
      case `scores`:
        await scores(deps, interaction, channelId, interaction.data?.options);
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

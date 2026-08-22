import {
  createInteractionResponse,
  createMessage,
  createReaction,
  InteractionCallbackType,
  MessageFlag,
  type ActionRow,
  type Embed
} from "@discordkit/client";
import type { Interaction } from "@discordkit/client/interactions/types/Interaction";
import { diagnostics } from "./diagnostics.js";

/**
 * Everything the bot does to the outside world, behind one interface.
 *
 * The quiz logic depends on this shape rather than on `@discordkit/client`, so
 * the flow that decides *what* to post can be tested by handing it a recording
 * stub — no token, no network, no Workers runtime. The real implementation is
 * the only place that talks to Discord.
 *
 * Every method swallows its failures and reports a diagnostic. A bot that
 * throws because it could not add a reaction would abandon the question it was
 * in the middle of running; the round matters more than the emoji.
 */
export interface DiscordEffects {
  /** Post a message to a channel. Returns its id, or null if it failed. */
  post: (
    channelId: string,
    embed: Embed,
    components?: ActionRow[]
  ) => Promise<string | null>;
  /** Post plain text, for short notices that do not warrant an embed. */
  say: (channelId: string, content: string) => Promise<string | null>;
  /** React to a message, which is how a guess is marked right or wrong. */
  react: (channelId: string, messageId: string, emoji: string) => Promise<void>;
  /** Reply to an interaction, privately when `ephemeral`. */
  reply: (
    interaction: Interaction,
    body: { content?: string; embed?: Embed; ephemeral?: boolean }
  ) => Promise<void>;
}

/** Pull a status code out of whatever the client threw. */
const statusOf = (error: unknown): number | undefined => {
  if (typeof error === `object` && error !== null && `status` in error) {
    const { status } = error;
    if (typeof status === `number`) return status;
  }
  return undefined;
};

const detailOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * The real implementation.
 *
 * The reaction path is worth a note. Discord takes the emoji in the URL, and
 * for a Unicode emoji that means the character itself rather than a custom
 * emoji's id — the route is `.../reactions/{emoji}/@me` either way.
 *
 * The character is passed through as-is: `URL` percent-encodes non-ASCII path
 * segments on its own, so ❌ reaches Discord correctly. Calling
 * `encodeURIComponent` first would be worse than redundant, since an
 * already-encoded string would be encoded twice and arrive as the literal text
 * `%E2%9D%8C`.
 */
export const discordEffects: DiscordEffects = {
  post: async (channelId, embed, components) => {
    try {
      const message = await createMessage({
        channel: channelId,
        body: {
          embeds: [embed],
          ...(components === undefined ? {} : { components })
        }
      });
      return (message as { id?: string }).id ?? null;
    } catch (error) {
      diagnostics.DISCORD_REQUEST_FAILED({
        action: `posting an embed`,
        status: statusOf(error),
        detail: detailOf(error)
      });
      return null;
    }
  },

  say: async (channelId, content) => {
    try {
      const message = await createMessage({
        channel: channelId,
        body: { content }
      });
      return (message as { id?: string }).id ?? null;
    } catch (error) {
      diagnostics.DISCORD_REQUEST_FAILED({
        action: `posting a message`,
        status: statusOf(error),
        detail: detailOf(error)
      });
      return null;
    }
  },

  react: async (channelId, messageId, emoji) => {
    try {
      await createReaction({
        channel: channelId,
        message: messageId,
        emoji
      });
    } catch (error) {
      // Deliberately not rethrown. A missing reaction is cosmetic; abandoning
      // the round over it would not be.
      diagnostics.DISCORD_REQUEST_FAILED({
        action: `adding the ${emoji} reaction`,
        status: statusOf(error),
        detail: detailOf(error)
      });
    }
  },

  reply: async (interaction, { content, embed, ephemeral }) => {
    try {
      await createInteractionResponse(
        {
          interaction: interaction.id,
          token: interaction.token,
          body: {
            type: InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              ...(content === undefined ? {} : { content }),
              ...(embed === undefined ? {} : { embeds: [embed] }),
              // EPHEMERAL is the only flag an interaction response may set, and
              // it is the one thing that makes a private reply possible at all.
              ...(ephemeral === true ? { flags: MessageFlag.EPHEMERAL } : {})
            }
          }
        },
        { anonymous: true }
      );
    } catch (error) {
      diagnostics.DISCORD_REQUEST_FAILED({
        action: `replying to an interaction`,
        status: statusOf(error),
        detail: detailOf(error)
      });
    }
  }
};

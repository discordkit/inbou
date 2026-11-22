import {
  createFollowupMessage,
  createInteractionResponse,
  createMessage,
  createReaction,
  editMessage,
  InteractionCallbackType,
  MessageFlag,
  type ActionRow,
  type Embed,
  type MessageComponent
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
    body: {
      content?: string;
      embed?: Embed;
      ephemeral?: boolean;
      components?: ActionRow[];
    }
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

/**
 * Take the token out of an interaction or webhook URL before it is logged.
 *
 * The client's errors carry the full request URL, and these routes put a
 * token in the path — a credential that can post as the bot for fifteen
 * minutes. Found in the first live test, printed whole in the dev log.
 */
export const redactTokens = (text: string): string =>
  text.replace(/(\/(?:interactions|webhooks)\/\d+\/)[^/\s'"]+/gu, `$1<token>`);

const detailOf = (error: unknown): string =>
  redactTokens(error instanceof Error ? error.message : String(error));

/**
 * A local validation failure, rather than one Discord rejected.
 *
 * Valibot throws before the request leaves, so there is no status code. Told
 * apart from a network failure because the fix is different: a layout error is
 * a bug in our renderer, not a permission or an outage.
 */
const isValidationError = (error: unknown): boolean =>
  statusOf(error) === undefined && detailOf(error).includes(`Invalid`);

/**
 * Components V2 messages, which the mock tests are built from.
 *
 * Separate from {@link DiscordEffects} rather than added to it: V2 is all or
 * nothing per message (no `content`, no embeds), so the two kinds of message
 * never share a call, and the quiz's recording stubs need not grow methods
 * they never use.
 *
 * Same contract as the rest of this module: failures are reported, never
 * thrown, because the test in progress matters more than one message.
 */
export interface V2Effects {
  /** Post a V2 message. Returns its id, or null if it failed. */
  post: (
    channelId: string,
    components: MessageComponent
  ) => Promise<string | null>;
  /**
   * Replace a posted message's components.
   *
   * Used to settle a question when its timer ends. Discord renders `<t:…:R>`
   * on the client forever, so a closed question that was never edited keeps
   * counting up from its own deadline.
   */
  edit: (
    channelId: string,
    messageId: string,
    components: MessageComponent
  ) => Promise<void>;
}

/**
 * Private messages sent after the fact, on an earlier press's token.
 *
 * An ephemeral message must answer an interaction, so a bot can only speak privately to someone who pressed something in the last fifteen minutes. A mock-test vote is that press: its token lets the reveal follow up with that player alone.
 */
export interface FollowUpEffects {
  send: (
    reply: { application: string; token: string },
    content: string
  ) => Promise<void>;
}

/**
 * Mentions in a V2 message name people without pinging them.
 *
 * A results card names every player; a ping for each one, after every test,
 * would make people leave the channel.
 */
const NO_PINGS = { parse: [] };

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

  reply: async (interaction, { content, embed, ephemeral, components }) => {
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
              ...(components === undefined ? {} : { components }),
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

export const v2Effects: V2Effects = {
  post: async (channelId, components) => {
    try {
      const message = await createMessage({
        channel: channelId,
        body: {
          // Required for Container, TextDisplay and Separator. With it set,
          // Discord rejects `content` and `embeds`, so neither is sent.
          flags: MessageFlag.IS_COMPONENTS_V2,
          components,
          allowedMentions: NO_PINGS
        }
      });
      return (message as { id?: string }).id ?? null;
    } catch (error) {
      if (isValidationError(error)) {
        diagnostics.COMPONENT_LAYOUT_INVALID({
          action: `posting a mock-test message`,
          detail: detailOf(error)
        });
      } else {
        diagnostics.DISCORD_REQUEST_FAILED({
          action: `posting a mock-test message`,
          status: statusOf(error),
          detail: detailOf(error)
        });
      }
      return null;
    }
  },

  edit: async (channelId, messageId, components) => {
    try {
      await editMessage({
        channel: channelId,
        message: messageId,
        body: {
          // Restated on every edit: the edit replaces the body, and without the
          // flag Discord reads a V2 payload as a legacy one and rejects it.
          flags: MessageFlag.IS_COMPONENTS_V2,
          components,
          allowedMentions: NO_PINGS
        }
      });
    } catch (error) {
      // Not rethrown. An unsettled question is untidy, and a vote on it is
      // already rejected by its token.
      diagnostics.DISCORD_REQUEST_FAILED({
        action: `settling a closed question`,
        status: statusOf(error),
        detail: detailOf(error)
      });
    }
  }
};

export const followUpEffects: FollowUpEffects = {
  send: async ({ application, token }, content) => {
    try {
      await createFollowupMessage(
        {
          application,
          token,
          body: {
            content,
            flags: MessageFlag.EPHEMERAL,
            allowedMentions: NO_PINGS
          }
        },
        // The token in the route is the credential; the bot token is not needed.
        { anonymous: true }
      );
    } catch (error) {
      // Not rethrown. One student missing a note must not stop the test, and
      // My results has every why.
      diagnostics.DISCORD_REQUEST_FAILED({
        action: `sending a private follow-up`,
        status: statusOf(error),
        detail: detailOf(error)
      });
    }
  }
};

import { createMessage } from "@discordkit/client";
import type { MessageCreate } from "@discordkit/gateway";

/**
 * Route an incoming message.
 *
 * Reading `content` needs the privileged `MESSAGE_CONTENT` intent. Without it
 * the event still arrives but `content` is an empty string, so a prefix match
 * silently never fires — no error, no log line. The bot Worker requests the
 * intent explicitly for that reason.
 */
export const handleMessage = async (message: MessageCreate): Promise<void> => {
  // Ignore bots, including ourselves. Without this a bot that replies to a
  // prefix could answer its own message and loop.
  if (message.author.bot === true) return;

  if (message.content === `!ping`) {
    await createMessage({
      channel: message.channelId,
      body: { content: `ポン！` }
    });
  }
};

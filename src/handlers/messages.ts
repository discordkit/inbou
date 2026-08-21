import type { MessageCreate } from "@discordkit/gateway";
import { handleAnswer, type FlowDeps } from "./quiz/flow.js";

/**
 * Route an incoming message.
 *
 * This is the answer race. Every message in a channel with a running session
 * reaches here, so the cheap rejections come first — a channel that is not
 * playing must cost almost nothing, since this fires on ordinary conversation
 * too.
 *
 * Reading `content` needs the privileged `MESSAGE_CONTENT` intent. Without it
 * the event still arrives but `content` is an empty string, so every answer
 * would silently score as wrong — no error, no log line. The bot Worker
 * requests the intent explicitly for that reason.
 */
export const handleMessage = async (
  deps: FlowDeps,
  message: MessageCreate
): Promise<void> => {
  // Ignore bots, including ourselves. The bot posts the answer in its reveal
  // embed, so without this it would answer its own question.
  if (message.author.bot === true) return;

  const content = message.content.trim();
  if (content === ``) return;

  // A slash command is an interaction, not a message, so anything starting
  // with `/` here is someone typing rather than invoking — and it is certainly
  // not a conjugation.
  if (content.startsWith(`/`)) return;

  await handleAnswer(
    deps,
    message.channelId,
    message.id,
    message.author.id,
    content
  );
};

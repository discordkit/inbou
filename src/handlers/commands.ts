import {
  createInteractionResponse,
  InteractionType,
  InteractionCallbackType
} from "@discordkit/client";
import type { Interaction } from "@discordkit/client/interactions/types/Interaction";

/**
 * Reply to a slash command.
 *
 * `createInteractionResponse` is an anonymous endpoint: it authenticates with
 * the interaction's own token, not the bot's, so replying needs no session.
 * Discord gives that token a three-second window — anything slower has to defer
 * first with `DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE` and edit the reply later.
 */
const reply = async (
  interaction: Interaction,
  content: string
): Promise<void> => {
  await createInteractionResponse(
    {
      interaction: interaction.id,
      token: interaction.token,
      body: {
        type: InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content }
      }
    },
    { anonymous: true }
  );
};

/**
 * Route an incoming interaction to its handler.
 *
 * Only application commands are handled for now. Components and modal submits
 * arrive through the same event, so they are ignored explicitly rather than
 * falling through to a reply that would not match what the user did.
 */
export const handleCommand = async (
  interaction: Interaction
): Promise<void> => {
  if (interaction.type !== InteractionType.APPLICATION_COMMAND) return;

  const name = interaction.data?.name;

  switch (name) {
    case undefined:
      // No command data on an APPLICATION_COMMAND interaction means Discord
      // sent something this bot does not model. Nothing useful to reply.
      return;
    case `ping`:
      await reply(interaction, `ポン！`);
      return;
    default:
      // An unregistered name means the deployed commands and this switch have
      // drifted. Say so rather than leaving the interaction to time out, which
      // shows the user "the application did not respond".
      await reply(interaction, `I do not have a handler for \`/${name}\` yet.`);
  }
};

import type { Interaction } from "@discordkit/client/interactions/types/Interaction";
import type { MessageCreate } from "@discordkit/gateway";

/**
 * The contract between the two Workers.
 *
 * The bot Worker owns the Gateway connection and forwards events here over a
 * service binding; this Worker holds the logic that acts on them. Naming the
 * shape in one place is what keeps the two halves from drifting apart, since
 * they are separately deployed and a mismatch would otherwise only surface at
 * runtime as an event that silently does nothing.
 *
 * `type` mirrors Discord's own event name so the discriminant reads the same on
 * both sides.
 */
export type ForwardedEvent =
  | { type: `INTERACTION_CREATE`; data: Interaction }
  | { type: `MESSAGE_CREATE`; data: MessageCreate };

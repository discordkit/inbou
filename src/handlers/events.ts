import type { Interaction } from "@discordkit/client/interactions/types/Interaction";
import type { MessageCreate } from "@discordkit/gateway";

/**
 * The contract between the two Workers, which deploy separately.
 *
 * The bot Worker owns the Gateway connection and forwards events here; a
 * mismatch between the halves would otherwise only surface at runtime, as an
 * event that silently does nothing.
 *
 * The two `SESSION_` events come from the session object's alarm rather than
 * the Gateway. The object can close a question but cannot post the reveal (a
 * REST call) or choose the next one (it does not carry the corpus), so it hands
 * both back here.
 */
export type ForwardedEvent =
  | { type: `INTERACTION_CREATE`; data: Interaction }
  | { type: `MESSAGE_CREATE`; data: MessageCreate }
  | { type: `SESSION_TIMEOUT`; channelId: string }
  | { type: `SESSION_RESUME`; channelId: string };

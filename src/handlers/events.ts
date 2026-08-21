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
  | { type: `MESSAGE_CREATE`; data: MessageCreate }
  /**
   * A question ran out of time.
   *
   * Unlike the other two this does not come from the Gateway — it is the
   * session object's alarm calling its own Worker back. The object can close
   * the question itself, but it can neither post the reveal (a REST call) nor
   * choose the next question (which needs the corpus it deliberately does not
   * carry), so it hands both back here.
   */
  | { type: `SESSION_TIMEOUT`; channelId: string }
  /**
   * A pause between questions ended.
   *
   * Same mechanism as the timeout and the same reason: the wait runs on the
   * session object's alarm, because a Worker's `setTimeout` dies with the
   * isolate. The object distinguishes the two by its own state.
   */
  | { type: `SESSION_RESUME`; channelId: string };

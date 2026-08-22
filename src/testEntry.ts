/**
 * The Worker entry the Vitest pool builds its test Worker from. Not shipped.
 *
 * The pool runs every test in one Worker and resolves Durable Objects against
 * that Worker's entry, but this project splits its objects across two. Neither
 * real entry exports both, so re-exporting them here is what lets one pool
 * reach both. Production keeps the split.
 */

export { InbouBot } from "./worker/bot.js";
export { QuizSession } from "./handlers/session.js";

// The pool requires a default export; nothing routes here.
export default {
  fetch: (): Response => new Response(`test entry`, { status: 404 })
};

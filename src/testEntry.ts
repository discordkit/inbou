/**
 * The Worker entry the Vitest pool builds its test Worker from.
 *
 * Not shipped. The pool runs every test inside a single Worker and resolves
 * each Durable Object binding against that Worker's entry module, but this
 * project deliberately splits its objects across two Workers: `InbouBot` holds
 * the Gateway connection in the bot Worker, and `QuizSession` holds per-channel
 * quiz state in the handlers Worker. Neither entry exports both, so pointing
 * the pool at either one makes the other's object unconstructable.
 *
 * Re-exporting both here gives the pool one module that satisfies both
 * bindings. It exists purely so tests can reach the real classes; production
 * keeps the split, which `wrangler dev` confirms by reporting the two
 * namespaces against their own Workers.
 */

export { InbouBot } from "./worker/bot.js";
export { QuizSession } from "./handlers/session.js";

// The pool expects an entry with a default export, and a Durable Object cannot
// be one. Nothing routes to this handler — the tests call the objects directly.
export default {
  fetch: (): Response => new Response(`test entry`, { status: 404 })
};

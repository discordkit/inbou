import type { Env, InbouBot } from "./bot.js";

export { InbouBot } from "./bot.js";
export type { Env } from "./bot.js";

/**
 * The single Durable Object instance holding the Gateway connection. Discord
 * allows one session per bot, so there is exactly one of these.
 */
const bot = (env: Env): DurableObjectStub<InbouBot> =>
  env.BOT.get(env.BOT.idFromName(`singleton`));

/**
 * The Worker is deliberately thin. It has no user-facing surface: the bot talks
 * to Discord over the Gateway from inside the Durable Object, and these
 * handlers exist only to make sure that object is awake.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // A health check that doubles as a manual kick: reporting the state
    // requires the object, and waking it starts the connection.
    if (url.pathname === `/health`) {
      const stub = bot(env);
      await stub.start();
      return Response.json(await stub.status());
    }

    return new Response(`Not found`, { status: 404 });
  },

  /**
   * A Durable Object can be evicted, and an evicted bot is an offline bot. The
   * cron trigger wakes it on a schedule so the connection is re-established
   * without anyone having to send a request.
   *
   * `start()` is idempotent — a live connection short-circuits — so this costs
   * nothing when the bot is already running.
   *
   * **Crons do not fire on a schedule in local dev.** Miniflare exposes them as
   * an endpoint instead, so nothing would wake the object locally — and nothing
   * on the Discord side can either. Events travel one way, this Worker to the
   * handlers, so a slash command never reaches back here; and with the socket
   * asleep no events arrive to forward in the first place.
   *
   * A plugin in `vite.config.ts` requests `/health` once the dev server is
   * listening, which breaks that loop. By hand, either of these does the same:
   *
   *     curl http://localhost:5173/health
   *     curl "http://localhost:5173/cdn-cgi/handler/scheduled?format=json"
   *
   * In production the cron does this every five minutes on its own.
   */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await bot(env).start();
  }
} satisfies ExportedHandler<Env>;

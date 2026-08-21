import { discord } from "@discordkit/client";
import { handleCommand } from "./commands.js";
import type { ForwardedEvent } from "./events.js";
import { handleMessage } from "./messages.js";
import type { QuizSession } from "./session.js";

// Re-exported so the runtime can construct the class this Worker's
// `durable_objects` binding names. Quiz sessions live here rather than in the
// bot Worker so that editing them never restarts the Gateway connection.
export { QuizSession } from "./session.js";

/**
 * The reloadable half of the bot.
 *
 * Everything under `src/handlers/` can be edited freely during development.
 * This is a separate Worker from the one holding the Gateway connection, so the
 * Cloudflare plugin reloads it on its own — the Durable Object is never torn
 * down and the Discord session survives.
 *
 * The bot Worker forwards each event here over a service binding. Replies go
 * back to Discord over REST, so this Worker needs no Gateway session of its own.
 */
export interface Env {
  /**
   * Bot token. Interaction replies authenticate with the interaction's own
   * token, but posting an ordinary message does not — `createMessage` needs
   * this.
   */
  DISCORD_BOT_TOKEN: string;
  /** One quiz session per channel, keyed by channel id. */
  SESSION: DurableObjectNamespace<QuizSession>;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Workers have no `process.env`, so the REST session cannot pick the token
    // up on its own. Set it per request: the isolate is shared between
    // invocations, but this is idempotent and cheap.
    discord.setToken(`Bot ${env.DISCORD_BOT_TOKEN}`);

    const event = await request.json<ForwardedEvent>();

    try {
      switch (event.type) {
        case `INTERACTION_CREATE`:
          await handleCommand(event.data);
          break;
        case `MESSAGE_CREATE`:
          await handleMessage(event.data);
          break;
      }
      return Response.json({ ok: true });
    } catch (error) {
      // Report rather than throw: the bot Worker only forwards, and a failure
      // in app logic should not read as an unhealthy connection.
      console.error(`Failed to handle ${event.type}`, error);
      return Response.json(
        { ok: false, error: String(error) },
        { status: 500 }
      );
    }
  }
} satisfies ExportedHandler<Env>;

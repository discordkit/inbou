import { discord } from "@discordkit/client";
import { handleCommand } from "./commands.js";
import { discordEffects } from "./discord.js";
import type { ForwardedEvent } from "./events.js";
import { handleMessage } from "./messages.js";
import corpus from "./quiz/corpus.json";
import { handleTimeout, type FlowDeps, type SessionPort } from "./quiz/flow.js";
import type { Word } from "./quiz/question.js";
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

/**
 * The corpus, read once per isolate.
 *
 * Imported at module scope so the JSON is parsed when the Worker boots rather
 * than on every request. It never reaches the Durable Object: that object wakes
 * from hibernation constantly and would re-parse 1.8 MB each time, which is why
 * questions are generated out here and handed to it already resolved.
 */
const words = corpus.words as Word[];

/** The session for one channel. */
const sessionFor = (env: Env, channelId: string): SessionPort =>
  env.SESSION.get(env.SESSION.idFromName(channelId));

const depsFor = (env: Env, channelId: string): FlowDeps => ({
  discord: discordEffects,
  session: sessionFor(env, channelId),
  words
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Workers have no `process.env`, so the REST session cannot pick the token
    // up on its own. Set it per request: the isolate is shared between
    // invocations, but this is idempotent and cheap.
    discord.setToken(`Bot ${env.DISCORD_BOT_TOKEN}`);

    const event = await request.json<ForwardedEvent>();

    try {
      switch (event.type) {
        case `INTERACTION_CREATE`: {
          const channelId = event.data.channelId;
          // A command outside a channel has no session to act on. `handleCommand`
          // says so; the deps just need somewhere to point.
          await handleCommand(depsFor(env, channelId ?? `dm`), event.data);
          break;
        }
        case `MESSAGE_CREATE`:
          await handleMessage(depsFor(env, event.data.channelId), event.data);
          break;
        case `SESSION_TIMEOUT`:
          // The Durable Object's alarm fired. It has already closed the
          // question; this posts the reveal and asks the next one, because
          // neither can be done from inside the object — one needs the corpus,
          // the other needs a REST call.
          await handleTimeout(depsFor(env, event.channelId), event.channelId);
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

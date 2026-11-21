import { DurableObject } from "cloudflare:workers";
import {
  GatewayConnection,
  onInteractionCreate,
  onMessageCreate,
  onReady
} from "@discordkit/gateway";
import type { ForwardedEvent } from "../handlers/events.js";
import { alarmScheduler } from "./alarmScheduler.js";
import { keeper, STUCK_MS } from "./keeper.js";

export interface Env {
  /** Bot token. Authenticates the Gateway connection and the REST calls. */
  DISCORD_BOT_TOKEN: string;
  /** Application ID, used when registering commands. */
  DISCORD_APPLICATION_ID: string;
  /** Guild to register commands into during development. Optional. */
  DISCORD_GUILD_ID?: string;
  /** This Durable Object's own namespace, for the cron wake-up. */
  BOT: DurableObjectNamespace<InbouBot>;
  HANDLERS: Fetcher;
}

/**
 * Holds the single Gateway connection.
 *
 * Discord allows one Gateway session per bot, and a Worker invocation cannot
 * keep a socket open past the request that created it. A Durable Object can:
 * it is addressable, single-instance, and its alarms survive eviction. So the
 * whole bot lives here and the Worker is only a doorway.
 */
export class InbouBot extends DurableObject<Env> {
  /**
   * Connection timers run on Durable Object alarms rather than `setTimeout`.
   * A DO's JS timers die with its isolate, so an evicted object would stop
   * heartbeating and lose the session with no error anywhere.
   */
  readonly #scheduler = alarmScheduler(this.ctx);

  /** Owns the connection, and replaces it when it is stuck. See `keeper`. */
  readonly #keeper = keeper({
    open: () => this.#open(),
    pending: () => this.#scheduler.pending(),
    now: Date.now,
    log: (message) => {
      console.warn(message);
    }
  });

  /**
   * Make sure the Gateway connection is live, opening or replacing it if not.
   *
   * Idempotent by design: the cron trigger calls this every few minutes, and so does every alarm, which is what brings the bot back within seconds after a restart.
   */
  async start(): Promise<{ state: string }> {
    const { state } = this.#keeper.ensure();
    await this.#watch();
    return { state };
  }

  /**
   * A connection waiting on a `close` event or a HELLO has no timer, so no alarm would come to check it. Set one, so a wait that never ends is caught.
   */
  async #watch(): Promise<void> {
    if (this.#scheduler.pending() === 0) {
      await this.ctx.storage.setAlarm(Date.now() + STUCK_MS);
    }
  }

  #open(): GatewayConnection {
    const connection = new GatewayConnection({
      token: this.env.DISCORD_BOT_TOKEN,
      scheduler: this.#scheduler
    });

    // The connection's own record, so the logs show when it dropped and how it came back.
    connection.onStateChange((state) => {
      console.log(`Gateway ${state}`);
    });

    onReady(
      ({ user }) => {
        console.log(`Connected as ${user.username}`);
      },
      { connection }
    );

    // Every event goes to the handlers Worker rather than being handled here.
    // That Worker reloads independently, so editing app logic never tears down
    // this Durable Object — and never costs a Gateway session start.
    onInteractionCreate(
      (data) => {
        this.#forward({ type: `INTERACTION_CREATE`, data });
      },
      { connection }
    );

    onMessageCreate(
      (data) => {
        this.#forward({ type: `MESSAGE_CREATE`, data });
      },
      { connection }
    );

    // `onMessageCreate` registers GUILD_MESSAGES and DIRECT_MESSAGES itself.
    // These three are the ones no handler can imply:
    //   - GUILDS: the baseline for a bot that lives in a server.
    //   - MESSAGE_CONTENT: privileged, and gates message *fields* rather than
    //     an event. Without it `content` arrives as an empty string and a
    //     prefix match silently never fires.
    //   - GUILD_MEMBERS: privileged; needed to read member data.
    // Both privileged intents must also be enabled in the Developer Portal, or
    // Discord closes the connection with a fatal 4014.
    connection.setIntents(`GUILDS`, `MESSAGE_CONTENT`, `GUILD_MEMBERS`);

    connection.connect();
    return connection;
  }

  /**
   * Hand an event to the handlers Worker.
   *
   * Deliberately fire-and-forget: the Gateway fan-out does not await handlers,
   * and making the socket wait on app logic would let a slow handler stall
   * heartbeats. Failures are logged rather than thrown, since a bug in app
   * logic should not read as an unhealthy connection.
   *
   * The handlers answer at once and do the work afterwards, so this request is short. Its body is discarded, as Cloudflare advises for a response nobody reads.
   */
  #forward(event: ForwardedEvent): void {
    void (async (): Promise<void> => {
      try {
        const response = await this.env.HANDLERS.fetch(
          `https://handlers/event`,
          { method: `POST`, body: JSON.stringify(event) }
        );
        await response.body?.cancel();
        if (!response.ok) {
          console.error(
            `Handlers refused ${event.type} with ${String(response.status)}`
          );
        }
      } catch (error) {
        console.error(`Failed to forward ${event.type}`, error);
      }
    })();
  }

  /** Current connection state, for the health endpoint. */
  status(): { state: string; sessionId: string | null } {
    const connection = this.#keeper.current();
    return {
      state: connection?.state ?? `idle`,
      sessionId: connection?.sessionId ?? null
    };
  }

  /**
   * Fires whatever connection timers have come due, then makes sure the connection is still live. After a restart the timers are gone, and this is what reconnects; a connection with no timer for a minute is replaced. See `keeper`.
   */
  override async alarm(): Promise<void> {
    await this.#scheduler.onAlarm();
    await this.start();
  }
}

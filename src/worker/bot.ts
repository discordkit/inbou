import { DurableObject } from "cloudflare:workers";
import {
  GatewayConnection,
  onInteractionCreate,
  onMessageCreate,
  onReady
} from "@discordkit/gateway";
import type { ForwardedEvent } from "../handlers/events.js";
import { alarmScheduler } from "./alarmScheduler.js";

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
  #connection: GatewayConnection | null = null;

  /**
   * Connection timers run on Durable Object alarms rather than `setTimeout`.
   * A DO's JS timers die with its isolate, so an evicted object would stop
   * heartbeating and lose the session with no error anywhere.
   */
  readonly #scheduler = alarmScheduler(this.ctx);

  /**
   * Open the Gateway connection if it is not already live.
   *
   * Idempotent by design: the cron trigger calls this every few minutes, and
   * after an eviction it is what brings the bot back.
   */
  start(): { state: string } {
    // A closed connection is still a non-null object. Guarding on presence
    // alone would make every later call a silent no-op once a session failed.
    if (this.#connection !== null && this.#connection.state !== `closed`) {
      return { state: this.#connection.state };
    }

    const connection = new GatewayConnection({
      token: this.env.DISCORD_BOT_TOKEN,
      scheduler: this.#scheduler
    });
    this.#connection = connection;

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
    return { state: connection.state };
  }

  /**
   * Hand an event to the handlers Worker.
   *
   * Deliberately fire-and-forget: the Gateway fan-out does not await handlers,
   * and making the socket wait on app logic would let a slow handler stall
   * heartbeats. Failures are logged rather than thrown, since a bug in app
   * logic should not read as an unhealthy connection.
   */
  #forward(event: ForwardedEvent): void {
    void (async (): Promise<void> => {
      try {
        await this.env.HANDLERS.fetch(`https://handlers/event`, {
          method: `POST`,
          body: JSON.stringify(event)
        });
      } catch (error) {
        console.error(`Failed to forward ${event.type}`, error);
      }
    })();
  }

  /** Current connection state, for the health endpoint. */
  status(): { state: string; sessionId: string | null } {
    return {
      state: this.#connection?.state ?? `idle`,
      sessionId: this.#connection?.sessionId ?? null
    };
  }

  /** Fires whatever connection timers have come due. See `alarmScheduler`. */
  override async alarm(): Promise<void> {
    await this.#scheduler.onAlarm();
  }
}

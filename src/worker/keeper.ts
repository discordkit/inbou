/**
 * Keeps one Gateway connection alive, and replaces it when it can no longer recover on its own.
 *
 * The connection reports a state, but the state alone can lie. After a missed heartbeat ACK it closes its socket and waits for the `close` event to schedule a reconnect. If that event never comes, as with a peer that has silently gone, it stays `ready` with nothing scheduled. A connect attempt whose HELLO never arrives is stuck the same way. Both happened in production on 2026-11-21, and the bot heard nothing until the five-minute cron.
 *
 * So the test of life is the scheduler, not the state: a live connection always has a timer waiting (a heartbeat, an ACK check or a reconnect). One with no timer for {@link STUCK_MS} is replaced.
 *
 * Pure and runtime-free, so it is tested in Node; the Durable Object passes in the real connection and scheduler.
 */

/** What the keeper needs from a Gateway connection. */
export interface KeptConnection {
  readonly state: string;
  /** Stop for good: no reconnect, even if a late `close` event arrives. */
  close: () => void;
}

export interface KeeperOptions<C extends KeptConnection> {
  /** Create a connection and start connecting. */
  open: () => C;
  /** How many connection timers are waiting. */
  pending: () => number;
  now: () => number;
  log: (message: string) => void;
}

export interface Keeper<C extends KeptConnection> {
  /** Make sure a live connection exists, opening or replacing one if needed. */
  ensure: () => C;
  current: () => C | null;
}

/**
 * How long a connection may go without a timer before it counts as stuck.
 *
 * A `close` event or a HELLO normally arrives within seconds. Replacing a connection sooner would throw away a session that could still resume, and each new session counts against Discord's 1,000 a day.
 */
export const STUCK_MS = 60_000;

export const keeper = <C extends KeptConnection>({
  open,
  pending,
  now,
  log
}: KeeperOptions<C>): Keeper<C> => {
  let connection: C | null = null;
  /** When the connection was last seen without a timer; null while it has one. */
  let quietSince: number | null = null;

  const stuck = (): boolean => {
    if (pending() > 0) {
      quietSince = null;
      return false;
    }
    quietSince ??= now();
    return now() - quietSince >= STUCK_MS;
  };

  return {
    ensure: () => {
      if (connection !== null && connection.state !== `closed` && !stuck()) {
        return connection;
      }
      if (connection !== null && connection.state !== `closed`) {
        log(
          `Replacing a stuck Gateway connection: ${connection.state}, with no timer for ${String(Math.round((now() - (quietSince ?? now())) / 1000))}s`
        );
        connection.close();
      }
      connection = open();
      // A new connection has no timer until Discord's HELLO, so it starts quiet.
      quietSince = now();
      return connection;
    },
    current: () => connection
  };
};

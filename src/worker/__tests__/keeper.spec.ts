import { describe, expect, it } from "vite-plus/test";
import { keeper, STUCK_MS, type KeptConnection } from "../keeper.js";

/**
 * When the bot keeps its Gateway connection, and when it replaces it.
 *
 * Production, 2026-11-21: after a missed heartbeat ACK the connection closed its socket and waited for a `close` event that never came. It stayed `ready` with nothing scheduled, and the bot heard nothing for minutes. These tests pin the rule that catches it: a live connection always has a timer waiting.
 */

interface FakeConnection extends KeptConnection {
  state: string;
  closed: boolean;
}

const setup = () => {
  let clock = 0;
  let timers = 0;
  const opened: FakeConnection[] = [];
  const logs: string[] = [];
  const kept = keeper<FakeConnection>({
    open: () => {
      const connection: FakeConnection = {
        state: `connecting`,
        closed: false,
        close() {
          this.closed = true;
        }
      };
      opened.push(connection);
      return connection;
    },
    pending: () => timers,
    now: () => clock,
    log: (message) => {
      logs.push(message);
    }
  });
  return {
    kept,
    opened,
    logs,
    tick: (ms: number) => {
      clock += ms;
    },
    setTimers: (count: number) => {
      timers = count;
    }
  };
};

describe(`keeping the Gateway connection`, () => {
  it(`opens a connection when there is none`, () => {
    // WHY: after a restart the object has no connection and no timers, and only the next alarm runs. If that alarm did not reconnect, the bot would stay deaf until the five-minute cron.
    const { kept, opened } = setup();
    kept.ensure();
    expect(opened).toHaveLength(1);
  });

  it(`keeps a connection that has a timer waiting, however long it lives`, () => {
    // WHY: every replacement is a new Gateway session, and Discord allows 1,000 a day. A healthy connection must never be replaced.
    const { kept, opened, tick, setTimers } = setup();
    kept.ensure();
    setTimers(1);
    tick(STUCK_MS * 10);
    kept.ensure();
    expect(opened).toHaveLength(1);
    expect(opened[0]?.closed).toBe(false);
  });

  it(`gives a connection without a timer a minute before replacing it`, () => {
    // WHY: a socket that just closed is waiting for its `close` event to schedule a resume, and a new one is waiting for HELLO. Both normally take seconds. Replacing it at once would throw away a session that could resume.
    const { kept, opened, tick, setTimers } = setup();
    kept.ensure();
    setTimers(1);
    kept.ensure();
    setTimers(0);
    kept.ensure();
    tick(STUCK_MS - 1);
    kept.ensure();
    expect(opened).toHaveLength(1);
  });

  it(`replaces a connection that has had no timer for a minute, and stops it first`, () => {
    // WHY: this is the production failure. Nothing would ever schedule another heartbeat, and the state still said ready. The old one is stopped so a late `close` event cannot start a second connection beside the new one.
    const { kept, opened, logs, tick, setTimers } = setup();
    kept.ensure();
    setTimers(1);
    kept.ensure();
    setTimers(0);
    kept.ensure();
    tick(STUCK_MS);
    kept.ensure();
    expect(opened).toHaveLength(2);
    expect(opened[0]?.closed).toBe(true);
    expect(logs).toHaveLength(1);
  });

  it(`replaces a new connection whose HELLO never comes`, () => {
    // WHY: a connect attempt that hangs has no timer from the start, so it must count as quiet from the moment it opens, not from the first check.
    const { kept, opened, tick } = setup();
    kept.ensure();
    tick(STUCK_MS);
    kept.ensure();
    expect(opened).toHaveLength(2);
  });

  it(`replaces a closed connection at once`, () => {
    // WHY: a connection that gave up for good (a fatal close code) will not reconnect itself.
    const { kept, opened } = setup();
    kept.ensure();
    const [first] = opened;
    if (first !== undefined) first.state = `closed`;
    kept.ensure();
    expect(opened).toHaveLength(2);
  });
});

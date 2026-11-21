import { describe, expect, it } from "vite-plus/test";
import handlers, { type Env } from "../index.js";

/**
 * The handlers Worker's front door.
 *
 * Production, 2026-11-21: this Worker answered the bot only after the work was done. That tied the work to the bot's request, so Cloudflare cancelled it whenever the bot's request ended, and the waiting requests shared one pool of six connections with the work's own calls to Discord. Under a class's votes, presses were lost. The rule these tests pin: answer at once, and do the work in `waitUntil`.
 *
 * Runs in workerd only because the entry imports the session classes, and they import `cloudflare:workers`.
 */

const forwarded = (event: unknown): Request =>
  new Request(`https://handlers/event`, {
    method: `POST`,
    body: JSON.stringify(event)
  });

describe(`the handlers entry`, () => {
  it(`answers before the work is done, and hands the work to waitUntil`, async () => {
    // WHY: an answer that waits for the work keeps the bot's request open for as long as the work runs, which is what lost the votes. The work here cannot finish until the test lets it, so only an entry that answers first can answer at all.
    let release = (): void => {};
    const closing = new Promise<null>((resolve) => {
      release = () => {
        resolve(null);
      };
    });
    let started = false;
    const env = {
      DISCORD_BOT_TOKEN: `test`,
      EXAM: {
        idFromName: (name: string) => name,
        get: () => ({
          close: async () => {
            started = true;
            return closing;
          }
        })
      }
    } as unknown as Env;
    const handedOver: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (promise: Promise<unknown>) => {
        handedOver.push(promise);
      }
    } as unknown as ExecutionContext;

    const answer = await Promise.race([
      handlers.fetch(
        forwarded({ type: `EXAM_TIMEOUT`, channelId: `entry-1` }),
        env,
        ctx
      ),
      new Promise<string>((resolve) => {
        setTimeout(() => {
          resolve(`still waiting for the work`);
        }, 1_000);
      })
    ]);

    expect(answer).toBeInstanceOf(Response);
    expect((answer as Response).ok).toBe(true);
    // The work did start, and it is the promise the runtime was asked to keep alive.
    expect(started).toBe(true);
    expect(handedOver).toHaveLength(1);
    release();
    await Promise.all(handedOver);
  });
});

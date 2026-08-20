import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";
import type { InbouBot } from "../worker/bot.js";

/**
 * Does the bot load and run on workerd?
 *
 * These drive a real Durable Object inside the Workers runtime, which is the
 * only way to know the whole module graph — @discordkit/gateway, the client,
 * the alarm scheduler — evaluates there. `nodejs_compat` is deliberately off in
 * wrangler.jsonc.
 *
 * This proves the code RUNS; it does not prove it DEPLOYS. The pool's module
 * resolution is permissive (Vitest needs Node interop), so `node:fs` resolves
 * fine here. `vp run check:bundle` is the other half.
 */

// The pool types `env` from the ambient `Cloudflare.Env`, which wrangler
// generates from wrangler.jsonc. This project doesn't run `wrangler types`, so
// narrow it here rather than commit a generated file.
const botEnv = env as unknown as {
  BOT: DurableObjectNamespace<InbouBot>;
};

const bot = (name: string): DurableObjectStub<InbouBot> =>
  botEnv.BOT.get(botEnv.BOT.idFromName(name));

describe(`inbouBot on workerd`, () => {
  it(`instantiates a Durable Object that imports the Gateway client`, async () => {
    // Reaching a successful RPC response proves the module graph evaluated
    // inside workerd. A Node builtin on the import path would have thrown
    // during module evaluation, before the class could be constructed.
    await expect(bot(`import-probe`).status()).resolves.toEqual({
      state: `idle`,
      sessionId: null
    });
  });

  it(`exposes the Web-standard WebSocket the Gateway relies on`, () => {
    // @discordkit/gateway calls `new WebSocket(url)` with no injected
    // transport, so this global is the entire transport story on workerd.
    expect(typeof WebSocket).toBe(`function`);
  });
});

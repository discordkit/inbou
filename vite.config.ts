import { cloudflare } from "@cloudflare/vite-plugin";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
// `defineConfig` comes from vite-plus rather than `vitest/config`: `run.tasks`
// is a vite-plus extension and does not typecheck under the stock Vitest type.
import { defineConfig } from "vite-plus";

// Shared lint + format rules, so this repo reads the same as the rest of the
// organization's TypeScript.
import { lint, fmt } from "@saeris/configs";

// Hoisted out of the config object: inferring this conditional inline makes
// TypeScript deep-compare the whole literal against `UserConfig`, which blows
// the instantiation depth limit once the shared lint/fmt configs are present.
const plugins =
  process.env.VITEST === undefined
    ? [
        ...cloudflare({
          configPath: `./wrangler.jsonc`,
          auxiliaryWorkers: [{ configPath: `./wrangler.handlers.jsonc` }],
          // Pin the Worker's Vite environment name. Without this the plugin
          // derives it from the wrangler `name`, so renaming the Worker would
          // silently detach any per-environment config keyed on `worker`.
          viteEnvironment: { name: `worker` }
        })
      ]
    : [
        // Vitest 4 moved the Workers pool from `test.poolOptions.workers` to a
        // plugin. Most guides still show the older `defineWorkersConfig` +
        // poolOptions shape, which fails with `Missing "./config" specifier`.
        cloudflareTest({
          wrangler: { configPath: `./wrangler.jsonc` },
          // The bot Worker binds `HANDLERS`, so the pool has to know about the
          // handlers Worker too — otherwise workerd refuses to start with
          // "binding HANDLERS refers to a service ... but no such service is
          // defined". `auxiliaryWorkers` covers dev; this covers tests.
          miniflare: {
            workers: [
              {
                name: `inbou-handlers`,
                modules: true,
                // A stub, not the real handlers Worker: workerd cannot parse
                // TypeScript, and these tests assert the bot Worker loads and
                // its Durable Object constructs — not what the handlers do.
                // Those belong in their own tests against `handleCommand`.
                script: `export default { fetch: () => Response.json({ ok: true }) };`
              }
            ]
          }
        })
      ];

// @ts-expect-error -- TS2321: excessive stack depth. The Cloudflare plugin's
// types are large enough that adding the shared `lint`/`fmt` configs pushes
// comparison against `UserConfig` past the instantiation limit. Each half
// typechecks on its own; only the combination trips it, and the runtime shape
// is correct. Revisit when either package slims its types down.
export default defineConfig({
  test: {
    // The first RPC into a Durable Object pays workerd's cold start plus
    // loading the whole module graph — measured at ~5.1s here, just past
    // Vitest's 5s default. The tests are not slow; the runtime boot is.
    testTimeout: 20_000
  },
  run: {
    tasks: {
      // The Cloudflare plugin runs the Worker and the Durable Object in
      // workerd, so local dev exercises the same runtime as production.
      //
      // Wrapped in `varlock run` so secrets come from `.env` + `.env.schema`:
      // varlock resolves and validates them in Node, then injects them into the
      // dev server, where the plugin surfaces them to the Worker as bindings.
      //
      // NOT `@varlock/cloudflare-integration`'s in-Worker `ENV` import — that
      // needs `nodejs_compat`, which this Worker deliberately does without.
      dev: { command: `varlock run -- vp dev`, cache: false },
      build: { command: `vp build`, cache: true },
      // Vitest proves the code RUNS on workerd; this proves it DEPLOYS. The
      // pool's module resolution is permissive enough (Vitest needs Node
      // interop) that a Node builtin slips through it unnoticed.
      "check:bundle": {
        command: `node scripts/check-bundle.mjs`,
        cache: false
      },
      // Commands live on Discord's side, so registering is a deliberate action
      // rather than something the bot does at boot. Re-run after changing the
      // command list in the script.
      "commands:register": {
        command: `varlock run -- node scripts/register-commands.mjs`,
        cache: false
      }
    }
  },
  lint,
  fmt,
  plugins
});

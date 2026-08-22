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
    : [];

/** The two tests that drive a real Durable Object. */
const WORKERD_TESTS = [
  `src/handlers/__tests__/session.spec.ts`,
  `src/handlers/__tests__/scores.spec.ts`,
  `src/handlers/__tests__/scenarios.spec.ts`,
  `src/__tests__/worker.spec.ts`
];

// Hoisted for the same instantiation-depth reason as `plugins` above: the
// Workers pool plugin's types are large, and inlining them inside the config
// literal pushes the comparison past TypeScript's limit.
const workersProject = {
  test: {
    name: `workers`,
    include: WORKERD_TESTS,
    // The first RPC into a Durable Object pays workerd's cold start plus
    // loading the whole module graph — measured at ~5.1s here, just past
    // Vitest's 5s default. The tests are not slow; the runtime boot is.
    testTimeout: 20_000
  },
  plugins: [
    // Vitest 4 moved the Workers pool from `test.poolOptions.workers` to a
    // plugin. Most guides still show the older `defineWorkersConfig` +
    // poolOptions shape, which fails with `Missing "./config" specifier`.
    cloudflareTest({
      wrangler: { configPath: `./wrangler.jsonc` },
      // The pool runs every test inside ONE Worker, and resolves each Durable
      // Object class against that Worker's entry module. The bot Worker's entry
      // exports `InbouBot` but not `QuizSession`, which lives in the handlers
      // Worker — so without this the session tests fail with "does not export a
      // QuizSession Durable Object".
      //
      // Re-exporting both from one test entry is what lets a single pool reach
      // both Workers' objects. This is a test-harness concern only: in dev and
      // production each Worker declares its own, verified by `wrangler dev`
      // reporting the two namespaces separately.
      main: `./src/testEntry.ts`,
      miniflare: {
        // Named here because the binding lives in wrangler.handlers.jsonc,
        // which the pool does not read — it is configured from wrangler.jsonc
        // above. `useSQLite` mirrors that file's `new_sqlite_classes`
        // migration; without it the class gets the key-value backend and every
        // `ctx.storage.sql` call throws.
        durableObjects: {
          SESSION: { className: `QuizSession`, useSQLite: true }
        },
        // The leaderboard. Same reason as the Durable Object above: the
        // binding is declared in wrangler.handlers.jsonc, which this pool does
        // not read. Miniflare creates the database in memory, so the schema
        // has to be applied by the test itself — see `scores.spec.ts`.
        d1Databases: { SCORES: `inbou-scores-test` },
        // The bot Worker binds `HANDLERS`, so the pool has to know about the
        // handlers Worker too — otherwise workerd refuses to start with
        // "binding HANDLERS refers to a service ... but no such service is
        // defined". `auxiliaryWorkers` covers dev; this covers tests.
        workers: [
          {
            name: `inbou-handlers`,
            modules: true,
            // A stub, not the real handlers Worker: workerd cannot parse
            // TypeScript, and these tests assert the bot Worker loads and its
            // Durable Object constructs — not what the handlers do.
            script: `export default { fetch: () => Response.json({ ok: true }) };`
          }
        ]
      }
    })
  ]
};

// @ts-expect-error -- TS2321: excessive stack depth. The Cloudflare plugin's
// types are large enough that adding the shared `lint`/`fmt` configs pushes
// comparison against `UserConfig` past the instantiation limit. Each half
// typechecks on its own; only the combination trips it, and the runtime shape
// is correct. Revisit when either package slims its types down.
export default defineConfig({
  test: {
    // Two projects, split by what they actually need. Everything the quiz
    // decides — conjugating, scoring, choosing a question, the session rules —
    // is pure and runs in plain Node; only the Durable Objects need workerd,
    // which costs about five seconds to boot.
    //
    // Keeping them apart makes the common case fast, and it is what lets
    // Wallaby watch the pure half. Wallaby instruments files with a `$_$wp`
    // coverage probe and expects it in the same runtime scope, but the Workers
    // pool ships modules across a process boundary into workerd where that
    // global does not exist — so under a single pool every file failed at line
    // 1 with "$_$wp is not defined". Point Wallaby at the `unit` project.
    projects: [
      {
        test: {
          name: `unit`,
          include: [`src/**/__tests__/*.spec.ts`],
          exclude: [`**/node_modules/**`, ...WORKERD_TESTS]
        }
      },
      workersProject
    ]
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
      },
      // Applies the leaderboard schema. Local by default — `--remote` targets
      // the deployed database, which is a deliberate act against live data.
      // The bot runs without this: a missing SCORES binding means no
      // leaderboard, not a broken quiz.
      "scores:migrate": {
        command: `wrangler d1 migrations apply inbou-scores --config wrangler.handlers.jsonc --local`,
        cache: false
      },
      // Rebuilds the committed word corpus from JMdict. Deliberate rather than
      // automatic: it downloads ~14 MB and the output is checked in, so a
      // normal build and CI never touch the network.
      "corpus:build": {
        command: `node scripts/build-corpus.mjs`,
        cache: false
      }
    }
  },
  lint,
  fmt,
  plugins
});

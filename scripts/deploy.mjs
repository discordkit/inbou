#!/usr/bin/env node
/* oxlint-disable no-console */
/**
 * Deploy both Workers, in the order the service binding requires.
 *
 * Run by `bumpy publish` when a version PR merges, and runnable by hand.
 *
 *   varlock run -- node scripts/deploy.mjs
 */
import { execFileSync } from "node:child_process";

const run = (label, command, args) => {
  console.log(`\n▸ ${label}`);
  execFileSync(command, args, {
    stdio: `inherit`,
    shell: process.platform === `win32`
  });
};

// Vite's build, not wrangler's. Wrangler bundles on its own and would apply
// neither the `?raw` SQL import nor the `__BUILD__` define — `/feedback` would
// report `dev` as the build for every report filed against production.
run(`Build both Workers`, `vp`, [`build`]);

// Before the Worker that reads it. Idempotent: applied migrations are skipped.
run(`Apply D1 migrations`, `wrangler`, [
  `d1`,
  `migrations`,
  `apply`,
  `inbou-scores`,
  `--config`,
  `wrangler.handlers.jsonc`,
  `--remote`
]);

// ORDER IS LOAD-BEARING. The bot Worker declares a service binding to
// `inbou-handlers`; deploying it first against a service that does not exist
// yet fails outright. Cloudflare documents this: the target Worker must be
// deployed before the one that binds it.
//
// The generated configs are used rather than the source ones, because those
// are what carry Vite's build output.
run(`Deploy handlers Worker`, `wrangler`, [
  `deploy`,
  `--config`,
  `dist/inbou_handlers/wrangler.json`
]);
run(`Deploy bot Worker`, `wrangler`, [
  `deploy`,
  `--config`,
  `dist/worker/wrangler.json`
]);

// Last, so Discord never offers a command the running code cannot answer.
// Registering first would reopen exactly the `/ping` gap, in production.
//
// `--global` is not optional here. Without it the scope came from whether
// `DISCORD_GUILD_ID` happened to be set wherever this ran, so a deploy from a
// machine holding a dev `.env` published to one server and exited 0 — every
// other guild left with no commands, and nothing anywhere saying so.
run(`Register slash commands`, `node`, [
  `scripts/register-commands.mjs`,
  `--global`
]);

console.log(`\n✓ Deployed.`);

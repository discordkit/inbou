#!/usr/bin/env node
/* oxlint-disable no-console */
/**
 * Deploy both Workers, and put production back if any step fails.
 *
 * Run by `bumpy publish` when a version PR merges, and runnable by hand.
 *
 *   varlock run -- node scripts/deploy.mjs
 *
 * **Why a rollback at all.** The three things that go out together — the
 * schema, the code, and the command list — only work as a set. Code that
 * expects a column D1 does not have is broken; commands Discord offers that
 * the running code cannot answer are broken. A deploy that half-succeeds
 * leaves production in exactly that state, and nothing notices.
 *
 * **What can and cannot be reverted.** `wrangler rollback` restores a Worker
 * version. D1 migrations are not reversible, and Cloudflare is explicit that a
 * rollback leaves connected resources untouched. So migrations must be
 * additive — add tables and columns, never drop or rename — which makes the
 * new schema a superset of the old one, and lets the previous code keep
 * working against it. `migrations.spec.ts` enforces that.
 *
 * Migrations therefore run FIRST, before anything is deployed: if they fail,
 * nothing has shipped and there is nothing to undo.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Resolve a local CLI to its entry script.
 *
 * `wrangler` is not on PATH from a Node child process, and `shell: true` both
 * papers over that and concatenates arguments without escaping them. Running
 * the resolved script under this same Node binary avoids the shell entirely.
 */
const require = createRequire(import.meta.url);
const bin = (pkg, entry) =>
  join(dirname(require.resolve(`${pkg}/package.json`)), entry);

const WRANGLER = bin(`wrangler`, `bin/wrangler.js`);

const node = (script, args, opts = {}) =>
  execFileSync(process.execPath, [script, ...args], {
    stdio: `inherit`,
    ...opts
  });

const run = (label, script, args) => {
  console.log(`
▸ ${label}`);
  node(script, args);
};

/** The version a Worker is serving now, so it can be restored by id. */
const currentVersion = (worker) => {
  const out = execFileSync(
    process.execPath,
    [WRANGLER, `deployments`, `status`, `--name`, worker, `--json`],
    { encoding: `utf8` }
  );
  // Pinned by id rather than relying on `rollback` with no argument, which
  // targets "the version before the latest" — a moving target once this script
  // has itself deployed something.
  const parsed = JSON.parse(out);
  return parsed?.versions?.[0]?.version_id ?? null;
};

/**
 * Put a Worker back, and never throw.
 *
 * This runs while something has already gone wrong. A rollback that failed
 * loudly here would replace the real error with its own, and the real one is
 * what tells you what to fix.
 */
const rollback = (worker, versionId) => {
  if (versionId === null) {
    console.error(`  ! ${worker}: no previous version recorded, left as is.`);
    return;
  }
  try {
    console.error(`  ↩ ${worker} → ${versionId}`);
    node(WRANGLER, [
      `rollback`,
      versionId,
      `--name`,
      worker,
      `--message`,
      `Automatic rollback: a later deploy step failed.`
    ]);
  } catch {
    console.error(
      `  ! ${worker}: rollback failed. Roll back by hand:\n      wrangler rollback ${versionId} --name ${worker}`
    );
  }
};

// Recorded before anything changes. A Worker that does not exist yet has no
// version, which reads as null and means "nothing to go back to" — correct for
// a first deploy, where a failure leaves a Worker that was never live.
const previous = {
  "inbou-handlers": null,
  inbou: null
};
for (const worker of Object.keys(previous)) {
  try {
    previous[worker] = currentVersion(worker);
  } catch {
    console.log(`  (${worker} is new — no version to roll back to)`);
  }
}

const deployed = [];

try {
  // Vite's build, not wrangler's. Wrangler bundles on its own and would apply
  // neither the `?raw` SQL import nor the `__BUILD__` define — `/feedback` would
  // report `dev` as the build for every report filed against production.
  run(`Build both Workers`, bin(`vite-plus`, `bin/vp`), [`build`]);

  // Before anything is deployed, so a failure here has shipped nothing.
  // Additive by rule, so the previous code still works against the result.
  run(`Apply D1 migrations`, WRANGLER, [
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
  run(`Deploy handlers Worker`, WRANGLER, [
    `deploy`,
    `--config`,
    `dist/inbou_handlers/wrangler.json`
  ]);
  deployed.push(`inbou-handlers`);

  run(`Deploy bot Worker`, WRANGLER, [
    `deploy`,
    `--config`,
    `dist/worker/wrangler.json`
  ]);
  deployed.push(`inbou`);

  // Last, so Discord never offers a command the running code cannot answer.
  // Registering first would reopen exactly the `/ping` gap, in production.
  //
  // `--global` is not optional here. Without it the scope came from whether
  // `DISCORD_GUILD_ID` happened to be set wherever this ran, so a deploy from a
  // machine holding a dev `.env` published to one server and exited 0 — every
  // other guild left with no commands, and nothing anywhere saying so.
  run(`Register slash commands`, `scripts/register-commands.mjs`, [`--global`]);
} catch (error) {
  console.error(`\n✗ Deploy failed: ${error.message}`);

  if (deployed.length === 0) {
    console.error(`  Nothing was deployed, so nothing to undo.`);
  } else {
    // Reverse order, mirroring the deploy: the bot binds the handlers, so the
    // dependent one goes back first.
    console.error(`\n▸ Rolling back`);
    for (const worker of [...deployed].reverse()) {
      rollback(worker, previous[worker]);
    }
    console.error(
      `\n  The schema was migrated and stays migrated — migrations are additive,\n  so the restored code works against it.`
    );
  }

  process.exitCode = 1;
  throw error;
}

console.log(`\n✓ Deployed.`);

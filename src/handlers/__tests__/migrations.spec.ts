import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Migrations must be additive, because a rollback cannot undo them.
 *
 * `wrangler rollback` restores a Worker version and leaves connected resources
 * alone — Cloudflare says so outright. So after a failed deploy the previous
 * code runs against the *new* schema, and that only works if the new schema is
 * a superset of the old one.
 *
 * Dropping or renaming breaks that, and it breaks it at the worst moment: the
 * rollback path, which by definition runs when something has already gone
 * wrong. This is the check that keeps `scripts/deploy.mjs`'s promise true.
 */

const DIR = `migrations`;

const migrations = readdirSync(DIR)
  .filter((name) => name.endsWith(`.sql`))
  .map((name) => ({
    name,
    // Comments explain the schema and mention words like "drop" freely; only
    // statements matter.
    sql: readFileSync(`${DIR}/${name}`, `utf8`).replace(/--.*$/gmu, ``)
  }));

/** Statements that remove or repurpose something the old code may still read. */
const DESTRUCTIVE = [
  { pattern: /\bDROP\s+TABLE\b/iu, what: `DROP TABLE` },
  { pattern: /\bDROP\s+COLUMN\b/iu, what: `DROP COLUMN` },
  { pattern: /\bRENAME\s+TO\b/iu, what: `RENAME TO` },
  { pattern: /\bRENAME\s+COLUMN\b/iu, what: `RENAME COLUMN` },
  // A type change rewrites existing values; the previous code may not be able
  // to read what comes back.
  { pattern: /\bALTER\s+COLUMN\b/iu, what: `ALTER COLUMN` }
];

describe(`the committed migrations`, () => {
  it(`has at least one, so this suite cannot pass vacuously`, () => {
    expect(migrations.length).toBeGreaterThan(0);
  });

  it.each(migrations.map((m) => m.name))(`%s is additive`, (name) => {
    // WHY: the deploy rolls Workers back but leaves the schema migrated. A
    // destructive migration turns that recovery into a second outage — the
    // restored code meeting a table or column that is no longer there.
    const migration = migrations.find((m) => m.name === name);
    const found = DESTRUCTIVE.filter((rule) =>
      rule.pattern.test(migration?.sql ?? ``)
    ).map((rule) => rule.what);

    expect(found).toEqual([]);
  });

  it(`creates tables only if they are absent`, () => {
    // WHY: migrations are applied by a deploy that may be retried after a
    // failure later in the sequence. A bare CREATE TABLE fails the second time
    // and takes the whole deploy with it.
    for (const migration of migrations) {
      const creates = [...migration.sql.matchAll(/\bCREATE\s+TABLE\b/giu)];
      const guarded = [
        ...migration.sql.matchAll(/\bCREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/giu)
      ];
      expect({ file: migration.name, creates: creates.length }).toEqual({
        file: migration.name,
        creates: guarded.length
      });
    }
  });
});

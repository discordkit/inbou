import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The privacy policy has to describe what is actually stored.
 *
 * It is the kind of document that rots quietly: add a column, and the policy
 * becomes an untrue statement about personal data rather than merely a stale
 * one. Nothing else would notice.
 *
 * The migrations are machine-readable and so is the policy, so they can be
 * held together — the same trick `commands.spec.ts` uses on the registration
 * script.
 */

const POLICY = readFileSync(`docs/PRIVACY.md`, `utf8`);

/** Every table and column the committed migrations create. */
const stored = (): { tables: string[]; columns: string[] } => {
  const tables: string[] = [];
  const columns: string[] = [];

  for (const file of readdirSync(`migrations`).filter((n) =>
    n.endsWith(`.sql`)
  )) {
    const sql = readFileSync(`migrations/${file}`, `utf8`).replace(
      /--.*$/gmu,
      ``
    );
    for (const match of sql.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?<table>\w+)\s*\((?<body>[^;]*)\)/giu
    )) {
      const table = match.groups?.table ?? ``;
      tables.push(table);
      for (const line of (match.groups?.body ?? ``).split(`,`)) {
        const column = /^\s*(?<name>\w+)\s+(TEXT|INTEGER)/iu.exec(line)?.groups
          ?.name;
        // Composite key declarations are not columns.
        if (column !== undefined && column.toUpperCase() !== `PRIMARY`) {
          columns.push(column);
        }
      }
    }

    // Columns added later, which is how a schema actually grows — and the
    // case this check exists for. Missing it made the whole test vacuous
    // against the most likely change.
    for (const match of sql.matchAll(
      /ALTER\s+TABLE\s+\w+\s+ADD\s+(?:COLUMN\s+)?(?<name>\w+)\s+(TEXT|INTEGER)/giu
    )) {
      const column = match.groups?.name;
      if (column !== undefined) columns.push(column);
    }
  }
  return { tables, columns };
};

/** How a column reads in prose: `last_played` -> "last played". */
const asProse = (column: string): string => column.replace(/_/gu, ` `);

describe(`the privacy policy against what is stored`, () => {
  it(`finds the migrations, so this cannot pass vacuously`, () => {
    const { tables, columns } = stored();
    expect(tables).toContain(`scores`);
    expect(columns.length).toBeGreaterThan(4);
  });

  it(`accounts for every stored column`, () => {
    // WHY: a column added without a line in the policy makes the policy an
    // untrue statement about somebody's data. The policy may word it however
    // reads best — "User ID" for `user_id` — so this matches on the words
    // rather than the identifier.
    const { columns } = stored();
    const text = POLICY.toLowerCase();

    const undocumented = [...new Set(columns)].filter(
      (column) =>
        !text.includes(asProse(column).toLowerCase()) &&
        !text.includes(column.toLowerCase())
    );

    expect(undocumented).toEqual([]);
  });

  it(`names every command that controls the data`, () => {
    // WHY: the policy promises these exist. A renamed command would leave
    // somebody following instructions that do nothing.
    const script = readFileSync(`scripts/register-commands.mjs`, `utf8`);
    expect(script).toContain(`name: \`privacy\``);

    for (const promised of [
      `/privacy tracking`,
      `/privacy forget`,
      `scope:everywhere`
    ]) {
      expect(POLICY).toContain(promised);
    }
  });

  it(`admits the one thing forget cannot reach`, () => {
    // WHY: `/feedback` publishes a user id to a public GitHub issue, and the
    // bot cannot retract it. A policy claiming complete erasure without that
    // caveat would be false, and it is the kind of exception that gets dropped
    // in an edit.
    expect(POLICY).toContain(`/feedback`);
    expect(POLICY.toLowerCase()).toContain(`cannot retract`);
  });
});

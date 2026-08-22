import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OPTION_HELP } from "../quiz/config.js";

/**
 * Keeping the registered command options in step with the schemas.
 *
 * `scripts/register-commands.mjs` spells out each option's description rather
 * than importing {@link OPTION_HELP}, because plain Node cannot resolve the
 * `.js` specifiers the app uses — importing it would make the script fail when
 * run while still typechecking cleanly. That leaves the description in two
 * places, so something has to notice when they drift.
 *
 * The script is read as text rather than imported: it throws on missing
 * credentials at module scope and then talks to Discord, neither of which
 * belongs in a unit test.
 */

const script = readFileSync(
  fileURLToPath(
    new URL(`../../../scripts/register-commands.mjs`, import.meta.url)
  ),
  `utf8`
);

/** The `settingOptions` array, as name -> description. */
const registered = (): Record<string, string> => {
  const block = /const settingOptions = \[(.*?)^\];/msu.exec(script)?.[1] ?? ``;
  const found: Record<string, string> = {};
  for (const match of block.matchAll(
    /name: `(?<name>[^`]+)`,\s*description: `(?<description>[^`]+)`/gu
  )) {
    const { name, description } = match.groups ?? {};
    if (name !== undefined && description !== undefined)
      found[name] = description;
  }
  return found;
};

describe(`the options registered with Discord`, () => {
  it(`covers exactly the options the parser understands`, () => {
    // WHY: an option registered but not parsed is silently ignored when
    // someone uses it; an option parsed but not registered cannot be typed at
    // all, because Discord rejects names it does not know. Either way the
    // mismatch only shows up in the channel.
    expect(Object.keys(registered()).sort()).toEqual(
      Object.keys(OPTION_HELP).sort()
    );
  });

  it(`describes each option the way the schema does`, () => {
    // WHY: this is the duplication the script's comment admits to. The two
    // texts are written for the same reader and must say the same thing — a
    // description promising "1-50" beside a schema enforcing 1-20 sends people
    // to a value the bot then rejects.
    const drifted = Object.entries(registered()).filter(
      ([name, description]) => {
        const help = OPTION_HELP[name as keyof typeof OPTION_HELP];
        // Compared on the values named rather than character for character: the
        // script writes "1-50" where the schema writes "1 to 50", and Discord
        // caps a description at 100 characters so the longer ones are trimmed.
        return numbersIn(description) !== numbersIn(help);
      }
    );
    expect(drifted).toEqual([]);
  });

  it(`stays inside Discord's 100 character description limit`, () => {
    // WHY: Discord rejects the whole registration payload over the limit, so
    // one long description takes every command down with it — and the failure
    // happens at deploy time, away from the change that caused it.
    const tooLong = Object.entries(registered())
      .filter(([, description]) => description.length > 100)
      .map(([name]) => name);
    expect(tooLong).toEqual([]);
  });
});

/** The numbers a description names, which is the part that must agree. */
const numbersIn = (text: string): string =>
  (text.match(/\d+/gu) ?? []).join(`,`);

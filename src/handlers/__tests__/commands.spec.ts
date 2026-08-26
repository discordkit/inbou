import { readFileSync } from "node:fs";
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

// Resolved from the repo root rather than from `import.meta.url`: the project
// types the Workers runtime, whose `URL` is not Node's, so `fileURLToPath`
// rejects it. Vitest runs with the root as its working directory.
const script = readFileSync(`scripts/register-commands.mjs`, `utf8`);

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

  it(`registers only commands the handler actually routes`, () => {
    // WHY: a registered command with no handler is offered by Discord and then
    // answers "I do not have a handler for that yet" — a visible fault nothing
    // else catches. `/ping` shipped that way. The checks above compare option
    // descriptions, which cannot see a whole command going unrouted.
    const handler = readFileSync(`src/handlers/commands.ts`, `utf8`);
    const routed = new Set(
      [...handler.matchAll(/name === `(?<name>[a-z]+)`/gu)].map(
        (match) => match.groups?.name ?? ``
      )
    );

    // Top-level entries only — a subcommand is nested inside one of these, and
    // the router reaches those through `invocation.subcommand`. Matched by
    // indentation, with `\r?` because the file is checked out with CRLF here.
    const registered = [
      ...script.matchAll(/^ {2}\{\r?\n {4}name: `(?<name>[a-z]+)`/gmu)
    ].map((match) => match.groups?.name ?? ``);

    expect(registered.length).toBeGreaterThan(0);
    expect(registered.filter((name) => !routed.has(name))).toEqual([]);
  });
});

describe(`what a deploy publishes`, () => {
  const deploy = readFileSync(`scripts/deploy.mjs`, `utf8`);

  it(`registers globally, not to whichever guild the environment names`, () => {
    // WHY: the scope used to come from whether DISCORD_GUILD_ID happened to be
    // set wherever the deploy ran. A release from a machine holding a dev
    // `.env` published to one server, exited 0, and left every other guild
    // with no commands — succeeding loudly while failing completely.
    const call = /register-commands\.mjs`[^)]*\)/su.exec(deploy)?.[0] ?? ``;

    expect(call).not.toBe(``);
    expect(call).toContain(`--global`);
  });

  it(`cannot be redirected by DISCORD_GUILD_ID`, () => {
    // WHY: the closing check the bug report asks for. `--global` has to win
    // over the environment inside the script, not merely be passed to it.
    expect(script).toContain(`forceGlobal`);
    expect(script).toMatch(/guild && !forceGlobal/u);
  });
});

/** The numbers a description names, which is the part that must agree. */
const numbersIn = (text: string): string =>
  (text.match(/\d+/gu) ?? []).join(`,`);

import { describe, expect, it } from "vitest";
import { readCustomId, readOptions } from "../quiz/options.js";

describe(`readOptions: unwrapping a slash command`, () => {
  it(`finds options nested under a subcommand`, () => {
    // WHY: Discord nests them — `/quiz start level:N5` arrives as an option
    // named `start` whose own options hold `level`. Reading the top level would
    // find nothing and silently run with defaults, ignoring everything the
    // player typed.
    const invocation = readOptions([
      {
        name: `start`,
        options: [
          { name: `level`, value: `N5,N4` },
          { name: `length`, value: 20 }
        ]
      }
    ]);

    expect(invocation.subcommand).toBe(`start`);
    // Destructured because `options.length` reads as an array length to both
    // TypeScript and the lint autofixer, which rewrites the assertion into
    // `toHaveLength` and then rejects the string.
    const { level, length } = invocation.options;
    expect(level).toBe(`N5,N4`);
    // Numbers become strings: parseSettings does the real validation, and two
    // paths into it would drift apart.
    expect(length).toBe(`20`);
  });

  it(`reads options from a command with no subcommand`, () => {
    // WHY: `/hint` takes no subcommand, so its options — if it ever gains any —
    // sit at the top level.
    const invocation = readOptions([{ name: `timeout`, value: `90s` }]);

    expect(invocation.subcommand).toBeUndefined();
    expect(invocation.options.timeout).toBe(`90s`);
  });

  it(`reports a bare subcommand with no options`, () => {
    // WHY: `/quiz end` is the common case. The handler needs the name; there is
    // nothing else to read.
    const invocation = readOptions([{ name: `end` }]);

    expect(invocation.subcommand).toBe(`end`);
    expect(invocation.options).toEqual({});
  });

  it(`handles a command with no options at all`, () => {
    expect(readOptions(undefined)).toEqual({ options: {} });
    expect(readOptions([])).toEqual({ options: {} });
  });

  it(`ignores an option the quiz does not understand`, () => {
    // WHY: Discord validates names against the registered set, so an unexpected
    // one means the registration and this code have drifted. Running with
    // defaults is better than refusing the command over it.
    const invocation = readOptions([
      { name: `start`, options: [{ name: `mystery`, value: `x` }] }
    ]);

    expect(invocation.options).toEqual({});
  });
});

describe(`validating what Discord actually sent`, () => {
  it(`falls back to no options when the payload is the wrong shape`, () => {
    // WHY: this is the one place the bot reads data it did not build. A cast
    // would compile against a drifted payload and then read `undefined` from
    // it, which surfaces as a command quietly running with defaults and no way
    // to tell that is what happened. Validating makes the fallback deliberate.
    expect(readOptions(`not an array`)).toEqual({ options: {} });
    expect(readOptions([{ notAnOption: true }])).toEqual({ options: {} });
    expect(readOptions(null)).toEqual({ options: {} });
  });

  it(`reads a component's custom id, and only a component's`, () => {
    // WHY: `interaction.data` is a union — a command carries `name`, a
    // component carries `customId`. Reading one arm without checking is how a
    // button silently routes nowhere while the player sees "this interaction
    // failed".
    expect(readCustomId({ customId: `quiz:hint` })).toBe(`quiz:hint`);
    expect(readCustomId({ name: `quiz`, options: [] })).toBeNull();
    expect(readCustomId(undefined)).toBeNull();
  });
});

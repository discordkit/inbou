import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, isSettings, parseSettings } from "../quiz/config.js";

/** Parse and assert it succeeded, so tests read as the settings they produce. */
const parse = (raw: Parameters<typeof parseSettings>[0]) => {
  const result = parseSettings(raw);
  if (!isSettings(result)) throw new Error(JSON.stringify(result.errors));
  return result;
};

/** Parse and assert it failed, returning the errors. */
const failures = (raw: Parameters<typeof parseSettings>[0]) => {
  const result = parseSettings(raw);
  if (isSettings(result)) throw new Error(`expected errors`);
  return result.errors;
};

describe(`defaults`, () => {
  it(`starts at N5 with nouns left out`, () => {
    // WHY: the club practises N5, and `/quiz start` with no arguments is the
    // common case. Nouns only conjugate the copula, so including them by
    // default would fill a beginner session with 犬だ / 犬でした.
    expect(DEFAULT_SETTINGS.filters.levels).toEqual([5]);
    expect(DEFAULT_SETTINGS.filters.types).not.toContain(`noun`);
    expect(DEFAULT_SETTINGS.filters.types).toContain(`verb`);
  });

  it(`asks only the basics until told otherwise`, () => {
    // WHY: causative-passive on question one would put a beginner off. The
    // harder forms are opt-in via `forms:all`.
    expect(DEFAULT_SETTINGS.filters.forms).toHaveLength(4);
    expect(DEFAULT_SETTINGS.filters.forms).toContain(`past-negative`);
    expect(DEFAULT_SETTINGS.filters.forms).not.toContain(`causative-passive`);
  });

  it(`keeps unmentioned options unchanged`, () => {
    // WHY: `/quiz config timeout:90s` mid-session must not silently reset the
    // level and word types the channel chose earlier.
    const settings = parse({ timeout: `90s` });
    expect(settings.session.timeoutMs).toBe(90_000);
    expect(settings.filters.levels).toEqual(DEFAULT_SETTINGS.filters.levels);
    expect(settings.filters.types).toEqual(DEFAULT_SETTINGS.filters.types);
  });
});

describe(`levels`, () => {
  it(`accepts levels with or without the N`, () => {
    // WHY: people write both. Rejecting `5` because it lacks an N would be
    // pedantry that costs someone a retype mid-conversation.
    expect(parse({ level: `N5` }).filters.levels).toEqual([5]);
    expect(parse({ level: `5` }).filters.levels).toEqual([5]);
    expect(parse({ level: `n5, N4` }).filters.levels).toEqual([5, 4]);
  });

  it(`treats "any" as no level filter`, () => {
    // WHY: 4,044 corpus words carry no JLPT level. An empty filter is how they
    // become reachable, and `any` is how a player asks for that.
    expect(parse({ level: `any` }).filters.levels).toEqual([]);
  });

  it(`rejects a level that does not exist`, () => {
    const [error] = failures({ level: `N7` });
    expect(error?.option).toBe(`level`);
    expect(error?.message).toContain(`N7`);
  });
});

describe(`verb classes`, () => {
  it(`expands "godan" to every godan row`, () => {
    // WHY: someone asking for godan practice means all nine rows. Making them
    // name each consonant would be a worse experience than accepting the
    // shorthand, and naming one row by mistake would silently narrow the pool
    // to a handful of words.
    const classes = parse({ class: `godan` }).filters.classes;
    expect(classes).toContain(`godan-u`);
    expect(classes).toContain(`godan-r`);
    expect(classes).toContain(`godan-iku`);
    expect(classes).not.toContain(`ichidan`);
  });

  it(`expands "irregular" to both irregular verbs`, () => {
    expect(parse({ class: `irregular` }).filters.classes).toEqual([
      `irregular-suru`,
      `irregular-kuru`
    ]);
  });

  it(`rejects an unknown class`, () => {
    expect(failures({ class: `nidan` })[0]?.option).toBe(`class`);
  });
});

describe(`forms`, () => {
  it(`expands "basics" to the four tense-polarity forms`, () => {
    expect(parse({ forms: `basics` }).filters.forms).toHaveLength(4);
  });

  it(`treats "all" as no form filter`, () => {
    // WHY: an empty filter means every form the word supports, which differs
    // per word type — listing all thirteen would ask な-adjectives for a
    // passive they do not have.
    expect(parse({ forms: `all` }).filters.forms).toEqual([]);
  });

  it(`accepts individual forms by name`, () => {
    expect(parse({ forms: `te-form, potential` }).filters.forms).toEqual([
      `te-form`,
      `potential`
    ]);
  });

  it(`rejects a form that does not exist`, () => {
    const [error] = failures({ forms: `gerund` });
    expect(error?.message).toContain(`gerund`);
  });
});

describe(`length`, () => {
  it(`accepts a question count`, () => {
    expect(parse({ length: `20` }).session).toHaveLength(20);
  });

  it(`accepts endless`, () => {
    // WHY: null is what the machine reads as endless, and it is the value that
    // switches the ending condition from a count to consecutive timeouts.
    expect(parse({ length: `endless` }).session.length).toBeNull();
  });

  it(`rejects a length that would hold the channel hostage`, () => {
    // WHY: a session is a shared activity. `endless` already covers "keep
    // going", so an unbounded number is a mistake rather than an intent.
    expect(failures({ length: `500` })[0]?.option).toBe(`length`);
    expect(failures({ length: `0` })[0]?.option).toBe(`length`);
    expect(failures({ length: `ten` })[0]?.option).toBe(`length`);
  });
});

describe(`timeout`, () => {
  it(`reads durations the way people write them`, () => {
    expect(parse({ timeout: `90s` }).session.timeoutMs).toBe(90_000);
    expect(parse({ timeout: `2m` }).session.timeoutMs).toBe(120_000);
    // A bare number is seconds, which is what someone typing `45` means.
    expect(parse({ timeout: `45` }).session.timeoutMs).toBe(45_000);
  });

  it(`rejects a timeout nobody could answer within`, () => {
    // WHY: under thirty seconds is not a race, it is a formality — nobody can
    // read a prompt and type a conjugation in time, so every question would
    // time out.
    expect(failures({ timeout: `5s` })[0]?.option).toBe(`timeout`);
    expect(failures({ timeout: `1h` })[0]?.option).toBe(`timeout`);
  });
});

describe(`reporting mistakes`, () => {
  it(`reports every bad option, not just the first`, () => {
    // WHY: a player who mistyped two options should fix both in one go rather
    // than discovering the second after correcting the first.
    const errors = failures({ level: `N9`, class: `nidan`, length: `many` });
    expect(errors.map((e) => e.option).sort()).toEqual([
      `class`,
      `length`,
      `level`
    ]);
  });

  it(`quotes what was typed so the message is actionable`, () => {
    // WHY: "invalid level" tells someone nothing. Naming their input and the
    // allowed values is the difference between a fix and a guess.
    const [error] = failures({ level: `N9` });
    expect(error?.message).toContain(`N9`);
    expect(error?.message).toContain(`N5`);
  });
});

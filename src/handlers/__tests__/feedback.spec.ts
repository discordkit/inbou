import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contextBlock, feedbackUrl } from "../feedback.js";

/**
 * The pre-filled issue link.
 *
 * Two things can break silently here. A query parameter that does not match a
 * field `id` in the committed issue form is simply ignored by GitHub — the form
 * opens blank and nobody finds out until a report arrives with no context. And
 * a URL past GitHub's limit returns 414, which reaches the user as a dead link.
 */

const context = {
  userId: `962800000000000000`,
  guildId: `111`,
  channelId: `222`,
  locale: `ja`,
  session: {
    length: 10,
    timeoutMs: 60_000,
    guesses: 3,
    levels: [5],
    forms: [`non-past-negative`]
  }
};

/** The field ids the forms actually declare, read from the committed YAML. */
const fieldIds = (template: string): string[] =>
  [
    ...readFileSync(`.github/ISSUE_TEMPLATE/${template}`, `utf8`).matchAll(
      /^\s*id:\s*(\S+)/gmu
    )
  ].map((match) => match[1] ?? ``);

describe(`the pre-filled issue URL`, () => {
  it.each([
    [`bug` as const, `bug.yml`],
    [`idea` as const, `idea.yml`]
  ])(`names only fields the %s form declares`, (kind, template) => {
    // WHY: GitHub matches a query parameter to a form field by its `id`, and
    // silently ignores anything else. Renaming a field in the YAML would leave
    // the form opening blank with no error anywhere.
    const url = new URL(feedbackUrl(kind, `it broke`, context));
    const declared = new Set(fieldIds(template));

    const prefilled = [...url.searchParams.keys()].filter(
      (key) => ![`template`, `labels`].includes(key)
    );
    expect(prefilled.length).toBeGreaterThan(0);
    for (const key of prefilled) {
      expect(declared.has(key)).toBe(true);
    }
  });

  it(`points at the template that matches the kind`, () => {
    expect(feedbackUrl(`bug`, `x`, context)).toContain(`template=bug.yml`);
    expect(feedbackUrl(`idea`, `x`, context)).toContain(`template=idea.yml`);
  });

  it(`carries what the user typed`, () => {
    const url = new URL(
      feedbackUrl(`bug`, `answers in kanji rejected`, context)
    );
    expect(url.searchParams.get(`what`)).toBe(`answers in kanji rejected`);
  });

  it(`drops the summary rather than returning a URL GitHub will refuse`, () => {
    // WHY: GitHub answers 414 past its limit, which reaches the user as a dead
    // link. The summary is the only part that can grow without bound, and an
    // issue with context and no description still beats a broken link.
    const url = feedbackUrl(`bug`, `x`.repeat(20_000), context);

    expect(url.length).toBeLessThan(6000);
    expect(url).toContain(`context=`);
  });
});

describe(`the context block`, () => {
  it(`names the build, so a report can be placed`, () => {
    // WHY: nobody reporting a bug knows which commit the bot is running, and
    // without it "this used to work" is unanswerable.
    expect(contextBlock(context)).toContain(`Build:`);
  });

  it(`reports the session settings a report depends on`, () => {
    // WHY: "the timer felt too short" is a different report at 30s than at 2m.
    const block = contextBlock(context);

    expect(block).toContain(`60s`);
    expect(block).toContain(`3 guesses`);
    expect(block).toContain(`N5`);
  });

  it(`says so plainly when no session is running`, () => {
    // WHY: an empty settings line would read as missing data rather than as
    // the report having been filed outside a game.
    expect(contextBlock({ ...context, session: null })).toContain(
      `none running`
    );
  });

  it(`marks a direct message rather than leaving the server blank`, () => {
    expect(contextBlock({ ...context, guildId: null })).toContain(
      `direct message`
    );
  });
});

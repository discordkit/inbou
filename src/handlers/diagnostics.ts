import { createConsoleReporter, defineDiagnostics } from "nostics";

/**
 * Stable codes for the things that can actually go wrong.
 *
 * Everything the quiz *decides* is pure and cannot fail: a word either
 * conjugates or it does not, and that is a fact rather than an error. What can
 * fail is the edge — talking to Discord, being told a session exists when it
 * does not, a corpus that disagrees with the code that reads it.
 *
 * Those failures end up in a log somewhere, read later by someone who was not
 * present when it happened. A thrown string tells them nothing; a code they can
 * search for, with a stated cause and a stated fix, tells them what to do. That
 * is what nostics provides, and why it appears here rather than in the pure
 * layers.
 *
 * Only the core is imported. `nostics/reporters/node` reads `node:fs`, which
 * the bare Workers runtime cannot provide — `vp run check:bundle` would fail
 * the build if it were ever pulled in.
 */
export const diagnostics = defineDiagnostics({
  docsBase: (code) =>
    `https://github.com/discordkit/inbou/blob/main/docs/specs/conjugation-quiz.md#${code.toLowerCase()}`,
  reporters: [createConsoleReporter()],
  codes: {
    /**
     * A REST call to Discord failed.
     *
     * The single most likely runtime failure, and the one whose cause is least
     * visible from a stack trace: a 403 is a missing permission, a 429 is rate
     * limiting, and they need different responses.
     */
    DISCORD_REQUEST_FAILED: {
      why: (p: { action: string; status?: number; detail?: string }) =>
        `Discord rejected ${p.action}${p.status === undefined ? `` : ` with ${String(p.status)}`}${p.detail === undefined ? `` : `: ${p.detail}`}.`,
      fix: (p: { action: string; status?: number; detail?: string }) =>
        p.status === 403
          ? `Check the bot's permissions in that channel — posting embeds and adding reactions are separate grants.`
          : p.status === 429
            ? `The bot is being rate limited. Slow the question cadence or reduce how many reactions it adds.`
            : `Check the bot token and that the channel still exists.`
    },

    /**
     * A question was asked for, but the filters matched nothing.
     *
     * Reported rather than thrown: it is a configuration mistake the channel
     * can fix, and the player gets a message telling them how. Logged too,
     * because a filter combination nobody can satisfy is worth knowing about.
     */
    NO_WORDS_FOR_FILTERS: {
      why: (p: { levels: string; types: string }) =>
        `No corpus words match levels [${p.levels}] and types [${p.types}].`,
      fix: (_p: { levels: string; types: string }) =>
        `Widen the filters. Some combinations are genuinely empty — N4 with ぬ-verbs has no words, and adjectives have no verb class at all.`
    },

    /**
     * The corpus produced a word the conjugator cannot inflect.
     *
     * Should be impossible: `corpus.spec.ts` checks every entry against the
     * real conjugator on each CI run. If this ever fires, the committed corpus
     * and the code that reads it have drifted apart.
     */
    CORPUS_INCONSISTENT: {
      why: (p: { wordId: string; pos: string }) =>
        `Corpus word ${p.wordId} (${p.pos}) produced no conjugation table.`,
      fix: (_p: { wordId: string; pos: string }) =>
        `Rebuild with \`vp run corpus:build\` and check corpus.spec.ts — a passing suite means this cannot happen, so the committed corpus is stale.`
    },

    /**
     * A leaderboard read or write failed.
     *
     * Reported rather than thrown, and deliberately not fatal: the leaderboard
     * is a record of play, not part of it. A session whose scores fail to save
     * has still been played, and taking the round down over a database write
     * would lose the thing people actually came for.
     */
    SCORES_UNAVAILABLE: {
      why: (p: { action: string; detail?: string }) =>
        `The score store could not ${p.action}${p.detail === undefined ? `` : `: ${p.detail}`}.`,
      fix: (_p: { action: string; detail?: string }) =>
        `Check the D1 binding named SCORES exists in wrangler.handlers.jsonc and that migrations have been applied with \`vp run scores:migrate\`.`
    },

    /**
     * An interaction arrived that the bot does not model.
     *
     * Almost always means the registered command list and the handler have
     * drifted, which is invisible until someone uses the command.
     */
    UNKNOWN_INTERACTION: {
      why: (p: { name: string }) => `No handler for interaction \`${p.name}\`.`,
      fix: (_p: { name: string }) =>
        `Re-run \`vp run commands:register\`, or add a case for it in commands.ts. The registered list is replaced wholesale, so a removed command disappears.`
    }
  }
});

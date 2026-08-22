import { createConsoleReporter, defineDiagnostics } from "nostics";

/**
 * Stable codes for the things that can actually go wrong.
 *
 * Only the edge fails — Discord, storage, a corpus that disagrees with the code
 * reading it. These are read later by somebody who was not there, so each
 * carries a searchable code, a cause and a fix.
 *
 * Only the core is imported: `nostics/reporters/node` reads `node:fs`, which
 * the bare Workers runtime cannot provide.
 */
export const diagnostics = defineDiagnostics({
  docsBase: (code) =>
    `https://github.com/discordkit/inbou/blob/main/docs/specs/conjugation-quiz.md#${code.toLowerCase()}`,
  reporters: [createConsoleReporter()],
  codes: {
    /** A 403 is a missing permission and a 429 is rate limiting; they differ. */
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

    /** The filters matched nothing — a mistake the channel can fix. */
    NO_WORDS_FOR_FILTERS: {
      why: (p: { levels: string; types: string }) =>
        `No corpus words match levels [${p.levels}] and types [${p.types}].`,
      fix: (_p: { levels: string; types: string }) =>
        `Widen the filters. Some combinations are genuinely empty — N4 with ぬ-verbs has no words, and adjectives have no verb class at all.`
    },

    /** Should be impossible: `corpus.spec.ts` checks every entry on each run. */
    CORPUS_INCONSISTENT: {
      why: (p: { wordId: string; pos: string }) =>
        `Corpus word ${p.wordId} (${p.pos}) produced no conjugation table.`,
      fix: (_p: { wordId: string; pos: string }) =>
        `Rebuild with \`vp run corpus:build\` and check corpus.spec.ts — a passing suite means this cannot happen, so the committed corpus is stale.`
    },

    /** Never fatal: the leaderboard is a record of play, not part of it. */
    SCORES_UNAVAILABLE: {
      why: (p: { action: string; detail?: string }) =>
        `The score store could not ${p.action}${p.detail === undefined ? `` : `: ${p.detail}`}.`,
      fix: (_p: { action: string; detail?: string }) =>
        `Check the D1 binding named SCORES exists in wrangler.handlers.jsonc and that migrations have been applied with \`vp run scores:migrate\`.`
    },

    /** Almost always means the registered commands and the handler have drifted. */
    UNKNOWN_INTERACTION: {
      why: (p: { name: string }) => `No handler for interaction \`${p.name}\`.`,
      fix: (_p: { name: string }) =>
        `Re-run \`vp run commands:register\`, or add a case for it in commands.ts. The registered list is replaced wholesale, so a removed command disappears.`
    }
  }
});

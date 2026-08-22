import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
// Inlined at build time by Vite. workerd has no filesystem, so the migration
// cannot be read at run time — and reading it is the point: a test that wrote
// its own CREATE TABLE would keep passing after the real migration drifted.
import schema from "../../../migrations/0001_scores.sql?raw";
import { d1Scores } from "../scores.js";

/**
 * The leaderboard against a real database.
 *
 * The flow tests prove *when* a session is recorded, using a stub. These prove
 * the SQL actually does what those tests assume — that a second session adds to
 * the first rather than replacing it, and that two guilds never see each
 * other's numbers.
 *
 * The schema comes from the migration file rather than being written out again
 * here. A test that creates its own table would keep passing after the real
 * migration drifted from it, which is the one failure this file exists to
 * catch.
 */

const scoresEnv = env as unknown as { SCORES: D1Database };

const db = () => scoresEnv.SCORES;
const store = () => d1Scores(db());

describe(`the leaderboard, against a real database`, () => {
  beforeEach(async () => {
    await db().exec(/* sql */ `DROP TABLE IF EXISTS scores`);
    // `exec` takes one statement at a time, and the migration is several.
    for (const statement of schema
      .split(`;`)
      .map((statement: string) => statement.replace(/^\s*--.*$/gmu, ``).trim())
      .filter((statement: string) => statement !== ``)) {
      await db().exec(statement.replace(/\s+/gu, ` `));
    }
  });

  describe(`recording a finished session`, () => {
    it(`adds to what a player already had rather than replacing it`, async () => {
      // WHY: this is the difference between a leaderboard and a scoreboard for
      // the most recent game. An INSERT that overwrote would look correct after
      // one session and silently lose every earlier one.
      const scores = store();
      await scores.record(`g1`, [{ userId: `u1`, points: 5, correct: 2 }]);
      await scores.record(`g1`, [{ userId: `u1`, points: 3, correct: 1 }]);

      await expect(scores.forUser(`g1`, `u1`)).resolves.toMatchObject({
        points: 8,
        correct: 3,
        sessions: 2
      });
    });

    it(`keeps each guild's scores to itself`, async () => {
      // WHY: scores are per-guild by design — the same person in two servers
      // keeps two standings. A missing guild predicate would merge every server
      // the bot is in, which is both wrong and a privacy leak between clubs.
      const scores = store();
      await scores.record(`g1`, [{ userId: `u1`, points: 5, correct: 1 }]);
      await scores.record(`g2`, [{ userId: `u1`, points: 99, correct: 9 }]);

      await expect(scores.forUser(`g1`, `u1`)).resolves.toMatchObject({
        points: 5
      });
      await expect(scores.top(`g1`).then((t) => t.length)).resolves.toBe(1);
    });

    it(`records every player in one session`, async () => {
      // WHY: a session ends for everyone at once, and the batch is one round
      // trip. A loop that stopped early would silently drop whoever came last —
      // which, sorted by points, is the people who most need the encouragement.
      const scores = store();
      await scores.record(`g1`, [
        { userId: `u1`, points: 5, correct: 2 },
        { userId: `u2`, points: 3, correct: 1 },
        { userId: `u3`, points: 1, correct: 1 }
      ]);

      await expect(scores.top(`g1`)).resolves.toHaveLength(3);
    });

    it(`does nothing when nobody scored`, async () => {
      // WHY: a session everybody sat out still ends. Writing a row per player
      // would mean rows with no player in them.
      const scores = store();
      await scores.record(`g1`, []);
      await expect(scores.top(`g1`)).resolves.toEqual([]);
    });
  });

  describe(`reading the leaderboard`, () => {
    it(`ranks by points, highest first`, async () => {
      // WHY: the order IS the leaderboard. Getting it backwards would be
      // immediately visible and deeply demoralising.
      const scores = store();
      await scores.record(`g1`, [
        { userId: `low`, points: 1, correct: 1 },
        { userId: `high`, points: 10, correct: 5 },
        { userId: `mid`, points: 5, correct: 3 }
      ]);

      expect((await scores.top(`g1`)).map((s) => s.userId)).toEqual([
        `high`,
        `mid`,
        `low`
      ]);
    });

    it(`limits how many it returns`, async () => {
      // WHY: an embed has a size limit, and a club that plays for a year would
      // otherwise produce a message Discord refuses to post.
      const scores = store();
      await scores.record(
        `g1`,
        Array.from({ length: 15 }, (_, i) => ({
          userId: `u${String(i)}`,
          points: i,
          correct: 1
        }))
      );

      await expect(scores.top(`g1`, 10)).resolves.toHaveLength(10);
    });

    it(`reports nothing for a guild that has never played`, async () => {
      // WHY: an empty leaderboard is a normal state, not an error. The embed
      // says so; this makes sure it gets the chance to.
      const scores = store();
      await expect(scores.top(`never`)).resolves.toEqual([]);
      await expect(scores.forUser(`never`, `u1`)).resolves.toBeNull();
    });
  });
});

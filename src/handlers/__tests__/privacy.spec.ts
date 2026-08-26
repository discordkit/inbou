import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import scoresSchema from "../../../migrations/0001_scores.sql?raw";
import privacySchema from "../../../migrations/0002_privacy.sql?raw";
import { inbouStores, privacyOver, type Erasable } from "../privacy.js";
import { d1Scores } from "../scores.js";

/**
 * Consent and erasure against a real database.
 *
 * These are promises made to a person rather than features, so the failure
 * mode is a bot that says it forgot somebody and did not. Every case here is
 * about the claim being true.
 */

const workerEnv = env as unknown as { SCORES: D1Database };
const db = () => workerEnv.SCORES;

const applySchema = async (sql: string): Promise<void> => {
  for (const statement of sql
    .split(`;`)
    .map((line) => line.replace(/^\s*--.*$/gmu, ``).trim())
    .filter((line) => line !== ``)) {
    await db().exec(statement.replace(/\s+/gu, ` `));
  }
};

const privacy = () => privacyOver(db(), inbouStores(db()));

describe(`consent and erasure, against a real database`, () => {
  beforeEach(async () => {
    await db().exec(/* sql */ `DROP TABLE IF EXISTS scores`);
    await db().exec(/* sql */ `DROP TABLE IF EXISTS tracking_optouts`);
    await applySchema(scoresSchema);
    await applySchema(privacySchema);
  });

  describe(`tracking preferences`, () => {
    it(`treats everyone as tracked until they say otherwise`, async () => {
      // WHY: the default has to be the common case. A table needing a row before
      // anybody could be scored would grow with participation, not with dissent.
      await expect(privacy().isTracked(`g1`, `never-seen`)).resolves.toBe(true);
    });

    it(`remembers an opt-out, and lets it be undone`, async () => {
      const p = privacy();
      await p.setTracking(`g1`, `u1`, false);
      await expect(p.isTracked(`g1`, `u1`)).resolves.toBe(false);

      await p.setTracking(`g1`, `u1`, true);
      await expect(p.isTracked(`g1`, `u1`)).resolves.toBe(true);
    });

    it(`keeps the preference per server`, async () => {
      // WHY: somebody may be happy to appear on a study group's leaderboard and
      // not on a public server's. One global flag would force the stricter
      // choice everywhere.
      const p = privacy();
      await p.setTracking(`g1`, `u1`, false);

      await expect(p.isTracked(`g1`, `u1`)).resolves.toBe(false);
      await expect(p.isTracked(`g2`, `u1`)).resolves.toBe(true);
    });

    it(`does not delete anything already recorded`, async () => {
      // WHY: opting out is about what happens next. Somebody expecting their
      // history to survive would otherwise lose it without being asked, and
      // `forget` is the command that deletes.
      const scores = d1Scores(db());
      await scores.record(`g1`, [{ userId: `u1`, points: 9, correct: 3 }]);
      await privacy().setTracking(`g1`, `u1`, false);

      await expect(scores.forUser(`g1`, `u1`)).resolves.toMatchObject({
        points: 9
      });
    });
  });

  describe(`forgetting a player`, () => {
    const seed = async (): Promise<void> => {
      const scores = d1Scores(db());
      await scores.record(`g1`, [{ userId: `u1`, points: 5, correct: 2 }]);
      await scores.record(`g2`, [{ userId: `u1`, points: 7, correct: 4 }]);
      await scores.record(`g1`, [{ userId: `other`, points: 3, correct: 1 }]);
      await privacy().setTracking(`g1`, `u1`, false);
    };

    it(`removes only that player, only in that server`, async () => {
      // WHY: the blast radius is the whole point. Erasing a guild too widely
      // takes somebody else's history; too narrowly leaves the person on a
      // leaderboard they asked to leave.
      await seed();
      await privacy().forget(`u1`, { kind: `guild`, guildId: `g1` });

      const scores = d1Scores(db());
      await expect(scores.forUser(`g1`, `u1`)).resolves.toBeNull();
      await expect(scores.forUser(`g2`, `u1`)).resolves.toMatchObject({
        points: 7
      });
      await expect(scores.forUser(`g1`, `other`)).resolves.toMatchObject({
        points: 3
      });
    });

    it(`removes them from every server when asked to`, async () => {
      // WHY: without this there is no way to fully erase yourself short of
      // asking in each server, which would make the privacy policy a half-truth.
      await seed();
      await privacy().forget(`u1`, { kind: `everywhere` });

      const scores = d1Scores(db());
      await expect(scores.forUser(`g1`, `u1`)).resolves.toBeNull();
      await expect(scores.forUser(`g2`, `u1`)).resolves.toBeNull();
      await expect(scores.forUser(`g1`, `other`)).resolves.toMatchObject({
        points: 3
      });
    });

    it(`also removes the opt-out row, which is itself personal data`, async () => {
      // WHY: keeping a record of exactly the person who asked not to be recorded
      // would be the wrong way round. A forgotten player comes back tracked, the
      // same as somebody the bot has never seen.
      await seed();
      await privacy().forget(`u1`, { kind: `everywhere` });

      const row = await db()
        .prepare(
          /* sql */ `SELECT COUNT(*) AS n FROM tracking_optouts WHERE user_id = ?1`
        )
        .bind(`u1`)
        .first<{ n: number }>();
      expect(row?.n).toBe(0);
      await expect(privacy().isTracked(`g1`, `u1`)).resolves.toBe(true);
    });

    it(`reports what it deleted, per store`, async () => {
      // WHY: the reply tells the player what went. A claim of success over a
      // no-op is the thing that makes a deletion promise untrustworthy.
      await seed();
      const erased = await privacy().forget(`u1`, {
        kind: `guild`,
        guildId: `g1`
      });

      const byLabel = Object.fromEntries(erased.map((e) => [e.label, e.rows]));
      expect(byLabel[`leaderboard scores`]).toBe(1);
      expect(byLabel[`tracking preference`]).toBe(1);
    });

    it(`previews without deleting`, async () => {
      // WHY: the confirmation shows counts before anything goes. If preview
      // deleted, the button would be erasing already-erased data and the player
      // would never get to say no.
      await seed();
      const found = await privacy().preview(`u1`, {
        kind: `guild`,
        guildId: `g1`
      });

      expect(found.some((entry) => entry.rows > 0)).toBe(true);
      await expect(d1Scores(db()).forUser(`g1`, `u1`)).resolves.toMatchObject({
        points: 5
      });
    });

    it(`says nothing was stored, rather than failing, for a stranger`, async () => {
      // WHY: running `/privacy forget` having never played is a normal thing to
      // do, and the honest answer is zero rather than an error.
      const erased = await privacy().forget(`stranger`, { kind: `everywhere` });
      expect(erased.every((entry) => entry.rows === 0)).toBe(true);
    });

    it(`keeps going when one store fails`, async () => {
      // WHY: a partial erasure is bad; abandoning the remaining stores because
      // the first one was down is worse. The broken one reports zero, so the
      // reply cannot claim to have deleted what it did not.
      const broken: Erasable = {
        label: `broken store`,
        count: async () => {
          throw new Error(`down`);
        },
        erase: async () => {
          throw new Error(`down`);
        }
      };
      const scores = d1Scores(db());
      await scores.record(`g1`, [{ userId: `u1`, points: 5, correct: 2 }]);

      const port = privacyOver(db(), [broken, ...inbouStores(db())]);
      const erased = await port.forget(`u1`, { kind: `guild`, guildId: `g1` });

      expect(erased.find((e) => e.label === `broken store`)?.rows).toBe(0);
      expect(erased.find((e) => e.label === `leaderboard scores`)?.rows).toBe(
        1
      );
      await expect(scores.forUser(`g1`, `u1`)).resolves.toBeNull();
    });
  });
});

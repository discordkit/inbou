import { diagnostics } from "./diagnostics.js";

/**
 * The cross-session leaderboard, behind one interface.
 *
 * Session scores live in the Durable Object and vanish when the session ends.
 * This is the part that outlasts it, so `/quiz scores` can answer "who plays
 * here" rather than "who was in the room ten minutes ago".
 *
 * An interface for the same reason `DiscordEffects` is one: the flow that
 * decides *when* to record a result should be testable without a database. The
 * D1 implementation below is the only place that writes SQL.
 *
 * Every method swallows its failures and reports a diagnostic, matching
 * `DiscordEffects`. The reasoning is stronger here — a leaderboard is a record
 * of play rather than part of it, and a session that cannot save its scores has
 * still been played.
 */

/** One player's standing in a guild. */
export interface Standing {
  userId: string;
  points: number;
  /** How many answers they have got right, across every session. */
  correct: number;
  /** How many sessions they have taken part in. */
  sessions: number;
  /** Unix milliseconds of their most recent session. */
  lastPlayed: number;
}

/** What one finished session contributes for one player. */
export interface SessionResult {
  userId: string;
  points: number;
  correct: number;
}

export interface ScorePort {
  /**
   * Fold a finished session into the running totals.
   *
   * Takes every player at once because a session ends for all of them
   * together, and because D1 charges per statement — one batch is one round
   * trip rather than one per player.
   */
  record: (guildId: string, results: readonly SessionResult[]) => Promise<void>;
  /** The guild's leaderboard, highest first. */
  top: (guildId: string, limit?: number) => Promise<Standing[]>;
  /** One player's standing, or null if they have never played here. */
  forUser: (guildId: string, userId: string) => Promise<Standing | null>;
}

/** The row shape the queries below select. */
interface Row {
  user_id: string;
  points: number;
  correct: number;
  sessions: number;
  last_played: number;
}

const toStanding = (row: Row): Standing => ({
  userId: row.user_id,
  points: row.points,
  correct: row.correct,
  sessions: row.sessions,
  lastPlayed: row.last_played
});

const detailOf = (error: unknown): string | undefined =>
  error instanceof Error ? error.message : undefined;

/**
 * The leaderboard backed by D1.
 *
 * `record` upserts rather than reading then writing: two sessions ending in the
 * same moment would otherwise read the same total and one would overwrite the
 * other. `ON CONFLICT ... DO UPDATE` makes the addition happen in the database,
 * where it is atomic.
 */
export const d1Scores = (db: D1Database): ScorePort => ({
  record: async (guildId, results) => {
    if (results.length === 0) return;
    try {
      const now = Date.now();
      const upsert =
        db.prepare(/* sql */ `INSERT INTO scores (guild_id, user_id, points, correct, sessions, last_played)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET
           points      = points + excluded.points,
           correct     = correct + excluded.correct,
           sessions    = sessions + 1,
           last_played = excluded.last_played`);
      await db.batch(
        results.map((result) =>
          upsert.bind(
            guildId,
            result.userId,
            result.points,
            result.correct,
            now
          )
        )
      );
    } catch (error) {
      diagnostics.SCORES_UNAVAILABLE({
        action: `record a finished session`,
        ...(detailOf(error) === undefined ? {} : { detail: detailOf(error) })
      });
    }
  },

  top: async (guildId, limit = 10) => {
    try {
      const { results } = await db
        .prepare(/* sql */ `SELECT user_id, points, correct, sessions, last_played
             FROM scores
            WHERE guild_id = ?1
            ORDER BY points DESC, correct DESC, last_played DESC
            LIMIT ?2`)
        .bind(guildId, limit)
        .all<Row>();
      return results.map(toStanding);
    } catch (error) {
      diagnostics.SCORES_UNAVAILABLE({
        action: `read the leaderboard`,
        ...(detailOf(error) === undefined ? {} : { detail: detailOf(error) })
      });
      return [];
    }
  },

  forUser: async (guildId, userId) => {
    try {
      const row = await db
        .prepare(/* sql */ `SELECT user_id, points, correct, sessions, last_played
             FROM scores
            WHERE guild_id = ?1 AND user_id = ?2`)
        .bind(guildId, userId)
        .first<Row>();
      return row === null ? null : toStanding(row);
    } catch (error) {
      diagnostics.SCORES_UNAVAILABLE({
        action: `read a player's standing`,
        ...(detailOf(error) === undefined ? {} : { detail: detailOf(error) })
      });
      return null;
    }
  }
});

/**
 * A leaderboard that keeps nothing.
 *
 * Used when the D1 binding is absent, which is the case in a DM — there is no
 * guild to score against — and in any deployment that has not run the
 * migration. The quiz plays identically; only the record of it is missing.
 */
export const noScores: ScorePort = {
  record: async () => Promise.resolve(),
  top: async () => Promise.resolve([]),
  forUser: async () => Promise.resolve(null)
};

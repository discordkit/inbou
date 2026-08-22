-- Cross-session scores, one row per player per guild.
--
-- Aggregated rather than append-only: a leaderboard reads far more often than
-- it writes, and keeping running totals means `/quiz scores` is a single
-- indexed scan instead of a GROUP BY over every answer ever given. The cost is
-- that individual sessions are not recoverable, which nothing asks for.
--
-- `guild_id` is part of the key because scores are per-guild by design — the
-- same person in two servers keeps two separate standings.
CREATE TABLE IF NOT EXISTS scores (
  guild_id      TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  points        INTEGER NOT NULL DEFAULT 0,
  correct       INTEGER NOT NULL DEFAULT 0,
  sessions      INTEGER NOT NULL DEFAULT 0,
  -- Unix milliseconds. Stored so `/quiz scores` can say who is currently
  -- active rather than showing someone who stopped playing months ago.
  last_played   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);

-- The leaderboard query: one guild, ranked. Without this the table is scanned
-- in full, which is fine at club size and not fine if the bot spreads.
CREATE INDEX IF NOT EXISTS scores_by_guild
  ON scores (guild_id, points DESC);

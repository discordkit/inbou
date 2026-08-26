-- Tracking preferences, one row per player per guild.
--
-- Absence means tracked: the default has to be the common case, and a table
-- that needed a row for every player before they could be scored would grow
-- with participation rather than with dissent.
--
-- Scoped per guild for the same reason scores are. Somebody may be happy to
-- appear on a study group's leaderboard and not on a public server's.
CREATE TABLE IF NOT EXISTS tracking_optouts (
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  -- Unix milliseconds. Kept so the opt-out can be reported back honestly
  -- ("since 3 March") rather than as a bare flag.
  opted_out_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

-- Answers `is this player opted out` on the write path, which runs once per
-- finished session per player.
CREATE INDEX IF NOT EXISTS optouts_by_user
  ON tracking_optouts (user_id);

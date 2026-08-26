import { diagnostics } from "./diagnostics.js";

/**
 * Consent and erasure, for every store that keeps personal data.
 *
 * Two promises the bot makes to a player: it will forget them on request, and
 * it will stop recording them on request. Both have to hold across everything
 * the bot stores, not just whatever existed when the command was written — so
 * a store declares how it erases, and the command asks all of them.
 *
 * A second quiz type adds an {@link Erasable} and nothing else. If it forgets
 * to, `privacy.spec.ts` fails: an erasable that nothing registers is a store
 * that `/privacy forget` silently misses, which is worse than no promise.
 */

/** Which guilds an erasure covers. */
export type Scope = { kind: `guild`; guildId: string } | { kind: `everywhere` };

/**
 * A store that holds something identifiable.
 *
 * Erasure returns a count so the reply can say what actually went, rather than
 * claiming success over a no-op. A store with nothing for that player returns
 * zero, which is a true and useful answer.
 */
export interface Erasable {
  /** Shown to the player, so it says what was held rather than a table name. */
  readonly label: string;
  /** How many rows an erase would remove, for the confirmation. */
  count: (userId: string, scope: Scope) => Promise<number>;
  erase: (userId: string, scope: Scope) => Promise<number>;
}

/** What a deletion removed, per store. */
export interface Erased {
  label: string;
  rows: number;
}

export interface PrivacyPort {
  /** False when the player has opted out of persistent scoring in this guild. */
  isTracked: (guildId: string, userId: string) => Promise<boolean>;
  /** Opting out never removes anything already stored — `forget` does that. */
  setTracking: (
    guildId: string,
    userId: string,
    tracked: boolean
  ) => Promise<void>;
  /** What would be deleted, so the player can see it before confirming. */
  preview: (userId: string, scope: Scope) => Promise<Erased[]>;
  forget: (userId: string, scope: Scope) => Promise<Erased[]>;
}

const detailOf = (error: unknown): string | undefined =>
  error instanceof Error ? error.message : undefined;

const report = (action: string, error: unknown): void => {
  diagnostics.SCORES_UNAVAILABLE({
    action,
    ...(detailOf(error) === undefined ? {} : { detail: detailOf(error) })
  });
};

/**
 * The privacy surface over a set of stores.
 *
 * `stores` is the whole list of places personal data lives. Passing it in
 * rather than importing them keeps this testable without a database, and makes
 * the omission of a store a visible argument rather than a missing import.
 */
export const privacyOver = (
  db: D1Database,
  stores: readonly Erasable[]
): PrivacyPort => ({
  isTracked: async (guildId, userId) => {
    try {
      const row = await db
        .prepare(/* sql */ `SELECT 1 FROM tracking_optouts
                      WHERE guild_id = ?1 AND user_id = ?2`)
        .bind(guildId, userId)
        .first();
      return row === null;
    } catch (error) {
      // Tracked on failure, which is the status quo rather than the safer
      // reading — but the alternative silently stops recording everybody the
      // moment the table is unreachable, and nobody would notice for weeks.
      report(`read a tracking preference`, error);
      return true;
    }
  },

  setTracking: async (guildId, userId, tracked) => {
    try {
      if (tracked) {
        await db
          .prepare(/* sql */ `DELETE FROM tracking_optouts
                        WHERE guild_id = ?1 AND user_id = ?2`)
          .bind(guildId, userId)
          .run();
        return;
      }
      await db
        .prepare(/* sql */ `INSERT INTO tracking_optouts (guild_id, user_id, opted_out_at)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT (guild_id, user_id) DO NOTHING`)
        .bind(guildId, userId, Date.now())
        .run();
    } catch (error) {
      report(`save a tracking preference`, error);
      throw error;
    }
  },

  preview: async (userId, scope) => countAll(stores, userId, scope, false),
  forget: async (userId, scope) => countAll(stores, userId, scope, true)
});

/**
 * Ask every store, and keep going when one fails.
 *
 * A store that throws must not stop the others: a partial erasure is bad, but
 * an erasure that abandoned the remaining stores because the first one was
 * down is worse. The failure is reported and its count reads as zero, so the
 * reply cannot claim to have deleted something it did not.
 */
const countAll = async (
  stores: readonly Erasable[],
  userId: string,
  scope: Scope,
  destructive: boolean
): Promise<Erased[]> => {
  const out: Erased[] = [];
  for (const store of stores) {
    try {
      const rows = destructive
        ? await store.erase(userId, scope)
        : await store.count(userId, scope);
      out.push({ label: store.label, rows });
    } catch (error) {
      report(`${destructive ? `erase` : `count`} ${store.label}`, error);
      out.push({ label: store.label, rows: 0 });
    }
  }
  return out;
};

/**
 * The privacy surface when there is no database.
 *
 * Reports everyone as tracked, because without a store nothing is being
 * recorded in the first place — the honest answer is that there is nothing to
 * opt out of, and nothing to erase.
 */
export const alwaysTracked: PrivacyPort = {
  isTracked: async () => Promise.resolve(true),
  setTracking: async () => Promise.resolve(),
  preview: async () => Promise.resolve([]),
  forget: async () => Promise.resolve([])
};

/** The `WHERE` fragment and bindings a scope implies. */
const scoped = (scope: Scope, userId: string) =>
  scope.kind === `guild`
    ? {
        clause: `user_id = ?1 AND guild_id = ?2`,
        args: [userId, scope.guildId]
      }
    : { clause: `user_id = ?1`, args: [userId] };

/** Counts and deletes rows in one table for one player. */
const tableErasable = (
  db: D1Database,
  table: string,
  label: string
): Erasable => ({
  label,
  count: async (userId, scope) => {
    const { clause, args } = scoped(scope, userId);
    const row = await db
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${clause}`)
      .bind(...args)
      .first<{ n: number }>();
    return row?.n ?? 0;
  },
  erase: async (userId, scope) => {
    const { clause, args } = scoped(scope, userId);
    const result = await db
      .prepare(`DELETE FROM ${table} WHERE ${clause}`)
      .bind(...args)
      .run();
    return result.meta.changes ?? 0;
  }
});

/**
 * Everything the bot stores about a person.
 *
 * The opt-out row is itself personal data, so forgetting somebody removes it
 * too — which also means a forgotten player starts tracked again, the same as
 * anyone the bot has never seen. Leaving it behind would be keeping a record
 * of exactly the person who asked not to be recorded.
 *
 * A new quiz type with its own table adds a line here.
 */
export const inbouStores = (db: D1Database): Erasable[] => [
  tableErasable(db, `scores`, `leaderboard scores`),
  tableErasable(db, `tracking_optouts`, `tracking preference`)
];

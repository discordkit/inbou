/**
 * Reporting a problem without leaving Discord to write it up.
 *
 * The bot cannot open a GitHub issue on somebody's behalf — that would need a
 * token with write access to the repository, handed to a bot anyone in the
 * server can invoke. Instead it builds a pre-filled URL: the user reviews what
 * was written, edits anything, and submits under their own account.
 *
 * The context is filled in because it is the part people cannot supply. Nobody
 * knows which commit the bot is running, and "the timer felt short" is a
 * different report at 30s than at 2m.
 */

/**
 * The commit this Worker was built from.
 *
 * `__BUILD__` is replaced at build time. The guard is for every context that
 * does not go through that build — the test runner, most obviously — where a
 * bare reference would throw a ReferenceError rather than read undefined.
 */
const build = (): string => (typeof __BUILD__ === `string` ? __BUILD__ : `dev`);

/** What Discord tells us about where a command came from. */
export interface FeedbackContext {
  userId: string | null;
  guildId: string | null;
  channelId: string | null;
  /** The user's Discord language, which Discord does send. */
  locale: string | null;
  /** The running session's settings, when there is one. */
  session: {
    length: number | null;
    timeoutMs: number;
    guesses: number;
    levels: readonly number[];
    forms: readonly string[];
  } | null;
}

export type FeedbackKind = `bug` | `idea`;

const REPO = `https://github.com/discordkit/inbou`;

/**
 * GitHub returns 414 past its URL limit, and the failure would land on the
 * user as a broken link. Well under any server limit, and long enough that
 * nothing here is realistically truncated.
 */
const MAX_URL = 6000;

const describeSession = (session: FeedbackContext[`session`]): string => {
  if (session === null) return `none running`;
  const length = session.length === null ? `endless` : String(session.length);
  const levels =
    session.levels.length === 0
      ? `any level`
      : session.levels.map((l) => `N${String(l)}`).join(`/`);
  return `${length}q · ${String(Math.round(session.timeoutMs / 1000))}s · ${String(session.guesses)} guesses · ${levels} · ${session.forms.join(`, `)}`;
};

/**
 * The diagnostic block, as markdown.
 *
 * Written out rather than hidden in the URL so the user reads exactly what
 * they are about to publish. A GitHub issue is public and these ids are not
 * secret, but that is their decision to make rather than ours.
 */
export const contextBlock = (context: FeedbackContext): string =>
  [
    `Build: \`${build()}\``,
    `Locale: \`${context.locale ?? `unknown`}\``,
    `User: \`${context.userId ?? `unknown`}\``,
    `Server: \`${context.guildId ?? `direct message`}\``,
    `Channel: \`${context.channelId ?? `unknown`}\``,
    `Session: ${describeSession(context.session)}`
  ].join(`\n`);

/**
 * A pre-filled issue URL.
 *
 * Field names are the `id`s in the issue forms under `.github/ISSUE_TEMPLATE`;
 * GitHub uses a form field's id as its query parameter name. Renaming one there
 * silently stops it prefilling, which `feedback.spec.ts` checks against the
 * committed templates.
 */
export const feedbackUrl = (
  kind: FeedbackKind,
  summary: string,
  context: FeedbackContext
): string => {
  const template = kind === `bug` ? `bug.yml` : `idea.yml`;
  const params = new URLSearchParams({
    template,
    labels: kind === `bug` ? `bug` : `enhancement`,
    [kind === `bug` ? `what` : `idea`]: summary,
    context: contextBlock(context)
  });

  const url = `${REPO}/issues/new?${params.toString()}`;
  if (url.length <= MAX_URL) return url;

  // Too long to prefill. The summary is the only part that can grow without
  // bound, so it is what gets dropped — an issue with the context and an empty
  // description is still worth opening, a 414 is not.
  const trimmed = new URLSearchParams({
    template,
    labels: kind === `bug` ? `bug` : `enhancement`,
    context: contextBlock(context)
  });
  return `${REPO}/issues/new?${trimmed.toString()}`;
};

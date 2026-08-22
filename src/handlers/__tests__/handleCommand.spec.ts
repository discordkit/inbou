import type { Embed } from "@discordkit/client";
import type { Interaction } from "@discordkit/client/interactions/types/Interaction";
import { describe, expect, it } from "vitest";
import { handleCommand, type CommandDeps } from "../commands.js";
import type { DiscordEffects } from "../discord.js";
import type { SessionPort } from "../quiz/flow.js";
import type { Word } from "../quiz/question.js";
import type { ScorePort, Standing } from "../scores.js";

/**
 * The command layer, told the wrong thing on purpose.
 *
 * Everything here is a way somebody uses the bot other than as intended:
 * starting a session on top of one, ending nothing, asking for a leaderboard
 * where there is no server to keep one. None of these are errors on the user's
 * part — they are what a busy channel produces — so each has to answer rather
 * than fail silently or, worse, act.
 */

const recorder = () => {
  const replies: { content?: string; ephemeral?: boolean }[] = [];
  const posts: { channelId: string; embed: Embed }[] = [];
  const discord: DiscordEffects = {
    post: async (channelId, embed) => {
      posts.push({ channelId, embed });
      return `msg`;
    },
    say: async () => `msg`,
    react: async () => undefined,
    reply: async (_interaction, body) => {
      replies.push(body);
    }
  };
  return { discord, replies, posts };
};

/** A session port reporting whatever state the test needs. */
const sessionAt = (
  state: `asking` | `revealing` | `paused` | `finished` | null
): SessionPort => ({
  begin: async () => undefined,
  current: async () =>
    state === null
      ? null
      : {
          state,
          context: {
            question: null,
            questionNumber: 3,
            config: { length: 10, timeoutMs: 60_000, guesses: 3 },
            filters: { levels: [5], types: [], classes: [], forms: [] },
            attempts: [],
            scores: {}
          }
        },
  submit: async () => ({ outcome: { kind: `ignored` }, needsNext: false }),
  next: async () => undefined,
  configure: async () => undefined,
  pause: async () => undefined,
  resume: async () => undefined,
  end: async () => ({ guildId: `g1`, standings: [], correct: {} })
});

const scoresWith = (top: Standing[] = []): ScorePort => ({
  record: async () => Promise.resolve(),
  top: async () => Promise.resolve(top),
  forUser: async () => Promise.resolve(top[0] ?? null)
});

const word: Word = {
  id: `1`,
  kana: `うる`,
  kanji: `売る`,
  pos: `v5r`,
  type: `verb`,
  verbClass: `godan-r`,
  jlpt: 5,
  gloss: `to sell`
};

const deps = (
  state: Parameters<typeof sessionAt>[0],
  scores: ScorePort = scoresWith()
) => {
  const rec = recorder();
  return {
    ...rec,
    deps: {
      discord: rec.discord,
      session: sessionAt(state),
      scores,
      words: [word],
      random: () => 0
    } satisfies CommandDeps
  };
};

/** A `/quiz <sub>` interaction, optionally outside a guild. */
const command = (
  sub: string,
  { guild = `g1`, options = [] as unknown[] } = {}
): Interaction =>
  ({
    type: 2,
    channelId: `chan`,
    ...(guild === `` ? {} : { guildId: guild }),
    data: { name: `quiz`, options: [{ name: sub, options }] }
  }) as unknown as Interaction;

describe(`starting a session that cannot start`, () => {
  it.each([`asking`, `revealing`, `paused`] as const)(
    `refuses to start over a session that is %s`,
    async (state) => {
      // WHY: two sessions in one channel would share one Durable Object, so
      // the second silently destroys the first — people mid-question would
      // see their game replaced with no explanation. `paused` counts: the
      // intro countdown is a running session that has not shown a question
      // yet, and it is the likeliest moment for an impatient second start.
      const { deps: d, replies, posts } = deps(state);
      await handleCommand(d, command(`start`));

      expect(replies[0]?.content).toContain(`already running`);
      expect(replies[0]?.ephemeral).toBe(true);
      // Nothing was posted, so the running session is untouched.
      expect(posts).toEqual([]);
    }
  );

  it(`starts when the previous session finished`, async () => {
    // WHY: the counterpart. A finished session must not block the next one,
    // or a channel would need `/quiz end` after every completed game.
    const { deps: d, replies } = deps(`finished`);
    await handleCommand(d, command(`start`));

    expect(replies[0]?.content).not.toContain(`already running`);
  });

  it(`reports bad options instead of starting with defaults`, async () => {
    // WHY: silently ignoring a typo would start a session drilling something
    // nobody asked for, and the mistake only becomes visible several questions
    // in — by which point the scores are already wrong for the intent.
    const { deps: d, replies, posts } = deps(null);
    await handleCommand(
      d,
      command(`start`, { options: [{ name: `level`, value: `N9` }] })
    );

    expect(replies[0]?.content).toContain(`N9`);
    expect(posts).toEqual([]);
  });
});

describe(`commands with nothing to act on`, () => {
  it.each([`finished`, null] as const)(
    `says so when ending with session state %s`,
    async (state) => {
      // WHY: `/quiz end` in a quiet channel is a normal mistake. An unanswered
      // interaction shows "the application did not respond", which reads as
      // the bot being broken rather than the channel being empty.
      const { deps: d, replies } = deps(state);
      await handleCommand(d, command(`end`));

      expect(replies[0]?.content).toContain(`No session`);
      expect(replies[0]?.ephemeral).toBe(true);
    }
  );

  it(`refuses to configure a session that is not running`, async () => {
    // WHY: settings are stored on the session, so configuring nothing would
    // write into a session that does not exist and quietly do nothing.
    const { deps: d, replies } = deps(null);
    await handleCommand(d, command(`config`));

    expect(replies[0]?.content).toContain(`No session`);
  });
});

describe(`the leaderboard`, () => {
  it(`explains itself in a DM rather than showing an empty board`, async () => {
    // WHY: scores are kept per server. In a DM there is no server, so an empty
    // leaderboard would be misleading — it would look like nobody had played
    // rather than like the question does not apply here.
    const { deps: d, replies, posts } = deps(null);
    await handleCommand(d, command(`scores`, { guild: `` }));

    expect(replies[0]?.content).toContain(`per server`);
    expect(posts).toEqual([]);
  });

  it(`posts an empty board publicly when nobody has played yet`, async () => {
    // WHY: an empty leaderboard is a normal state, not an error, and the embed
    // says how to fix it. Replying privately would leave the channel wondering
    // whether the command worked.
    const { deps: d, posts } = deps(null, scoresWith([]));
    await handleCommand(d, command(`scores`));

    expect(posts[0]?.embed.description).toContain(`/quiz start`);
  });

  it(`posts the standings publicly`, async () => {
    // WHY: a leaderboard nobody else can see defeats the point of keeping one.
    // This is the opposite of `/hint`, which is private because seeing it
    // would end the race.
    const { deps: d, posts } = deps(
      null,
      scoresWith([
        { userId: `drake`, points: 12, correct: 4, sessions: 2, lastPlayed: 1 }
      ])
    );
    await handleCommand(d, command(`scores`));

    expect(posts[0]?.embed.description).toContain(`drake`);
    expect(posts[0]?.channelId).toBe(`chan`);
  });
});

describe(`commands the bot does not have`, () => {
  it(`answers an unknown subcommand instead of timing out`, async () => {
    // WHY: an unregistered name means the deployed command list and this
    // handler have drifted. Leaving the interaction unanswered shows the user
    // "the application did not respond", which hides the real problem.
    const { deps: d, replies } = deps(null);
    await handleCommand(d, command(`nonsense`));

    expect(replies[0]?.content).toContain(`do not have a handler`);
    expect(replies[0]?.ephemeral).toBe(true);
  });
});

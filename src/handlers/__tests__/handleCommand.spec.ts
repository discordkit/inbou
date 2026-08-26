import type { Embed } from "@discordkit/client";
import type { Interaction } from "@discordkit/client/interactions/types/Interaction";
import { describe, expect, it } from "vitest";
import { conjugationQuiz } from "../quiz/conjugation.js";
import type { PrivacyPort } from "../privacy.js";
import { handleCommand, type CommandDeps } from "../commands.js";
import { BUTTON } from "../quiz/render.js";
import type { DiscordEffects } from "../discord.js";
import type { SessionPort } from "../quiz/flow.js";
import type { Question, Word } from "../quiz/question.js";
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
  const replies: { content?: string; embed?: Embed; ephemeral?: boolean }[] =
    [];
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

const question: Question = {
  wordId: `1`,
  prompt: `売る → plain non-past negative`,
  form: `non-past-negative`,
  answer: `うらない`,
  answerKanji: `売らない`,
  stem: `うら`,
  dictionary: `売る`,
  reading: `うる`,
  gloss: `to sell`,
  type: `verb`,
  verbClass: `godan-r`
};

/** A session port reporting whatever state the test needs. */
const sessionAt = (
  state: `asking` | `revealing` | `paused` | `finished` | null,
  extra: {
    misses?: Record<
      string,
      { question: Question; answer: string; questionNumber: number }
    >;
    question?: Question | null;
  } = {}
): SessionPort => ({
  begin: async () => undefined,
  current: async () =>
    state === null
      ? null
      : {
          state,
          context: {
            question: extra.question ?? null,
            questionNumber: 3,
            config: { length: 10, timeoutMs: 60_000, guesses: 3 },
            filters: { levels: [5], types: [], classes: [], forms: [] },
            attempts: [],
            scores: {},
            misses: extra.misses ?? {}
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

const trackingStub = (optedOut: string[] = []) => {
  const out = new Set(optedOut);
  const erased: { userId: string; everywhere: boolean }[] = [];
  const port: PrivacyPort = {
    isTracked: async (_guildId, userId) => !out.has(userId),
    setTracking: async (_guildId, userId, tracked) => {
      if (tracked) out.delete(userId);
      else out.add(userId);
    },
    preview: async () => [{ label: `leaderboard scores`, rows: 3 }],
    forget: async (userId, scope) => {
      erased.push({ userId, everywhere: scope.kind === `everywhere` });
      return [{ label: `leaderboard scores`, rows: 3 }];
    }
  };
  return { port, out, erased };
};

const deps = (
  state: Parameters<typeof sessionAt>[0],
  scores: ScorePort = scoresWith(),
  extra: Parameters<typeof sessionAt>[1] = {}
) => {
  const tracking = trackingStub();
  const rec = recorder();
  return {
    ...rec,
    deps: {
      discord: rec.discord,
      session: sessionAt(state, extra),
      kind: conjugationQuiz,
      scores,
      privacy: tracking.port,
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

describe(`reviewing a question`, () => {
  /** `/review` is a top-level command, and carries the invoker in `member`. */
  const reviewIn = (guild = `g1`): Interaction =>
    ({
      type: 2,
      channelId: `chan`,
      ...(guild === `` ? {} : { guildId: guild }),
      member: { user: { id: `drake` } },
      data: { name: `review` }
    }) as unknown as Interaction;

  it(`shows the asking player their own miss, privately`, async () => {
    // WHY: the reveal already taught this in public, but it scrolls away while
    // people are still typing — and it lists everybody's attempts together, so
    // finding your own is work. This shows one person theirs.
    const { deps: d, replies } = deps(`asking`, scoresWith(), {
      misses: {
        drake: { question, answer: `うらなかった`, questionNumber: 7 }
      }
    });
    await handleCommand(d, reviewIn());

    expect(replies[0]?.ephemeral).toBe(true);
    expect(replies[0]?.embed?.title).toBe(`Your last miss`);
    expect(JSON.stringify(replies[0]?.embed)).toContain(`うらなかった`);
  });

  it(`shows one player's miss and not another's`, async () => {
    // WHY: misses are keyed by user, and the whole point is that it is *your*
    // recap. Showing somebody else's answer would be both useless and a small
    // betrayal of the person who got it wrong.
    const { deps: d, replies } = deps(`asking`, scoresWith(), {
      misses: {
        mika: { question, answer: `たべなかった`, questionNumber: 2 }
      }
    });
    await handleCommand(d, reviewIn());

    expect(JSON.stringify(replies[0])).not.toContain(`たべなかった`);
  });

  it(`refuses to show the question that is still open`, async () => {
    // WHY: this is the difference between `/review` and cheating. A player with
    // no misses running `/review` mid-question must not be handed the answer to
    // the race everybody else is still running.
    const { deps: d, replies } = deps(`asking`, scoresWith(), { question });
    await handleCommand(d, reviewIn());

    expect(replies[0]?.embed).toBeUndefined();
    expect(replies[0]?.content).toContain(`Nothing to review yet`);
    expect(JSON.stringify(replies[0])).not.toContain(`うらない`);
  });

  it(`falls back to the closed question for somebody who did not answer`, async () => {
    // WHY: a latecomer who missed the reveal is much of who runs this. The
    // question has closed, so showing it costs nobody anything.
    const { deps: d, replies } = deps(`revealing`, scoresWith(), { question });
    await handleCommand(d, reviewIn());

    expect(replies[0]?.embed?.title).toBe(`Last question`);
    expect(replies[0]?.ephemeral).toBe(true);
  });

  it(`says so when no session is running`, async () => {
    // WHY: `/review` in a quiet channel is a normal mistake, and an unanswered
    // interaction shows "the application did not respond".
    const { deps: d, replies } = deps(null);
    await handleCommand(d, reviewIn());

    expect(replies[0]?.content).toContain(`No session`);
  });

  it(`works in a DM, where the invoker is on the interaction itself`, async () => {
    // WHY: Discord puts the invoking user in `member.user` inside a guild and
    // `user` in a DM. Reading only one works everywhere it was tested and
    // nowhere else.
    const { deps: d, replies } = deps(`revealing`, scoresWith(), {
      misses: { drake: { question, answer: `うった`, questionNumber: 1 } }
    });
    await handleCommand(d, {
      type: 2,
      channelId: `chan`,
      user: { id: `drake` },
      data: { name: `review` }
    } as unknown as Interaction);

    expect(replies[0]?.embed?.title).toBe(`Your last miss`);
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

describe(`the buttons under a question`, () => {
  /** A component interaction, which carries a customId instead of a name. */
  const press = (customId: string): Interaction =>
    ({
      type: 3,
      channelId: `chan`,
      guildId: `g1`,
      member: { user: { id: `drake` } },
      data: { customId }
    }) as unknown as Interaction;

  it(`gives a hint from the Hint button`, async () => {
    // WHY: the buttons exist so nobody has to type a command in a channel
    // where typing is how you answer. They must do exactly what the slash
    // command does, including staying private.
    const { deps: d, replies } = deps(`asking`, scoresWith(), { question });
    await handleCommand(d, press(BUTTON.hint));

    expect(replies[0]?.embed?.title).toBe(`Hint`);
    expect(replies[0]?.ephemeral).toBe(true);
  });

  it(`ends the session from the End button`, async () => {
    const { deps: d, replies } = deps(`asking`, scoresWith(), { question });
    await handleCommand(d, press(BUTTON.end));

    expect(replies[0]?.content).toContain(`ended`);
  });

  it(`answers an unrecognised button instead of going quiet`, async () => {
    // WHY: a stale message keeps its buttons forever. Pressing one after the
    // ids have changed must not leave the interaction unanswered, which shows
    // "the application did not respond".
    const { deps: d } = deps(`asking`, scoresWith(), { question });
    await expect(
      handleCommand(d, press(`quiz:obsolete`))
    ).resolves.toBeUndefined();
  });
});

describe(`asking for a hint`, () => {
  const hintCommand = (): Interaction =>
    ({
      type: 2,
      channelId: `chan`,
      guildId: `g1`,
      member: { user: { id: `drake` } },
      data: { name: `hint` }
    }) as unknown as Interaction;

  it(`gives the reading and meaning, privately`, async () => {
    // WHY: ephemeral is the whole design. A public hint would end the race for
    // everybody still working on the answer.
    const {
      deps: d,
      replies,
      posts
    } = deps(`asking`, scoresWith(), {
      question
    });
    await handleCommand(d, hintCommand());

    expect(replies[0]?.ephemeral).toBe(true);
    expect(JSON.stringify(replies[0]?.embed)).toContain(`to sell`);
    expect(posts).toEqual([]);
  });

  it(`refuses when no question is open`, async () => {
    // WHY: `revealing` means the answer is already on screen, and hinting at a
    // question nobody is being asked would be nonsense.
    const { deps: d, replies } = deps(`revealing`, scoresWith(), { question });
    await handleCommand(d, hintCommand());

    expect(replies[0]?.content).toContain(`No question is open`);
    expect(replies[0]?.embed).toBeUndefined();
  });
});

describe(`reconfiguring a running session`, () => {
  const configure = (options: unknown[]): Interaction =>
    ({
      type: 2,
      channelId: `chan`,
      guildId: `g1`,
      data: { name: `quiz`, options: [{ name: `config`, options }] }
    }) as unknown as Interaction;

  it(`applies settings from the next question`, async () => {
    // WHY: `/quiz config` never takes effect mid-question — moving a deadline
    // players are already racing would be unfair. The reply says so.
    const { deps: d, replies } = deps(`asking`, scoresWith(), { question });
    await handleCommand(d, configure([{ name: `timeout`, value: `2m` }]));

    expect(replies[0]?.content).toContain(`next question`);
    expect(replies[0]?.ephemeral).toBe(true);
  });

  it(`reports a bad value instead of applying it`, async () => {
    // WHY: silently ignoring a typo would leave the session running settings
    // nobody chose, with the player believing they had changed them.
    const { deps: d, replies } = deps(`asking`, scoresWith(), { question });
    await handleCommand(d, configure([{ name: `timeout`, value: `9h` }]));

    expect(replies[0]?.content).toContain(`9h`);
    expect(replies[0]?.content).not.toContain(`next question`);
  });
});

describe(`reporting feedback`, () => {
  const feedbackIn = (sub: string, summary: string): Interaction =>
    ({
      type: 2,
      channelId: `chan`,
      guildId: `g1`,
      locale: `ja`,
      member: { user: { id: `drake` } },
      data: {
        name: `feedback`,
        options: [{ name: sub, options: [{ name: `summary`, value: summary }] }]
      }
    }) as unknown as Interaction;

  it(`replies privately with a link, never posting to the channel`, async () => {
    // WHY: the link carries the reporter's own user id and this server's id.
    // Posting it publicly would publish those to everyone in the channel,
    // which is the opposite of letting them decide.
    const {
      deps: d,
      replies,
      posts
    } = deps(`asking`, scoresWith(), {
      question
    });
    await handleCommand(d, feedbackIn(`bug`, `kanji marked wrong`));

    expect(replies[0]?.ephemeral).toBe(true);
    expect(posts).toEqual([]);
    expect(JSON.stringify(replies[0]?.embed)).toContain(`github.com`);
  });

  it(`carries the running session's settings`, async () => {
    // WHY: this is the context a reporter cannot supply themselves, and the
    // reason the command exists rather than a link in the README.
    const { deps: d, replies } = deps(`asking`, scoresWith(), { question });
    await handleCommand(d, feedbackIn(`bug`, `timer too short`));

    const link = JSON.stringify(replies[0]?.embed);
    expect(link).toContain(`60s`);
    expect(link).toContain(`bug.yml`);
  });

  it(`uses the idea form for a suggestion`, async () => {
    const { deps: d, replies } = deps(null);
    await handleCommand(d, feedbackIn(`idea`, `weak-forms practice`));

    expect(JSON.stringify(replies[0]?.embed)).toContain(`idea.yml`);
  });

  it(`works with no session running`, async () => {
    // WHY: most reports are filed after something went wrong and the session
    // ended. Requiring a live one would block exactly the common case.
    const { deps: d, replies } = deps(null);
    await handleCommand(d, feedbackIn(`bug`, `bot went quiet`));

    expect(replies[0]?.ephemeral).toBe(true);
    // Decoded: the context rides in the query string, so `none running` is
    // written `none+running` on the wire.
    expect(
      decodeURIComponent(
        (replies[0]?.embed?.description ?? ``).replaceAll(`+`, ` `)
      )
    ).toContain(`none running`);
  });

  it(`says what the form will contain before it is opened`, async () => {
    // WHY: a GitHub issue is public. Naming what is included is what makes
    // submitting it an informed choice rather than a surprise.
    const { deps: d, replies } = deps(null);
    await handleCommand(d, feedbackIn(`bug`, `x`));

    const text = replies[0]?.embed?.description ?? ``;
    expect(text).toContain(`user id`);
    expect(text).toContain(`Nothing is sent until`);
  });
});

describe(`the privacy commands`, () => {
  const privacyIn = (sub: string, opts: unknown[] = []): Interaction =>
    ({
      type: 2,
      channelId: `chan`,
      guildId: `g1`,
      member: { user: { id: `drake` } },
      data: { name: `privacy`, options: [{ name: sub, options: opts }] }
    }) as unknown as Interaction;

  it(`asks before deleting anything`, async () => {
    // WHY: erasure cannot be undone. A command that deleted on invocation
    // would turn a mistyped command into permanent loss.
    const { deps: d, replies } = deps(null);
    await handleCommand(d, privacyIn(`forget`));

    expect(replies[0]?.ephemeral).toBe(true);
    expect(replies[0]?.embed?.title).toContain(`Forget me`);
    // A confirm button, not a completed deletion.
    expect(JSON.stringify(replies[0])).toContain(`privacy:forget:drake`);
  });

  it(`names the counts so the choice is informed`, async () => {
    const { deps: d, replies } = deps(null);
    await handleCommand(d, privacyIn(`forget`));

    expect(JSON.stringify(replies[0]?.embed)).toContain(`leaderboard scores`);
  });

  it(`stays private throughout`, async () => {
    // WHY: asking to be forgotten should not announce itself to the channel.
    const { deps: d, replies, posts } = deps(null);
    await handleCommand(
      d,
      privacyIn(`tracking`, [{ name: `state`, value: `off` }])
    );

    expect(replies[0]?.ephemeral).toBe(true);
    expect(posts).toEqual([]);
  });

  it(`turns tracking off and reports it back`, async () => {
    const { deps: d, replies } = deps(null);
    await handleCommand(
      d,
      privacyIn(`tracking`, [{ name: `state`, value: `off` }])
    );

    expect(replies[0]?.embed?.title).toBe(`Tracking is off`);
  });

  it(`reports the current setting when given no state`, async () => {
    // WHY: "what is my setting" is a question worth answering without having
    // to change it to find out.
    const { deps: d, replies } = deps(null);
    await handleCommand(d, privacyIn(`tracking`));

    expect(replies[0]?.embed?.title).toBe(`Tracking is on`);
  });
});

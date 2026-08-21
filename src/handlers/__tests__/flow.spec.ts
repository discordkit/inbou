import { describe, expect, it } from "vitest";
import type { DiscordEffects } from "../discord.js";
import { DEFAULT_SETTINGS } from "../quiz/config.js";
import {
  handleAnswer,
  handleTimeout,
  startSession,
  type FlowDeps,
  type SessionPort
} from "../quiz/flow.js";
import { begin, type SessionActor } from "../quiz/machine.js";
import type { Word } from "../quiz/question.js";

/**
 * A round, driven end to end without Discord.
 *
 * The flow depends on `DiscordEffects` and `SessionPort` rather than on the
 * client and the Durable Object, so the whole thing runs in plain Node against
 * a recording stub. No token, no network, no workerd — which is the point of
 * drawing the boundary there.
 *
 * The session stub is the real XState machine, not a fake: the rules are what
 * the flow is coordinating, and stubbing them would leave the coordination
 * untested against how the session actually behaves.
 */

/** Records what the bot would have sent. */
const recorder = () => {
  const posts: { channelId: string; embed: unknown }[] = [];
  const says: { channelId: string; content: string }[] = [];
  const reactions: { messageId: string; emoji: string }[] = [];

  const discord: DiscordEffects = {
    post: async (channelId, embed) => {
      posts.push({ channelId, embed });
      return `msg-${String(posts.length)}`;
    },
    say: async (channelId, content) => {
      says.push({ channelId, content });
      return `msg-${String(says.length)}`;
    },
    react: async (_channelId, messageId, emoji) => {
      reactions.push({ messageId, emoji });
    },
    reply: async () => undefined
  };

  return { discord, posts, says, reactions };
};

/** The machine behind a `SessionPort`, standing in for the Durable Object. */
const sessionStub = (): SessionPort & { timeout: () => void } => {
  let actor: SessionActor | null = null;

  return {
    begin: async (channelId, question, config, filters) => {
      actor = begin(channelId, question, config, filters, Date.now());
    },
    current: async () => {
      if (actor === null) return null;
      const snapshot = actor.getSnapshot();
      return {
        state: snapshot.value,
        context: snapshot.context
      };
    },
    submit: async (userId, typed, correct) => {
      if (actor === null) {
        return { outcome: { kind: `ignored` }, needsNext: false };
      }
      const before = actor.getSnapshot();
      if (before.value !== `asking`) {
        return { outcome: { kind: `ignored` }, needsNext: false };
      }
      if (before.context.attempts.some((a) => a.userId === userId)) {
        return { outcome: { kind: `ignored` }, needsNext: false };
      }

      const closing = before.context.question;
      actor.send({ type: `ANSWER`, userId, typed, correct, now: Date.now() });
      const after = actor.getSnapshot();

      if (!correct) return { outcome: { kind: `wrong` }, needsNext: false };
      const over = after.value === `finished`;
      return {
        outcome: { kind: `correct`, userId },
        ...(closing === null ? {} : { closed: closing }),
        ...(over
          ? {
              final: Object.entries(after.context.scores).map(
                ([id, points]) => ({ userId: id, points })
              )
            }
          : {}),
        needsNext: !over
      };
    },
    timeout: () => {
      actor?.send({ type: `TIMEOUT` });
    },
    next: async (question) => {
      actor?.send({ type: `NEXT`, question, now: Date.now() });
    },
    configure: async (settings) => {
      actor?.send({
        type: `CONFIGURE`,
        config: settings.session,
        filters: settings.filters
      });
    },
    end: async () => {
      if (actor === null) return null;
      actor.send({ type: `END` });
      return Object.entries(actor.getSnapshot().context.scores).map(
        ([userId, points]) => ({ userId, points })
      );
    }
  };
};

const uru: Word = {
  id: `1`,
  kana: `うる`,
  kanji: `売る`,
  pos: `v5r`,
  type: `verb`,
  verbClass: `godan-r`,
  jlpt: 5,
  gloss: `to sell`
};

const taberu: Word = {
  id: `2`,
  kana: `たべる`,
  kanji: `食べる`,
  pos: `v1`,
  type: `verb`,
  verbClass: `ichidan`,
  jlpt: 5,
  gloss: `to eat`
};

const deps = (words: readonly Word[] = [uru]) => {
  const rec = recorder();
  const session = sessionStub();
  return { ...rec, session, words, random: () => 0 } satisfies FlowDeps & {
    session: { timeout: () => void };
  };
};

describe(`starting a session`, () => {
  it(`posts the first question`, async () => {
    const d = deps();
    const started = await startSession(d, `chan`, DEFAULT_SETTINGS);

    expect(started).toBe(true);
    expect(d.posts).toHaveLength(1);
    expect(JSON.stringify(d.posts[0]?.embed)).toContain(`Question 1 of 10`);
  });

  it(`tells the channel when the filters match nothing`, async () => {
    // WHY: some combinations really are empty — N4 with ぬ-verbs has no words.
    // Failing silently would look like the bot ignoring the command, and only
    // the player can fix it.
    const d = deps([]);
    const started = await startSession(d, `chan`, DEFAULT_SETTINGS);

    expect(started).toBe(false);
    expect(d.posts).toHaveLength(0);
    expect(d.says[0]?.content).toContain(`No words match`);
  });
});

describe(`answering`, () => {
  it(`marks a wrong guess and says nothing else`, async () => {
    // WHY: the explanation waits for the reveal, so the players still thinking
    // are not handed the answer. A ❌ says "not that" without saying what.
    const d = deps();
    await startSession(d, `chan`, DEFAULT_SETTINGS);
    // Shares the stem with the answer, so it reads as a real attempt.
    await handleAnswer(d, `chan`, `m1`, `drake`, `うった`);

    expect(d.reactions).toEqual([{ messageId: `m1`, emoji: `❌` }]);
    // Only the original question; no reveal yet.
    expect(d.posts).toHaveLength(1);
  });

  it(`marks a correct guess and reveals the answer`, async () => {
    const d = deps([uru, taberu]);
    await startSession(d, `chan`, DEFAULT_SETTINGS);
    await handleAnswer(d, `chan`, `m1`, `mika`, `うる`);

    expect(d.reactions).toEqual([{ messageId: `m1`, emoji: `⭕` }]);
    const reveal = JSON.stringify(d.posts[1]?.embed);
    expect(reveal).toContain(`<@mika>`);
    expect(reveal).toContain(`うる`);
  });

  it(`accepts the answer in kanji`, async () => {
    // WHY: the scorer accepts kanji, and the flow has to pass it the kanji
    // spelling for that to work. A mismatch here would reject correct answers
    // with nothing in the logs.
    const d = deps([uru, taberu]);
    await startSession(d, `chan`, DEFAULT_SETTINGS);
    await handleAnswer(d, `chan`, `m1`, `mika`, `売る`);

    expect(d.reactions[0]?.emoji).toBe(`⭕`);
  });

  it(`ignores a second guess from the same player`, async () => {
    // WHY: one guess each. Reacting twice would suggest the second was counted.
    const d = deps();
    await startSession(d, `chan`, DEFAULT_SETTINGS);
    await handleAnswer(d, `chan`, `m1`, `drake`, `うった`);
    await handleAnswer(d, `chan`, `m2`, `drake`, `うる`);

    expect(d.reactions).toHaveLength(1);
  });

  it(`ignores messages when the channel is not playing`, async () => {
    // WHY: every message in an active channel reaches this. A channel with no
    // session must cost nothing and must not throw.
    const d = deps();
    await handleAnswer(d, `chan`, `m1`, `drake`, `うる`);

    expect(d.reactions).toHaveLength(0);
    expect(d.posts).toHaveLength(0);
  });

  it(`asks the next question after a correct answer`, async () => {
    const d = deps([uru, taberu]);
    await startSession(d, `chan`, DEFAULT_SETTINGS);
    await handleAnswer(d, `chan`, `m1`, `mika`, `うる`);

    // question 1, reveal, question 2
    expect(d.posts).toHaveLength(3);
    expect(JSON.stringify(d.posts[2]?.embed)).toContain(`Question 2 of 10`);
  });

  it(`draws later questions from the session's own filters`, async () => {
    // WHY: the session hibernates between questions, so the filters have to be
    // stored with it. Regenerating from empty filters would silently ignore the
    // level the channel chose — question one N5, question two anything.
    // The N1 word goes FIRST, because `random: () => 0` always picks index
    // zero. With the order reversed the test would pass whether or not the
    // filters were applied — selection order would decide it, not filtering.
    const n1: Word = { ...taberu, id: `3`, jlpt: 1 };
    const d = deps([n1, uru]);
    await startSession(d, `chan`, DEFAULT_SETTINGS);
    await handleAnswer(d, `chan`, `m1`, `mika`, `うる`);

    // Only `uru` is N5, so both questions must be it — never the N1 word.
    // Asserted on the class rather than the prompt, because the prompt is
    // whatever form was chosen (うります for the polite non-past) and would
    // couple this test to that choice.
    const second = JSON.stringify(d.posts[2]?.embed);
    expect(second).toContain(`Godan (-る)`);
    expect(second).not.toContain(`Ichidan`);
  });

  it(`posts the standings on the last question`, async () => {
    const d = deps();
    await startSession(d, `chan`, {
      ...DEFAULT_SETTINGS,
      session: { ...DEFAULT_SETTINGS.session, length: 1 }
    });
    await handleAnswer(d, `chan`, `m1`, `mika`, `うる`);

    const last = JSON.stringify(d.posts.at(-1)?.embed);
    expect(last).toContain(`Session complete`);
    expect(last).toContain(`<@mika>`);
  });
});

describe(`timing out`, () => {
  it(`reveals the answer and asks the next question`, async () => {
    const d = deps([uru, taberu]);
    await startSession(d, `chan`, DEFAULT_SETTINGS);
    d.session.timeout();
    await handleTimeout(d, `chan`);

    const reveal = JSON.stringify(d.posts[1]?.embed);
    expect(reveal).toContain(`Nobody got it in time`);
    expect(JSON.stringify(d.posts[2]?.embed)).toContain(`Question 2`);
  });

  it(`still reveals and posts standings on the LAST question`, async () => {
    // WHY: this shipped broken. On the last question the machine runs straight
    // from `asking` to `finished`, skipping `revealing` — so a handler that
    // required `revealing` dropped both the final reveal and the standings, and
    // the session just stopped with no explanation in the channel.
    const d = deps();
    await startSession(d, `chan`, {
      ...DEFAULT_SETTINGS,
      session: { ...DEFAULT_SETTINGS.session, length: 1 }
    });
    d.session.timeout();
    await handleTimeout(d, `chan`);

    const posted = d.posts.map((p) => JSON.stringify(p.embed)).join(`
`);
    expect(posted).toContain(`Nobody got it in time`);
    expect(posted).toContain(`Session complete`);
  });
});

describe(`side chatter`, () => {
  it(`ignores messages that are not aimed at the question`, async () => {
    // WHY: every message in the channel reaches the handler. Scoring chatter
    // took a ❌ and burned an attempt, which made the race hostile to talking.
    const d = deps();
    await startSession(d, `chan`, DEFAULT_SETTINGS);
    await handleAnswer(d, `chan`, `m1`, `drake`, `lol same`);
    await handleAnswer(d, `chan`, `m2`, `drake`, `がんばって`);

    expect(d.reactions).toHaveLength(0);
    // Still only the question; nothing was revealed or advanced.
    expect(d.posts).toHaveLength(1);
  });

  it(`still scores a real attempt from the same player afterwards`, async () => {
    // WHY: ignoring chatter must not cost the player their attempts.
    const d = deps([uru, taberu]);
    await startSession(d, `chan`, DEFAULT_SETTINGS);
    await handleAnswer(d, `chan`, `m1`, `drake`, `lol same`);
    await handleAnswer(d, `chan`, `m2`, `drake`, `うる`);

    expect(d.reactions).toEqual([{ messageId: `m2`, emoji: `⭕` }]);
  });
});

import { describe, expect, it } from "vitest";
import { judge, looksLikeAnswer, normalize } from "../quiz/answer.js";

/** 売らない, the plain non-past negative of 売る — the worked example in the spec. */
const URANAI = { kana: `うらない`, kanji: `売らない` };

describe(`judge: the four ways to write one answer`, () => {
  // WHY: a club types on mixed keyboard setups. Rejecting any of these
  // spellings excludes real members from playing at all, which matters more
  // here than in a web app where the input field does the converting.
  it.each([`うらない`, `売らない`, `ウラナイ`, `uranai`])(
    `accepts %s`,
    (input) => {
      expect(judge(input, URANAI).correct).toBe(true);
    }
  );

  // WHY: the whole point is testing which form the player produced. If folding
  // were loose enough to accept a neighbouring form, the quiz would stop
  // measuring anything.
  it.each([`売らなかった`, `売った`, `売ります`, `うる`])(
    `rejects %s, a different conjugation of the same verb`,
    (wrong) => {
      expect(judge(wrong, URANAI).correct).toBe(false);
    }
  );

  it(`does not accept the kanji surface when folded as if it were kana`, () => {
    // WHY: kanji must match the surface exactly, not via the fold — a kanji
    // carries a reading its characters do not spell. Comparing 呼ばなかった
    // through toHiragana leaves 呼 untouched, so it can only ever match the
    // kanji branch.
    const yobanakatta = { kana: `よばなかった`, kanji: `呼ばなかった` };
    expect(judge(`呼ばなかった`, yobanakatta).correct).toBe(true);
    expect(judge(`よばなかった`, yobanakatta).correct).toBe(true);
    // A different kanji with the same okurigana is still wrong.
    expect(judge(`飛ばなかった`, yobanakatta).correct).toBe(false);
  });

  it(`accepts a kana-only word with no kanji surface`, () => {
    // WHY: many words (ある, きれい) have no kanji spelling in play. The
    // optional `kanji` must not make those unanswerable.
    expect(judge(`ない`, { kana: `ない` }).correct).toBe(true);
    expect(judge(`nai`, { kana: `ない` }).correct).toBe(true);
  });
});

describe(`normalize: what a chat message adds`, () => {
  it(`strips whitespace anywhere in the answer`, () => {
    // WHY: Japanese does not write word boundaries, so a space inside an
    // answer is always noise — someone reaching for a space bar out of habit,
    // or a phone inserting one. Collapsing rather than removing would leave
    // "うら ない" unequal to "うらない".
    expect(judge(`うら ない`, URANAI).correct).toBe(true);
    expect(judge(`  うらない  `, URANAI).correct).toBe(true);
  });

  it(`strips trailing sentence punctuation but not internal characters`, () => {
    // WHY: people end messages with a full stop. Nothing in a conjugation
    // ends on one, so trailing punctuation is safe to drop — but stripping it
    // anywhere would corrupt answers, so the anchor matters.
    expect(judge(`うらない。`, URANAI).correct).toBe(true);
    expect(judge(`うらない!`, URANAI).correct).toBe(true);
    expect(normalize(`う。らない`)).toBe(`う。らない`);
  });

  it(`folds full-width input onto ASCII`, () => {
    // WHY: a Japanese IME produces full-width letters when typing romaji in
    // some modes. Without NFKC those never reach the romaji branch and a
    // correct answer reads as wrong.
    expect(judge(`ｕｒａｎａｉ`, URANAI).correct).toBe(true);
  });
});

describe(`judge: romaji conversion edge cases`, () => {
  it(`handles the ambiguities a naive romaji table gets wrong`, () => {
    // WHY: these are exactly the cases the spec flagged as needing real
    // handling. Each one is a place where a hand-rolled mapping produces the
    // wrong kana and silently marks a correct answer wrong.
    // ん before a consonant, and the doubled-n spelling of the same. wanakana
    // reads `nn` as two ん, but every Japanese IME treats it as the way to
    // commit a single one — so someone trained on an IME types `yonnda` by
    // reflex and must not be marked wrong for it.
    expect(judge(`yonda`, { kana: `よんだ` }).correct).toBe(true);
    expect(judge(`yonnda`, { kana: `よんだ` }).correct).toBe(true);
    expect(judge(`shinnbun`, { kana: `しんぶん` }).correct).toBe(true);
    // But a real んな must survive: collapsing it would turn 帰んなさい into
    // 帰なさい and reject a correct answer.
    expect(judge(`onnaji`, { kana: `おんなじ` }).correct).toBe(true);
    // shi / si both reach し.
    expect(judge(`hanashite`, { kana: `はなして` }).correct).toBe(true);
    expect(judge(`hanasite`, { kana: `はなして` }).correct).toBe(true);
    // A doubled consonant is the small っ.
    expect(judge(`katta`, { kana: `かった` }).correct).toBe(true);
    // Long vowels written out.
    expect(judge(`toukyou`, { kana: `とうきょう` }).correct).toBe(true);
  });

  it(`reports what the answer folded to, for the teaching embed`, () => {
    // WHY: the round-end embed shows each player's attempt. Showing the raw
    // romaji would be less useful than the kana they meant, and the embed is
    // where the learning happens.
    expect(judge(`uranai`, URANAI).normalized).toBe(`うらない`);
    expect(judge(`URANAI`, URANAI).normalized).toBe(`うらない`);
  });
});

describe(`looksLikeAnswer: telling an attempt from conversation`, () => {
  // 売る → 売らない. Every conjugation keeps うら-, or at minimum う-.
  const uranai = { kana: `うらない`, kanji: `売らない`, stem: `う` };

  it(`accepts a wrong guess that is clearly aimed at the question`, () => {
    // WHY: a near miss is still an attempt and should be scored. Ignoring it
    // would leave the player wondering whether the bot saw them at all.
    const rejected = [
      `うらなかった`,
      `うった`,
      `うります`,
      `売らなかった`
    ].filter((guess) => !looksLikeAnswer(guess, uranai));
    expect(rejected).toEqual([]);
  });

  it(`ignores ordinary conversation`, () => {
    // WHY: every message in the channel reaches the handler. Before this,
    // chatter took a ❌ and burned an attempt — the race is meant to happen
    // alongside the conversation, not instead of it.
    const scored = [
      `lol same`,
      `がんばって`,
      `I have no idea`,
      `?`,
      `🎉`,
      ``
    ].filter((chatter) => looksLikeAnswer(chatter, uranai));
    expect(scored).toEqual([]);
  });

  it(`always accepts the correct answer, however short the stem`, () => {
    // WHY: a one-mora word shares almost nothing with its stem. Rejecting a
    // right answer for being too short would be the worst possible failure.
    expect(looksLikeAnswer(`した`, { kana: `した`, stem: `す` })).toBe(true);
  });

  it(`accepts romaji aimed at the question`, () => {
    // WHY: romaji support exists so members without a kana keyboard can play.
    // The plausibility test folds the same way the scorer does, so it must not
    // quietly exclude them.
    expect(looksLikeAnswer(`uranai`, uranai)).toBe(true);
    expect(looksLikeAnswer(`urimasu`, uranai)).toBe(true);
  });
});

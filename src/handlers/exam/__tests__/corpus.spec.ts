import { readdirSync, readFileSync } from "node:fs";
import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";
import { parse } from "yaml";
import corpus from "../corpus.json" with { type: "json" };
import {
  composeQuestion,
  formQuestion,
  passageQuestions,
  type ExamQuestion
} from "../draw.js";
import {
  chunksOf,
  corpusProblems,
  display,
  grammarPointsSchema,
  itemProblems,
  itemsSchema,
  WINDOW_SIZE,
  type Item,
  type Slot
} from "../items.js";
import { LABEL_MAX, questionMessage, revealMessage } from "../render.js";

/**
 * The whole corpus, every run.
 *
 * `exam:build` runs the same checks, but only when someone runs it. This makes
 * them part of `vp test`, so a hand edit to the YAML or a stale corpus.json
 * fails CI rather than reaching a channel. Read from the repository root,
 * which is Vitest's working directory.
 */

const ROOT = `data/jlpt/n5`;
const read = (path: string): unknown => parse(readFileSync(path, `utf8`));

const points = v.parse(
  grammarPointsSchema,
  read(`${ROOT}/grammar-points.yaml`)
);
const pointIds = new Set(points.map((point) => point.id));
const items = readdirSync(`${ROOT}/bunpou`)
  .filter((file) => file.endsWith(`.yaml`))
  .sort()
  .flatMap((file) => v.parse(itemsSchema, read(`${ROOT}/bunpou/${file}`)));

/** Discord's limits on one Components V2 message. */
const COMPONENTS_MAX = 40;
const TEXT_MAX = 4000;

/** Every component in a message, and all its text. */
const measure = (message: unknown): { components: number; text: number } => {
  let components = 0;
  let text = 0;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
    } else if (typeof node === `object` && node !== null) {
      const record = node as Record<string, unknown>;
      if (typeof record.type === `number`) components += 1;
      if (typeof record.content === `string`) text += record.content.length;
      walk(record.components);
    }
  };
  walk(message);
  return { components, text };
};

/** A slot whose pool holds only its three longest wrong options. */
const longestPool = (slot: Slot): Slot => ({
  ...slot,
  wrong: [...slot.wrong].sort((a, b) => b.length - a.length).slice(0, 3)
});

/** Pinned: these lengths do not depend on the draw. */
const zero = (): number => 0;

/**
 * Every question an item can produce, at its longest, through the real draw.
 *
 * Each pool is cut to its three longest options, and a passage asks every one
 * of its blanks, so every question here is as long as any draw could make it.
 * If these fit, every draw fits.
 */
const longestQuestions = (item: Item): ExamQuestion[] => {
  switch (item.type) {
    case `form`: {
      const longest = { ...item, slots: item.slots.map(longestPool) };
      return item.slots.map((_, index) =>
        formQuestion(longest, index, 99, zero)
      );
    }
    case `compose`:
      return item.windows.map((_, index) =>
        composeQuestion(item, index, 99, zero)
      );
    case `passage`: {
      const longest = { ...item, blanks: item.blanks.map(longestPool) };
      return passageQuestions(longest, item.blanks.length, 90, zero);
    }
  }
};

/** Every option an item can offer, whatever the draw. */
const optionsOf = (item: Item): string[] => {
  switch (item.type) {
    case `form`:
      return item.slots.flatMap((slot) => [slot.answer, ...slot.wrong]);
    case `passage`:
      return item.blanks.flatMap((slot) => [slot.answer, ...slot.wrong]);
    case `compose`: {
      const chunks = chunksOf(item.sentence);
      return item.windows.flatMap((window) =>
        chunks
          .slice(window.start, window.start + WINDOW_SIZE)
          .map((chunk) => chunk.text)
      );
    }
  }
};

describe(`the mock-test corpus`, () => {
  it(`has items to check`, () => {
    // WHY: a glob that matched nothing would pass every check below vacuously.
    expect(items.length).toBeGreaterThan(0);
  });

  it(`passes every mechanical check, drafts included`, () => {
    // WHY: a draft with a broken blank is a problem now, not when it is
    // reviewed. The list names every problem, so one run shows them all.
    const problems = [
      ...corpusProblems(items),
      ...items.flatMap((item) => itemProblems(item, pointIds))
    ];
    expect(problems).toEqual([]);
  });

  it(`renders every card inside Discord's limits`, () => {
    // WHY: Discord rejects the whole message over a limit, and the question
    // is lost mid-test. Checked on the longest variant of every slot and
    // window, and on each passage as one card with every blank asked.
    const tally = { counts: [9, 9, 9, 9], correct: 0, scorers: [] };
    const over: string[] = [];
    for (const item of items) {
      const questions = longestQuestions(item);
      const cards =
        item.type === `passage` ? [questions] : questions.map((q) => [q]);
      for (const card of cards) {
        for (const message of [
          questionMessage({
            questions: card,
            total: 99,
            endsAt: 1_700_000_000
          }),
          revealMessage(card.map((question) => ({ question, tally })))
        ]) {
          const { components, text } = measure(message);
          if (components > COMPONENTS_MAX)
            over.push(`${item.id}: ${String(components)} components`);
          if (text > TEXT_MAX)
            over.push(`${item.id}: ${String(text)} characters`);
        }
      }
    }
    expect(over).toEqual([]);
  });

  it(`never needs to trim an option to fit its button`, () => {
    // WHY: the renderer trims a long label with "…", which keeps Discord
    // happy but could hide the very difference between two options. So no
    // option may be long enough to be trimmed. "4 " is the number prefix.
    const long = items.flatMap((item) =>
      optionsOf(item)
        .filter((option) => `4 ${display(option)}`.length > LABEL_MAX)
        .map((option) => `${item.id}: ${option}`)
    );
    expect(long).toEqual([]);
  });

  it(`ships exactly the reviewed items, as the source says`, () => {
    // WHY: corpus.json is built by hand and committed. If someone edits the
    // YAML and forgets the build, the channel keeps asking the old item — or
    // a `--drafts` preview gets committed and unreviewed items go live.
    expect(corpus.drafts).toBe(false);
    expect(corpus.items).toEqual(
      items.filter((item) => item.status === `reviewed`)
    );
  });
});

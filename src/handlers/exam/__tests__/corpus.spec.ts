import { readdirSync, readFileSync } from "node:fs";
import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";
import { parse } from "yaml";
import { pictureName, versionsOf } from "../../../../scripts/lib/pictures.mjs";
import { BLUEPRINTS } from "../blueprint.js";
import corpus from "../corpus.json" with { type: "json" };
import {
  composeQuestion,
  formQuestion,
  passageQuestions,
  readingQuestions,
  reviewOf,
  type ExamQuestion
} from "../draw.js";
import { materialHtml, materialWidth } from "../material/index.js";
import {
  bare,
  chunksOf,
  corpusProblems,
  display,
  fill,
  grammarPointsSchema,
  itemProblems,
  itemsSchema,
  materialMarkup,
  optionText,
  reviewLinksOf,
  WINDOW_SIZE,
  type InfoItem,
  type Item,
  type Slot
} from "../items.js";
import {
  CONTENT_MAX,
  followUpText,
  LABEL_MAX,
  questionMessage,
  revealMessage
} from "../render.js";

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
const items = [`bunpou`, `dokkai`].flatMap((deck) =>
  readdirSync(`${ROOT}/${deck}`)
    .filter((file) => file.endsWith(`.yaml`))
    .sort()
    .flatMap((file) => v.parse(itemsSchema, read(`${ROOT}/${deck}/${file}`)))
);

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

/** How many blanks a test asks of its passage. */
const ASKED = BLUEPRINTS.bunpou.find((plan) => plan.mondai === 3)?.blanks ?? 4;

/** Every way to choose `size` entries of `list`, each in list order. */
const choices = <T>(list: readonly T[], size: number): T[][] =>
  size === 0
    ? [[]]
    : list.flatMap((first, index) =>
        choices(list.slice(index + 1), size - 1).map((rest) => [first, ...rest])
      );

/**
 * Every card an item can produce, at its longest, through the real draw.
 *
 * Each pool is cut to its three longest options, so every question here is as long as any draw could make it. A passage makes one card for each set of blanks a test could ask, with the rest filled in, as the card shows them. If these fit, every draw fits.
 */
const longestCards = (item: Item): ExamQuestion[][] => {
  switch (item.type) {
    case `form`: {
      const longest = { ...item, slots: item.slots.map(longestPool) };
      return item.slots.map((_, index) => [
        formQuestion(longest, index, 99, zero)
      ]);
    }
    case `compose`:
      return item.windows.map((_, index) => [
        composeQuestion(item, index, 99, zero)
      ]);
    case `passage`: {
      const blanks = item.blanks.map(longestPool);
      const slots = blanks.map((_, index) => index + 1);
      return choices(slots, Math.min(ASKED, slots.length)).map((asked) =>
        passageQuestions(
          {
            ...item,
            // The asked blanks, renumbered; every other blank filled in.
            text: fill(
              item.text,
              new Map(
                slots.map((slot) => [
                  slot,
                  asked.includes(slot)
                    ? `（${String(asked.indexOf(slot) + 1)}）`
                    : (blanks[slot - 1]?.answer ?? ``)
                ])
              )
            ),
            blanks: asked.flatMap((slot) => blanks.slice(slot - 1, slot))
          },
          asked.length,
          90,
          zero
        )
      );
    }
    // Each question alone, or for 問題5 every pair a test could ask, in text order.
    case `short`:
    case `mid`:
    case `info`: {
      const longest = {
        ...item,
        questions: item.questions.map((question) =>
          `wrong` in question
            ? {
                ...question,
                wrong: [...question.wrong]
                  .sort((a, b) => optionText(b).length - optionText(a).length)
                  .slice(0, 3)
              }
            : question
        )
      };
      const indices = item.questions.map((_, index) => index);
      const sets =
        item.type === `mid`
          ? choices(indices, 2)
          : indices.map((index) => [index]);
      return sets.map((asked) =>
        readingQuestions(longest, asked, 1, zero).map((question) =>
          // As shipped: the picture hosted, its text in the alt and the readings line.
          question.material === undefined
            ? question
            : { ...question, image: `https://assets.example/${item.id}.webp` }
        )
      );
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
    // Reading options sit in the card, not on the buttons, which show only the number.
    case `short`:
    case `mid`:
    case `info`:
      return [];
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

  it(`writes every word of every picture into its alt text`, () => {
    // WHY: the alt text is the picture for a student who cannot see it, and
    // the readings line under the picture is built from it. A field that a
    // template draws but the alt text leaves out could hold the answer, and its
    // kanji would get no reading. Walks the data, so a new kind is covered the
    // day its first item exists.
    const notText = new Set([
      `kind`,
      `tone`,
      `icon`,
      `variant`,
      `mode`,
      `sky`,
      `arrow`
    ]);
    const texts = (value: unknown, key = ``): string[] => {
      if (typeof value === `string`) {
        return notText.has(key) || value === `` ? [] : [value];
      }
      if (Array.isArray(value))
        return value.flatMap((entry) => texts(entry, key));
      if (typeof value === `object` && value !== null) {
        return Object.entries(value).flatMap(([name, entry]) =>
          texts(entry, name)
        );
      }
      return [];
    };
    const missing = items.flatMap((item) => {
      if (item.type !== `info`) return [];
      const alt = materialMarkup(item.material);
      return texts(item.material)
        .filter((text) => !alt.includes(text))
        .map((text) => `${item.id}: ${text}`);
    });
    expect(missing).toEqual([]);
  });

  it(`renders every card inside Discord's limits`, () => {
    // WHY: Discord rejects the whole message over a limit, and the question
    // is lost mid-test. Checked on the longest variant of every slot and
    // window, and on every set of four blanks a passage card can ask.
    const tally = { counts: [9, 9, 9, 9], correct: 0, scorers: [] };
    const over: string[] = [];
    // Drafts included, so a draft's links are measured before it ships.
    const links = reviewLinksOf(points, items);
    for (const item of items) {
      const cards = longestCards(item).map((card) =>
        card.map((question) => ({
          ...question,
          review: reviewOf(question.points, links)
        }))
      );
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

  it(`closes every reading card while its voters' reply tokens still work`, () => {
    // WHY: a student's private why is sent on the token of their vote, and a token works for 15 minutes. A card open longer would reach its reveal with dead tokens, and the whys would silently go nowhere. One minute is kept back for the reveal itself.
    const TOKEN_LIFE_MS = 15 * 60_000;
    const long = items.flatMap((item) =>
      longestCards(item)
        .filter((card) => card.some((question) => question.mondai >= 4))
        .map((card) => ({
          id: item.id,
          ms: card.reduce((sum, question) => sum + question.timeoutMs, 0)
        }))
        .filter(({ ms }) => ms > TOKEN_LIFE_MS - 60_000)
        .map(({ id, ms }) => `${id}: ${String(ms / 1000)} s`)
    );
    expect(long).toEqual([]);
  });

  it(`fits every private follow-up in one message`, () => {
    // WHY: Discord rejects a follow-up over 2,000 characters, and the student would hear nothing. Measured at the worst a card can do: every question on it answered wrong, with its longest why.
    const over = items.flatMap((item) =>
      longestCards(item).flatMap((card) => {
        const picks = card.flatMap((question) => {
          const longestWhy = (question.whys ?? []).reduce(
            (best, why, index) =>
              why.length > (question.whys?.at(best)?.length ?? 0)
                ? index
                : best,
            0
          );
          return longestWhy === question.correct
            ? []
            : [{ question, chose: longestWhy }];
        });
        const text = followUpText(picks) ?? ``;
        return text.length > CONTENT_MAX
          ? [`${item.id}: ${String(text.length)} characters`]
          : [];
      })
    );
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

  it(`names every reviewed picture as its template draws it today`, () => {
    // WHY: a card links its picture by the name in corpus.json, and the draw writes the file under the name the template gives now. A template, font or material changed without a rebuild would link a picture nobody drew: a broken image in the middle of a test.
    const versions = versionsOf(process.cwd());
    expect(corpus.pictures).toEqual(
      Object.fromEntries(
        items
          .filter(
            (item): item is InfoItem =>
              item.type === `info` && item.status === `reviewed`
          )
          .map((item) => [
            item.id,
            pictureName(
              item.id,
              materialHtml(item.material, bare),
              materialWidth(item.material),
              versions
            )
          ])
      )
    );
  });

  it(`ships the review link of every point in use, as the source says`, () => {
    // WHY: the links are built into corpus.json too. A page added or fixed in grammar-points.yaml without a rebuild would leave students with a missing or broken link.
    expect(corpus.review).toEqual(
      reviewLinksOf(
        points,
        items.filter((item) => item.status === `reviewed`)
      )
    );
  });
});

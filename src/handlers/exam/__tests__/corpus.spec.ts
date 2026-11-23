import { readdirSync, readFileSync } from "node:fs";
import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";
import { parse } from "yaml";
import { pictureName, versionsOf } from "../../../../scripts/lib/pictures.mjs";
import { BLUEPRINTS, type MixPlan, type PassagePlan } from "../blueprint.js";
import corpus from "../corpus.json" with { type: "json" };
import {
  composeQuestion,
  drawTest,
  formQuestion,
  passageQuestions,
  readingQuestions,
  reviewOf,
  vocabQuestion,
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
  isVocab,
  itemProblems,
  itemsSchema,
  materialMarkup,
  optionText,
  reviewLinksOf,
  vocabListSchema,
  whyOf,
  WINDOW_SIZE,
  wordProblems,
  type InfoItem,
  type Item,
  type Slot,
  type VocabItem
} from "../items.js";
import {
  CONTENT_MAX,
  followUpText,
  LABEL_MAX,
  myResultsPages,
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
const items = [`bunpou`, `dokkai`, `goi`].flatMap((deck) =>
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
const ASKED =
  BLUEPRINTS.bunpou.find((plan): plan is PassagePlan => plan.type === `passage`)
    ?.blanks ?? 4;

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
    case `kanji`:
    case `spelling`:
    case `context`:
    case `paraphrase`:
      return [[vocabQuestion(longestVocab(item), 99, zero)]];
  }
};

/** A vocabulary item whose pool holds only its three longest wrong options, whys included. */
const longestVocab = (item: VocabItem): VocabItem => ({
  ...item,
  wrong: [...item.wrong]
    .sort(
      (a, b) =>
        optionText(b).length +
        (whyOf(b) ?? ``).length -
        optionText(a).length -
        (whyOf(a) ?? ``).length
    )
    .slice(0, 3)
});

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
    // Reading options sit in the card, not on the buttons, which show only the number; so do 言い換え's sentences.
    case `short`:
    case `mid`:
    case `info`:
    case `paraphrase`:
      return [];
    case `kanji`:
    case `spelling`:
    case `context`:
      return [item.answer, ...item.wrong.map(optionText)];
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

  it(`checks every 漢字読み and 表記 word against the N5 word list`, () => {
    // WHY: the trap a reviewer misses most is an option that is wrong here but right somewhere: 大人 read だいにん, はし written 箸. The list, built from JMdict by `exam:vocab`, sees every reading and every N5 and N4 homophone, so a draft is caught before review.
    const list = v.parse(
      vocabListSchema,
      JSON.parse(readFileSync(`data/jlpt/vocab.json`, `utf8`))
    );
    expect(list.words.length).toBeGreaterThan(1000);
    expect(wordProblems(items, list)).toEqual([]);
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

  it(`closes every card that explains while its voters' reply tokens still work`, () => {
    // WHY: a student's private why is sent on the token of their vote, and a token works for 15 minutes. A card open longer would reach its reveal with dead tokens, and the whys would silently go nowhere. One minute is kept back for the reveal itself.
    const TOKEN_LIFE_MS = 15 * 60_000;
    const long = items.flatMap((item) =>
      longestCards(item)
        .filter((card) => card.some((question) => question.whys !== undefined))
        .map((card) => ({
          id: item.id,
          ms: card.reduce((sum, question) => sum + question.timeoutMs, 0)
        }))
        .filter(({ ms }) => ms > TOKEN_LIFE_MS - 60_000)
        .map(({ id, ms }) => `${id}: ${String(ms / 1000)} s`)
    );
    expect(long).toEqual([]);
  });

  it(`gives grammar and reading together the real paper's 40 minutes`, () => {
    // WHY: /bunpou and /dokkai are the 22 questions of the real N5 grammar-and-reading section, which allows 40 minutes. Students practise to finish inside that limit (the user's aim, 2026-11-22): much less, and the test feels beyond them; much more, and they never learn the pace. Measured as the average over many draws, so a batch of longer texts that shifts it shows here.
    const shipped = items.filter((item) => item.status === `reviewed`);
    let state = 11;
    const random = (): number => {
      state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      return state / 4_294_967_296;
    };
    const RUNS = 300;
    const minutes = ([`bunpou`, `dokkai`] as const).reduce(
      (sum, test) =>
        sum +
        Array.from({ length: RUNS }, () =>
          drawTest(test, shipped, {}, random).reduce(
            (total, question) => total + question.timeoutMs,
            0
          )
        ).reduce((total, ms) => total + ms, 0) /
          RUNS /
          60_000,
      0
    );
    expect(minutes).toBeGreaterThan(38);
    expect(minutes).toBeLessThan(42);
  });

  it(`gives vocabulary the real paper's 20 minutes`, () => {
    // WHY: /goi is the real Section 1, 21 questions in 20 minutes, and students practise to finish inside it, as for Section 2. Measured over many draws of what students get, so a batch of longer sentences that shifts it shows here.
    const pool = items
      .filter(isVocab)
      .filter((item) => item.status === `reviewed`);
    let state = 7;
    const random = (): number => {
      state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      return state / 4_294_967_296;
    };
    const RUNS = 300;
    const perQuestion =
      Array.from({ length: RUNS }, () => {
        const test = drawTest(`goi`, pool, {}, random);
        return (
          test.reduce((total, question) => total + question.timeoutMs, 0) /
          test.length
        );
      }).reduce((total, ms) => total + ms, 0) / RUNS;
    // The paper's 21 questions at the drawn pace, so a deck still too small to fill a test is measured fairly.
    const minutes = (perQuestion * 21) / 60_000;
    expect(minutes).toBeGreaterThan(19);
    expect(minutes).toBeLessThan(21);
  });

  it(`fills every /goi test to the paper's 21 questions, give-away rule and all`, () => {
    // WHY: the draw leaves out any card whose options or notes would give another's answer away. Every look-alike, counter and note that names another item's answer narrows what can share a test, and enough of them would leave a deck short: students would sit fewer questions than the paper without anything looking wrong.
    const shipped = items.filter((item) => item.status === `reviewed`);
    let state = 3;
    const random = (): number => {
      state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      return state / 4_294_967_296;
    };
    const short = Array.from(
      { length: 300 },
      () => drawTest(`goi`, shipped, {}, random).length
    ).filter((length) => length < 21);
    expect(short).toEqual([]);
  });

  it(`sends My results for /goi in messages that each fit, however much a student misses`, () => {
    // WHY: My results keeps every missed question's why, because a private follow-up vanishes when Discord reloads; only links are dropped to fit. /goi asks 21 questions, and a student who missed most of a test can have more whys than one message holds: the first batch of /goi content came to 2,393 characters. Every message must fit, or Discord rejects it and the student sees nothing, and every why must arrive. Measured at the worst any draw could do: each deck's longest misses, through the real renderer.
    const plans = BLUEPRINTS.goi.filter(
      (plan): plan is MixPlan => `mix` in plan
    );
    const misses = plans.flatMap((plan) => {
      const asked = plan.mix[1] + plan.mix[2] + plan.mix[3];
      return items
        .filter((item) => item.type === plan.type)
        .filter(isVocab)
        .map((item) => {
          const question = vocabQuestion(longestVocab(item), 1, zero);
          // The wrong option with the longest why, or any wrong one when none has a why.
          const [worst] = question.options
            .map((option, index) => ({
              index,
              size: option.length + (question.whys?.at(index)?.length ?? 0)
            }))
            .filter(({ index }) => index !== question.correct)
            .sort((a, b) => b.size - a.size);
          const chose = worst?.index ?? 0;
          const size =
            (worst?.size ?? 0) +
            (question.options.at(question.correct)?.length ?? 0);
          return { question, chose, size };
        })
        .sort((a, b) => b.size - a.size)
        .slice(0, asked);
    });
    const questions = misses.map(({ question }, index) => ({
      ...question,
      number: index + 1
    }));
    const pages = myResultsPages(
      questions,
      misses.map(({ chose }, index) => ({
        number: index + 1,
        chose,
        correct: false,
        points: 0
      })),
      {
        userId: `ann`,
        points: 0,
        max: 99,
        correct: 0,
        asked: questions.length
      }
    );
    for (const page of pages) {
      expect(page.length).toBeLessThanOrEqual(CONTENT_MAX);
    }
    const all = pages.join(`\n`);
    for (const { question, chose } of misses) {
      const why = question.whys?.at(chose) ?? ``;
      if (why !== ``) expect(all).toContain(display(why));
    }
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

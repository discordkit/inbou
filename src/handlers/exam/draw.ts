import {
  BLUEPRINTS,
  READING_MIX,
  type Mix,
  type MixPlan,
  type Mondai,
  type PassagePlan,
  type ReadingPlan,
  type TestId
} from "./blueprint.js";
import {
  chunksOf,
  fill,
  joinChunks,
  materialMarkup,
  optionText,
  parse,
  partsOf,
  plain,
  whyOf,
  WINDOW_SIZE,
  type ComposeItem,
  type Difficulty,
  type FormItem,
  type InfoItem,
  type Item,
  type MidItem,
  type PassageItem,
  type ReadingQuestion,
  type ReviewLink,
  type ShortItem,
  type Slot
} from "./items.js";

/**
 * Drawing a mock test from the corpus.
 *
 * Each question type is a deck. A test draws a fixed number of cards from each
 * deck, at most once each, and nothing is remembered afterwards: every card is
 * back in its deck for the next test. Repeated exposure is the point, and the
 * random choices below — which distractors, where the ★ falls, which order —
 * keep a repeated card from looking identical.
 *
 * Pure, with the randomness injected, so a test can pin every choice.
 */

/** Injected so tests can pin every random choice. */
export type Random = () => number;

/** How many options every question offers, as on the paper. */
export const OPTION_COUNT = 4;

/** One question, fully resolved, as the session stores it. */
export interface ExamQuestion {
  /** The item it came from, for results and statistics. */
  itemId: string;
  /** Which slot, window or blank of the item was asked, 1-based. */
  slot: number;
  mondai: Mondai;
  /** 1-based, numbered straight through the test, as on the paper. */
  number: number;
  /**
   * Which card the question is shown on, named by the card's first question
   * number. Questions sharing a card open and close together — a passage's
   * blanks. Every other question has a card of its own.
   */
  card: number;
  /** Markup the card shows: a sentence with its blank, a ★ line, or a passage. */
  prompt: string;
  /** Markup the reveal shows: the answer in place, underlined. */
  answered: string;
  /** A passage's situation line, shown above it. */
  intro?: string;
  /** Markup, shuffled. */
  options: string[];
  /**
   * Where the right answer landed.
   *
   * Lives here and in the session, never in a button's `customId` — a client
   * can read those.
   */
  correct: number;
  difficulty: Difficulty;
  points: string[];
  /** The English, or `` for a passage question before its last. */
  en: string;
  note: string;
  /**
   * Where to read about the question's grammar, each page once.
   *
   * Optional because a test drawn before review links existed is stored without them, and may still be running when they deploy.
   */
  review?: ReviewLink[];
  /** Routes a vote to this exact question; a press on any other is stale. */
  token: string;
  timeoutMs: number;
  /**
   * A reading question's stem: 「ゆいさんは 何を しますか。」. Grammar has none, because its prompt is the question.
   */
  question?: string;
  /**
   * Why each option is wrong, in display order, as the item says: `` for the answer, and for an option the item does not explain. Reading only. Sent privately to a student who chose that option, never shown in the channel.
   */
  whys?: string[];
  /** 問題6: the picture's text, for its alt text, its readings line and its timer. */
  material?: string;
  /**
   * 問題6: where the picture is hosted. Until the picture pipeline sets it, the card shows the material as text.
   */
  image?: string;
}

/**
 * Time to answer, by type, before reading time is added.
 *
 * Open in the spec (section 10): first guesses to tune in play. 問題2 starts
 * higher because arranging takes longer than choosing; 問題3 lower because its
 * passage adds most of the time.
 */
export const BASE_MS: Readonly<Record<Mondai, number>> = {
  1: 40_000,
  2: 60_000,
  3: 30_000,
  // Reading: per question, and the text is read once per card on top.
  4: 30_000,
  5: 30_000,
  // A picture may need opening at full size before it can be read: the user's
  // condition for pictures taller than a chat window.
  6: 60_000
};

/** Reading time per character of text the player has to read. */
export const PER_CHAR_MS = 500;

/** How a ★ line shows its four blanks, with the star in one. */
const BLANK_LINE = `＿＿`;
const STAR_BLANK = `＿★＿`;

/** Fisher–Yates, on a copy. */
export const shuffle = <T>(items: readonly T[], random: Random): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
};

/** Six base-36 characters: enough to tell this test's questions apart. */
const tokenFrom = (random: Random): string =>
  Math.floor(random() * 36 ** 6)
    .toString(36)
    .padStart(6, `0`);

/**
 * How long a question stays open.
 *
 * A base per type plus time per character the player must read — the text and
 * all four options — so a long question gets longer. Rounded up to whole
 * seconds, which is all the countdown shows.
 */
export const timeoutFor = (
  mondai: Mondai,
  text: string,
  options: readonly string[]
): number => {
  const chars =
    plain(text).length +
    options.reduce((sum, option) => sum + plain(option).length, 0);
  return Math.ceil((BASE_MS[mondai] + chars * PER_CHAR_MS) / 1000) * 1000;
};

/** Underline each part of an answer: a pair (は／は) is two parts, two blanks. */
const underlined = (answer: string): string =>
  partsOf(answer)
    .map((part) => `__${part}__`)
    .join(`／`);

/** The answer and three wrong options drawn from the pool, shuffled. */
const optionsFor = (
  slot: Slot,
  random: Random
): { options: string[]; correct: number } => {
  const wrong = shuffle(slot.wrong, random).slice(0, OPTION_COUNT - 1);
  const options = shuffle([slot.answer, ...wrong], random);
  return { options, correct: options.indexOf(slot.answer) };
};

/** A question waiting to be drawn: one slot or window of one item. */
interface Card {
  item: Item;
  /** 0-based index into the item's slots or windows. */
  index: number;
  difficulty: Difficulty;
  points: readonly string[];
}

/** A deck whose cards are drawn one by one, by difficulty. */
type DeckMondai = MixPlan[`mondai`] | 4 | 6;

/**
 * 問題1's cards are slots; 問題2's are windows; 問題4's and 問題6's are the questions of their texts and pictures.
 */
const cardsOf = (items: readonly Item[], mondai: DeckMondai): Card[] =>
  items.flatMap((item): Card[] => {
    const units: ReadonlyArray<{
      difficulty: Difficulty;
      points?: readonly string[];
    }> =
      mondai === 1 && item.type === `form`
        ? item.slots
        : mondai === 2 && item.type === `compose`
          ? item.windows
          : (mondai === 4 && item.type === `short`) ||
              (mondai === 6 && item.type === `info`)
            ? item.questions
            : [];
    return units.map((unit, index) => ({
      item,
      index,
      difficulty: unit.difficulty,
      points: unit.points ?? []
    }));
  });

const LEVELS: readonly Difficulty[] = [1, 2, 3];

/**
 * Draw one deck's share, by difficulty.
 *
 * Three preferences, strongest first:
 *
 *  1. **One card per item.** Two slots of the same sentence in one test would
 *     show the sentence twice, with the second answer already given away.
 *  2. **The difficulty the blueprint asks for.** When that level runs short,
 *     the nearest level stands in rather than the draw failing — a thin deck
 *     should give a slightly easier or harder test, not no test.
 *  3. **A grammar point not yet asked.** The real paper does not test one point
 *     twice. A preference, not a rule, so a small deck still fills its share.
 *
 * The result is shuffled, because the paper does not sort by difficulty.
 */
export const drawDeck = (
  items: readonly Item[],
  plan: { mondai: DeckMondai; mix: Mix },
  random: Random
): Array<{ item: Item; index: number }> => {
  const cards = cardsOf(items, plan.mondai);
  const wanted = LEVELS.flatMap((level) =>
    Array.from({ length: plan.mix[level] }, () => level)
  );

  const chosen: Card[] = [];
  const usedItems = new Set<string>();
  const usedPoints = new Set<string>();

  for (const want of wanted) {
    const open = cards.filter((card) => !usedItems.has(card.item.id));
    if (open.length === 0) break;

    const nearest = Math.min(
      ...open.map((card) => Math.abs(card.difficulty - want))
    );
    const level = open.filter(
      (card) => Math.abs(card.difficulty - want) === nearest
    );
    const fresh = level.filter(
      (card) => !card.points.some((point) => usedPoints.has(point))
    );
    const pool = fresh.length > 0 ? fresh : level;
    const card = pool.at(Math.floor(random() * pool.length));
    if (card === undefined) break;

    chosen.push(card);
    usedItems.add(card.item.id);
    for (const point of card.points) usedPoints.add(point);
  }

  return shuffle(chosen, random).map(({ item, index }) => ({ item, index }));
};

/** 問題1: one slot of a sentence, its other blanks filled in. */
export const formQuestion = (
  item: FormItem,
  slotIndex: number,
  number: number,
  random: Random
): ExamQuestion => {
  const slot = item.slots.at(slotIndex);
  if (slot === undefined) {
    throw new Error(`${item.id} has no slot ${String(slotIndex + 1)}`);
  }
  const asked = slotIndex + 1;

  // Every other blank is shown filled, so the sentence reads as one question.
  const others = new Map(
    item.slots
      .map((other, index) => [index + 1, other.answer] as const)
      .filter(([n]) => n !== asked)
  );
  const prompt = fill(item.sentence, others);
  const { options, correct } = optionsFor(slot, random);

  return {
    itemId: item.id,
    slot: asked,
    mondai: 1,
    number,
    card: number,
    prompt,
    answered: fill(prompt, new Map([[asked, underlined(slot.answer)]])),
    options,
    correct,
    difficulty: slot.difficulty,
    points: [...slot.points],
    en: item.en,
    note: slot.note,
    token: tokenFrom(random),
    timeoutMs: timeoutFor(1, prompt, options)
  };
};

/**
 * 問題2: one window of a sentence, with the ★ at a random position.
 *
 * The window has exactly one valid order — the reviewer's promise — so the
 * star can fall on any of its four chunks and each is a fair question. One
 * window gives four questions; a repeated card rarely asks the same thing.
 */
export const composeQuestion = (
  item: ComposeItem,
  windowIndex: number,
  number: number,
  random: Random
): ExamQuestion => {
  const window = item.windows.at(windowIndex);
  if (window === undefined) {
    throw new Error(`${item.id} has no window ${String(windowIndex + 1)}`);
  }
  const chunks = chunksOf(item.sentence);
  const before = chunks.slice(0, window.start);
  const inside = chunks.slice(window.start, window.start + WINDOW_SIZE);
  const after = chunks.slice(window.start + WINDOW_SIZE);

  const star = Math.floor(random() * WINDOW_SIZE);
  const answer = inside.at(star)?.text ?? ``;

  // The paper sets the four blanks apart with spaces, whatever the sentence's
  // own spacing there.
  const blanks = inside
    .map((_, index) => (index === star ? STAR_BLANK : BLANK_LINE))
    .join(` `);
  const prompt = [joinChunks(before).trimEnd(), blanks, joinChunks(after)]
    .filter((text) => text !== ``)
    .join(` `);

  // The whole window underlined: the order is the lesson, and the ★ answer
  // is named beside it.
  const middle = joinChunks(inside);
  const answered = `${joinChunks(before)}__${middle.trimEnd()}__${
    middle.endsWith(` `) ? ` ` : ``
  }${joinChunks(after)}`;

  const options = shuffle(
    inside.map((chunk) => chunk.text),
    random
  );

  return {
    itemId: item.id,
    slot: windowIndex + 1,
    mondai: 2,
    number,
    card: number,
    prompt,
    answered,
    options,
    correct: options.indexOf(answer),
    difficulty: window.difficulty,
    points: [...window.points],
    en: item.en,
    note: window.note,
    token: tokenFrom(random),
    timeoutMs: timeoutFor(2, prompt, options)
  };
};

/** The passage's blanks, in the order a reader meets them. */
const blankOrder = (text: string): number[] => {
  const order: number[] = [];
  for (const segment of parse(text)) {
    if (segment.kind === `blank` && !order.includes(segment.slot)) {
      order.push(segment.slot);
    }
  }
  return order;
};

/**
 * 問題3: one passage, its asked blanks answered together on one card.
 *
 * Every asked blank shows its question number — ［15］ — and every blank not
 * asked is shown filled. The questions share a card, so they open and close
 * together, and the reveal shows the passage with all their answers in place.
 * The first live test asked them one card at a time, and splitting one short
 * story across four cards read badly.
 *
 * The card's timer is the sum of its questions' times. The passage counts
 * toward the first question's time only, so it is read once, not four times.
 */
export const passageQuestions = (
  item: PassageItem,
  count: number,
  firstNumber: number,
  random: Random
): ExamQuestion[] => {
  const order = blankOrder(item.text);
  const asked = shuffle(order, random)
    .slice(0, count)
    .sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const numberOf = (slot: number): number => firstNumber + asked.indexOf(slot);
  const answerOf = (slot: number): string =>
    item.blanks.at(slot - 1)?.answer ?? ``;

  /** The passage with every asked blank shown as `asked(slot)`. */
  const passageWith = (show: (slot: number) => string): string =>
    fill(
      item.text,
      new Map(
        order.map((slot) => [
          slot,
          asked.includes(slot) ? show(slot) : answerOf(slot)
        ])
      )
    );
  const prompt = passageWith((slot) => `［${String(numberOf(slot))}］`);
  const answered = passageWith((slot) => underlined(answerOf(slot)));

  return asked.map((slot, position) => {
    const blank = item.blanks.at(slot - 1);
    if (blank === undefined)
      throw new Error(`${item.id} has no blank ${String(slot)}`);
    const { options, correct } = optionsFor(blank, random);

    return {
      itemId: item.id,
      slot,
      mondai: 3,
      number: numberOf(slot),
      card: firstNumber,
      prompt,
      answered,
      ...(item.intro === undefined ? {} : { intro: item.intro }),
      options,
      correct,
      difficulty: blank.difficulty,
      points: [...blank.points],
      en: position === asked.length - 1 ? item.en : ``,
      note: blank.note,
      token: tokenFrom(random),
      timeoutMs: timeoutFor(3, position === 0 ? prompt : ``, options)
    };
  });
};

/** One passage with enough blanks, or none if the deck has none. */
const drawPassage = (
  items: readonly Item[],
  plan: PassagePlan,
  random: Random
): PassageItem | null => {
  const passages = items.filter(
    (item): item is PassageItem =>
      item.type === `passage` && item.blanks.length >= plan.blanks
  );
  return passages.at(Math.floor(random() * passages.length)) ?? null;
};

/** A text or picture with questions about it. */
export type ReadingItem = ShortItem | MidItem | InfoItem;

const MONDAI_OF: Readonly<Record<ReadingItem[`type`], 4 | 5 | 6>> = {
  short: 4,
  mid: 5,
  info: 6
};

/**
 * A reading question's four options, with each option's why beside it.
 *
 * Drawn options are shuffled as pairs, so a why can never end up under another option. Ordered options keep the order they are written in: the paper prints times and prices in order, and shuffled, 9:30 could come before 9:00.
 */
const readingOptions = (
  question: ReadingQuestion,
  random: Random
): { options: string[]; whys: string[]; correct: number } => {
  if (`wrong` in question) {
    const drawn = shuffle(question.wrong, random).slice(0, OPTION_COUNT - 1);
    const all = shuffle([question.answer, ...drawn], random);
    return {
      options: all.map(optionText),
      whys: all.map((option) => whyOf(option) ?? ``),
      correct: all.indexOf(question.answer)
    };
  }
  return {
    options: question.options.map(optionText),
    whys: question.options.map((option) => whyOf(option) ?? ``),
    correct: question.answer - 1
  };
};

/**
 * 問題4–6: the asked questions of one text or picture, on one card.
 *
 * The text, or the picture's material, counts toward the first question's time only, as a passage does: it is read once, however many questions ask about it. The English goes with the last question, which the reveal shows once.
 */
export const readingQuestions = (
  item: ReadingItem,
  /** 0-based, in the order the text answers them. */
  asked: readonly number[],
  firstNumber: number,
  random: Random,
  /** 問題6: the hosted picture's URL, when there is one. */
  image?: string
): ExamQuestion[] => {
  const mondai = MONDAI_OF[item.type];
  const text = item.type === `info` ? `` : item.text;
  const material =
    item.type === `info` ? materialMarkup(item.material) : undefined;
  const intro = item.type === `info` ? undefined : item.intro;

  return asked.map((index, position) => {
    const question = item.questions.at(index);
    if (question === undefined) {
      throw new Error(`${item.id} has no question ${String(index + 1)}`);
    }
    const { options, whys, correct } = readingOptions(question, random);
    const read = position === 0 ? `${text}${material ?? ``}` : ``;
    return {
      itemId: item.id,
      slot: index + 1,
      mondai,
      number: firstNumber + position,
      card: firstNumber,
      prompt: text,
      // Reading reveals never repeat the text: the closed card stays just above.
      answered: text,
      ...(intro === undefined ? {} : { intro }),
      question: question.question,
      ...(material === undefined ? {} : { material }),
      ...(material === undefined || image === undefined ? {} : { image }),
      options,
      whys,
      correct,
      difficulty: question.difficulty,
      points: [...(question.points ?? [])],
      en: position === asked.length - 1 ? item.en : ``,
      note: question.note,
      token: tokenFrom(random),
      timeoutMs: timeoutFor(mondai, `${read}${question.question}`, options)
    };
  });
};

/** Every way to choose `size` entries of `list`, each in list order. */
const choices = <T>(list: readonly T[], size: number): T[][] =>
  size === 0
    ? [[]]
    : list.flatMap((first, index) =>
        choices(list.slice(index + 1), size - 1).map((rest) => [first, ...rest])
      );

/**
 * 問題5: one text, and which of its questions to ask.
 *
 * The questions nearest the levels the test dealt this deck, kept in text order as the paper does. Among equally near choices, any is fair, so one is picked at random: a repeated text then asks something new.
 */
export const drawTogether = (
  items: readonly Item[],
  levels: readonly Difficulty[],
  random: Random
): { item: MidItem; asked: number[] } | null => {
  const wanted = [...levels].sort((a, b) => a - b);
  const options = items
    .filter((item): item is MidItem => item.type === `mid`)
    .flatMap((item) =>
      choices(
        item.questions.map((_, index) => index),
        wanted.length
      ).map((asked) => {
        // Sorted against sorted is the closest pairing of two lists of levels.
        const got = asked
          .map((index) => item.questions.at(index)?.difficulty ?? 1)
          .sort((a, b) => a - b);
        const cost = got.reduce(
          (sum, level, k) => sum + Math.abs(level - (wanted.at(k) ?? level)),
          0
        );
        return { item, asked, cost };
      })
    );
  if (options.length === 0) return null;
  const best = Math.min(...options.map((option) => option.cost));
  const pool = options.filter((option) => option.cost === best);
  const pick = pool.at(Math.floor(random() * pool.length));
  return pick === undefined ? null : { item: pick.item, asked: pick.asked };
};

/** How many of each level a list holds. */
const mixOf = (levels: readonly Difficulty[]): Mix => ({
  1: levels.filter((level) => level === 1).length,
  2: levels.filter((level) => level === 2).length,
  3: levels.filter((level) => level === 3).length
});

/**
 * The test's reading levels, shuffled and dealt to its decks in blueprint order.
 *
 * Every test gets the same levels, so every test is about equally hard. Which deck gets the hard one changes, so every question of every deck can come up.
 */
export const dealLevels = (
  plans: readonly ReadingPlan[],
  mix: Mix,
  random: Random
): Difficulty[][] => {
  const levels = shuffle(
    LEVELS.flatMap((level) => Array.from({ length: mix[level] }, () => level)),
    random
  );
  let at = 0;
  return plans.map((plan) => {
    const dealt = levels.slice(at, at + plan.questions);
    at += plan.questions;
    return dealt;
  });
};

/**
 * The review links for a question's grammar points, each page once.
 *
 * Two points can share a page, such as と for "with" and いっしょに. One link is enough.
 */
export const reviewOf = (
  points: readonly string[],
  /** Partial: a point with no page has no entry. */
  links: Readonly<Partial<Record<string, ReviewLink>>>
): ReviewLink[] => {
  const seen = new Set<string>();
  return points.flatMap((point) => {
    const link = links[point];
    if (link === undefined || seen.has(link.url)) return [];
    seen.add(link.url);
    return [link];
  });
};

/**
 * Draw a whole test, once, when it starts.
 *
 * The session stores the result, so nothing about the draw needs to survive
 * the test — which is what puts every card back in its deck afterwards.
 */
export const drawTest = (
  test: TestId,
  items: readonly Item[],
  links: Readonly<Record<string, ReviewLink>>,
  random: Random,
  /** Each hosted 問題6 picture's URL, by item id. */
  pictures: Readonly<Record<string, string>> = {}
): ExamQuestion[] => {
  const questions: ExamQuestion[] = [];
  const plans = BLUEPRINTS[test];
  const reading = plans.filter(
    (plan): plan is ReadingPlan => `questions` in plan
  );
  // Dealt only for a test with reading, so a grammar test's draw is unchanged.
  const dealt =
    reading.length === 0 ? [] : dealLevels(reading, READING_MIX, random);

  for (const plan of plans) {
    if (`blanks` in plan) {
      const passage = drawPassage(items, plan, random);
      if (passage !== null) {
        questions.push(
          ...passageQuestions(
            passage,
            plan.blanks,
            questions.length + 1,
            random
          )
        );
      }
      continue;
    }
    if (`questions` in plan) {
      const levels = dealt.at(reading.indexOf(plan)) ?? [];
      if (plan.together) {
        const text = drawTogether(items, levels, random);
        if (text !== null) {
          questions.push(
            ...readingQuestions(
              text.item,
              text.asked,
              questions.length + 1,
              random
            )
          );
        }
        continue;
      }
      for (const { item, index } of drawDeck(
        items,
        { mondai: plan.mondai, mix: mixOf(levels) },
        random
      )) {
        if (item.type === `short` || item.type === `info`) {
          questions.push(
            ...readingQuestions(
              item,
              [index],
              questions.length + 1,
              random,
              pictures[item.id]
            )
          );
        }
      }
      continue;
    }
    for (const { item, index } of drawDeck(items, plan, random)) {
      const number = questions.length + 1;
      if (item.type === `form`) {
        questions.push(formQuestion(item, index, number, random));
      } else if (item.type === `compose`) {
        questions.push(composeQuestion(item, index, number, random));
      }
    }
  }
  return questions.map((question) => ({
    ...question,
    review: reviewOf(question.points, links)
  }));
};

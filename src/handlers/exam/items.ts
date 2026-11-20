import * as v from "valibot";

/**
 * Mock-test items: their shape, their markup, and every check code can make.
 *
 * Items are written by hand and reviewed by a person, so this module is mostly
 * a gate. It cannot tell whether a wrong option is really wrong in its
 * sentence — only the reviewer can — but it catches everything mechanical
 * before an item reaches a channel: a blank with no slot, a kanji with no
 * reading, a kanji the paper would not use, a distractor that equals the
 * answer.
 *
 * Self-contained on purpose. It imports only valibot, so plain Node can load it
 * in `scripts/build-exam.mjs`; a relative `.js` import would not resolve there.
 * The build and the tests therefore run the same checks.
 */

/** How hard an item is, as its reviewer rates it. 1 is easiest. */
export type Difficulty = 1 | 2 | 3;

/**
 * Points a correct answer earns, by difficulty.
 *
 * Weighted because the JLPT is: it scores by which items a person got right,
 * not how many. See the spec, section 6.
 */
export const WEIGHT: Readonly<Record<Difficulty, number>> = {
  1: 2,
  2: 3,
  3: 4
};

/**
 * The kanji an N5 item may use.
 *
 * Not only the N5 kanji. The official N5 sample writes 私, 家, 朝, 帰, 作, 好 and
 * 教 in kanji, each with furigana, and all of them are N4 kanji. The paper
 * writes N5 *words* in their usual spelling and gives every kanji a reading. So
 * the limit is the old JLPT levels 4 and 3 (today's N5 and N4), and anything
 * harder is written in kana.
 *
 * From KANJIDIC2 (EDRDG, CC BY-SA 4.0), via the jmdict-simplified release
 * 3.6.2+20261109214828: 103 kanji at old level 4, then 181 at old level 3.
 */
export const PAPER_KANJI: ReadonlySet<string> = new Set(
  `一七万三上下中九二五人今休会何先入八六円出分前北十千午半南友口古右名四国土外多大天女子学安小少山川左年店後手新日時書月木本来東校母毎気水火父生男白百目社空立耳聞花行西見言話語読買足車週道金長間雨電食飲駅高魚` +
    `不世主乗事京仕代以低住体作使便借働元兄光写冬切別力勉動区医去台合同味品員問回図地堂場声売夏夕夜太好妹姉始字室家寒屋工市帰広度建引弟弱強待心思急悪意所持教文料方旅族早明映春昼暑暗曜有服朝村林森業楽歌止正歩死民池注洋洗海漢牛物特犬理産用田町画界病発県真着知短研私秋究答紙終習考者肉自色英茶菜薬親計試説貸質赤走起転軽近送通進運遠都重野銀門開院集青音頭題顔風飯館首験鳥黒`
);

/** Any character the reader would need a reading for. */
const KANJI = /\p{Script=Han}/u;
/** What a reading may be made of. */
const KANA = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u;

const text = v.pipe(v.string(), v.minLength(1));

// Every object below is strict: an unknown key fails rather than vanishing.
// YAML ends an unquoted flow value at a comma, so `meaning: so, therefore`
// stores "so" and a stray key "therefore". Twelve grammar point meanings were
// cut short that way, silently, until this was strict.

/**
 * One blank and its answers.
 *
 * Shared by every type with blanks. Difficulty, grammar points and the
 * teaching note belong to the blank rather than the sentence, because two
 * blanks in one sentence can test different things.
 */
const slotSchema = v.strictObject({
  answer: text,
  /**
   * Three or more, each reviewed as wrong IN THIS SENTENCE. Three are drawn at
   * ask time, so a larger pool makes a repeated item look different.
   */
  wrong: v.pipe(v.array(text), v.minLength(3)),
  difficulty: v.picklist([1, 2, 3]),
  points: v.pipe(v.array(text), v.minLength(1)),
  note: text
});

/**
 * Permanent. Results and statistics refer to it, so an id is never reused.
 * `n5-b1-0001` is N5, bunpou 問題1, item 1.
 */
const idSchema = v.pipe(v.string(), v.regex(/^n[1-5]-[bd][1-6]-\d{4}$/u));

/** 問題1: choose the form that fits the blank. */
export const formItemSchema = v.strictObject({
  id: idSchema,
  type: v.literal(`form`),
  status: v.picklist([`draft`, `reviewed`]),
  /** Ruby is `{漢字|かな}`; a blank is `（n）`, where n is the slot number. */
  sentence: text,
  /** The whole sentence in English, shown only at the reveal. */
  en: text,
  slots: v.pipe(v.array(slotSchema), v.minLength(1))
});

/**
 * One run of four chunks with exactly one valid order: a ★ question.
 *
 * Its own difficulty, points and note, like a slot: two windows in one
 * sentence can test different things.
 */
const windowSchema = v.strictObject({
  /** The window's first chunk, counted from 0. */
  start: v.pipe(v.number(), v.integer(), v.minValue(0)),
  difficulty: v.picklist([1, 2, 3]),
  points: v.pipe(v.array(text), v.minLength(1)),
  note: text
});

/** 問題2: put four chunks in order, and choose the one that lands on ★. */
export const composeItemSchema = v.strictObject({
  id: idSchema,
  type: v.literal(`compose`),
  status: v.picklist([`draft`, `reviewed`]),
  /**
   * The sentence with `/` between its chunks. Spaces written around a `/`
   * show as a space; none, no space: `この / かばん/は / わたし/の / です。`
   */
  sentence: text,
  en: text,
  windows: v.pipe(v.array(windowSchema), v.minLength(1))
});

/** 問題3: a short passage with numbered blanks. */
export const passageItemSchema = v.strictObject({
  id: idSchema,
  type: v.literal(`passage`),
  status: v.picklist([`draft`, `reviewed`]),
  /** The situation, above the passage: who wrote it, and for what. */
  intro: v.optional(text),
  /** Blanks are `（n）`, numbered by slot, as in 問題1. */
  text: text,
  /** The whole passage in English, shown after its last question. */
  en: text,
  /** Four or more. A test asks four and shows the rest filled in. */
  blanks: v.pipe(v.array(slotSchema), v.minLength(4))
});

export const itemSchema = v.variant(`type`, [
  formItemSchema,
  composeItemSchema,
  passageItemSchema
]);
export const itemsSchema = v.array(itemSchema);

export type Slot = v.InferOutput<typeof slotSchema>;
export type Window = v.InferOutput<typeof windowSchema>;
export type FormItem = v.InferOutput<typeof formItemSchema>;
export type ComposeItem = v.InferOutput<typeof composeItemSchema>;
export type PassageItem = v.InferOutput<typeof passageItemSchema>;
export type Item = v.InferOutput<typeof itemSchema>;

/** How many chunks a ★ question arranges, as on the paper. */
export const WINDOW_SIZE = 4;

/** One chunk of a ★ sentence, and whether a space follows it. */
export interface Chunk {
  text: string;
  spaceAfter: boolean;
}

/** Split a ★ sentence at its `/` marks, keeping the spacing the author wrote. */
export const chunksOf = (sentence: string): Chunk[] => {
  const pieces = sentence.split(`/`);
  return pieces.map((piece, index) => {
    const next = pieces.at(index + 1);
    return {
      text: piece.trim(),
      spaceAfter:
        next !== undefined && (/\s$/u.test(piece) || /^\s/u.test(next))
    };
  });
};

/** Chunks back into a sentence, with the spaces the author wrote. */
export const joinChunks = (chunks: readonly Chunk[]): string =>
  chunks.map((chunk) => `${chunk.text}${chunk.spaceAfter ? ` ` : ``}`).join(``);

/** An entry in `grammar-points.yaml`, the list items refer to. */
export const grammarPointSchema = v.strictObject({
  id: v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/u)),
  pattern: text,
  meaning: text
});
export const grammarPointsSchema = v.array(grammarPointSchema);
export type GrammarPoint = v.InferOutput<typeof grammarPointSchema>;

// ─── Markup ────────────────────────────────────────────────────────────────

export type Segment =
  | { kind: `text`; text: string }
  | { kind: `ruby`; base: string; reading: string }
  | { kind: `blank`; slot: number };

/** `{base|reading}` or `（n）`. Anything else is plain text. */
const TOKEN = /\{[^{}|]+\|[^{}|]+\}|（\d+）/gu;

/** Split markup into text, ruby and blanks. */
export const parse = (markup: string): Segment[] => {
  const segments: Segment[] = [];
  let at = 0;
  for (const match of markup.matchAll(TOKEN)) {
    if (match.index > at) {
      segments.push({ kind: `text`, text: markup.slice(at, match.index) });
    }
    // Told apart by the opening character rather than by capture groups: an
    // unmatched group is `undefined` at runtime, but typed as a string.
    const [token] = match;
    const inner = token.slice(1, -1);
    if (token.startsWith(`（`)) {
      segments.push({ kind: `blank`, slot: Number(inner) });
    } else {
      const [base = ``, reading = ``] = inner.split(`|`);
      segments.push({ kind: `ruby`, base, reading });
    }
    at = match.index + token.length;
  }
  if (at < markup.length) {
    segments.push({ kind: `text`, text: markup.slice(at) });
  }
  return segments;
};

/** Back to markup, so a filled-in sentence can be filled or shown again. */
const serialise = (segments: readonly Segment[]): string =>
  segments
    .map((segment) =>
      segment.kind === `text`
        ? segment.text
        : segment.kind === `ruby`
          ? `{${segment.base}|${segment.reading}}`
          : `（${String(segment.slot)}）`
    )
    .join(``);

/**
 * The parts of an answer, one per blank its slot covers.
 *
 * A pair item (は／は) has one slot and two blanks, and its options are written
 * the way the paper writes them.
 */
export const partsOf = (answer: string): string[] => answer.split(`／`);

/**
 * Replace some blanks with text, leaving the others.
 *
 * A slot that covers two blanks takes its parts in order, so `は／は` fills the
 * first blank with は and the second with は.
 */
export const fill = (
  markup: string,
  fills: ReadonlyMap<number, string>
): string => {
  const used = new Map<number, number>();
  return serialise(
    parse(markup).flatMap((segment): Segment[] => {
      if (segment.kind !== `blank`) return [segment];
      const answer = fills.get(segment.slot);
      if (answer === undefined) return [segment];
      const index = used.get(segment.slot) ?? 0;
      used.set(segment.slot, index + 1);
      return parse(partsOf(answer)[index] ?? ``);
    })
  );
};

/** The paper's blank. Escaped, because the space inside is invisible in source. */
export const BLANK = `（　）`;

/**
 * Markup with each kanji followed by its reading: 毎朝(まいあさ).
 *
 * For short text with no room for a line of its own: button labels, notes,
 * private results. Sentences use {@link bare} with {@link readingsOf} below
 * them instead — the first live test found inline readings made a whole
 * sentence hard to read. Half-width brackets, so a reading never looks like
 * the paper's full-width blank.
 */
export const display = (markup: string): string =>
  parse(markup)
    .map((segment) =>
      segment.kind === `text`
        ? segment.text
        : segment.kind === `ruby`
          ? `${segment.base}(${segment.reading})`
          : BLANK
    )
    .join(``);

/**
 * Markup as the paper prints it, minus the furigana: kanji without readings,
 * blanks as the paper's blank. The readings go on their own line.
 */
export const bare = (markup: string): string =>
  parse(markup)
    .map((segment) =>
      segment.kind === `text`
        ? segment.text
        : segment.kind === `ruby`
          ? segment.base
          : BLANK
    )
    .join(``);

/**
 * Every kanji's reading, once each, in the order they appear.
 *
 * Furigana sits above the kanji it reads, and so does this: 行(い)きます lists
 * 行 い, not the whole word. Telling okurigana from a following particle would
 * need a tokenizer, and the paper does not do it either.
 */
export const readingsOf = (
  markup: string
): Array<{ base: string; reading: string }> => {
  const seen = new Set<string>();
  const found: Array<{ base: string; reading: string }> = [];
  for (const segment of parse(markup)) {
    if (segment.kind !== `ruby`) continue;
    const key = `${segment.base}|${segment.reading}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ base: segment.base, reading: segment.reading });
  }
  return found;
};

/** The text a reader reads, without readings or blanks. For timing. */
export const plain = (markup: string): string =>
  parse(markup)
    .map((segment) =>
      segment.kind === `text`
        ? segment.text
        : segment.kind === `ruby`
          ? segment.base
          : ``
    )
    .join(``);

// ─── Checks ────────────────────────────────────────────────────────────────

/**
 * What is mechanically wrong with one piece of markup.
 *
 * Every kanji needs a reading, because the paper prints furigana on every
 * kanji, and every kanji must be N5, because the paper writes harder words in
 * kana.
 */
const markupProblems = (markup: string, where: string): string[] => {
  const problems: string[] = [];
  for (const segment of parse(markup)) {
    if (segment.kind === `text`) {
      if (/[{}|]/u.test(segment.text)) {
        problems.push(`${where}: malformed ruby in "${segment.text}"`);
      }
      for (const char of segment.text) {
        if (KANJI.test(char)) {
          problems.push(`${where}: kanji ${char} has no reading`);
        }
      }
    } else if (segment.kind === `ruby`) {
      if (!KANJI.test(segment.base)) {
        problems.push(
          `${where}: ruby on "${segment.base}", which has no kanji`
        );
      }
      if (!KANA.test(segment.reading)) {
        problems.push(
          `${where}: reading "${segment.reading}" is not kana (${segment.base})`
        );
      }
      for (const char of segment.base) {
        if (KANJI.test(char) && !PAPER_KANJI.has(char)) {
          problems.push(
            `${where}: kanji ${char} is above N4; write the word in kana`
          );
        }
      }
    }
  }
  return problems;
};

/** Options must be self-contained text, never a blank. */
const optionProblems = (option: string, where: string): string[] => [
  ...(parse(option).some((segment) => segment.kind === `blank`)
    ? [`${where}: an option cannot contain a blank`]
    : []),
  ...markupProblems(option, where)
];

const slotProblems = (
  slot: Slot,
  number: number,
  blanks: number,
  points: ReadonlySet<string>,
  where: string
): string[] => {
  const at = `${where} slot ${String(number)}`;
  const problems: string[] = [];
  const parts = partsOf(slot.answer).length;

  if (blanks === 0)
    problems.push(`${at}: no （${String(number)}） in the text`);
  else if (blanks !== parts) {
    problems.push(
      `${at}: ${String(blanks)} blanks but the answer has ${String(parts)} parts`
    );
  }
  if (slot.wrong.includes(slot.answer)) {
    problems.push(`${at}: the answer is also in the wrong pool`);
  }
  if (new Set(slot.wrong).size !== slot.wrong.length) {
    problems.push(`${at}: the wrong pool repeats an option`);
  }
  for (const wrong of slot.wrong) {
    if (partsOf(wrong).length !== parts) {
      problems.push(`${at}: wrong option "${wrong}" has a different shape`);
    }
  }
  for (const point of slot.points) {
    if (!points.has(point)) {
      problems.push(`${at}: grammar point "${point}" is not in the list`);
    }
  }
  problems.push(
    ...optionProblems(slot.answer, `${at} answer`),
    ...slot.wrong.flatMap((wrong) => optionProblems(wrong, `${at} wrong`))
  );
  return problems;
};

/**
 * Text with numbered blanks, checked against its slots: every blank has a
 * slot, and every slot appears as often as its answer has parts.
 */
const blankedProblems = (
  markup: string,
  slots: readonly Slot[],
  points: ReadonlySet<string>,
  where: string
): string[] => {
  const blanks = new Map<number, number>();
  for (const segment of parse(markup)) {
    if (segment.kind === `blank`) {
      blanks.set(segment.slot, (blanks.get(segment.slot) ?? 0) + 1);
    }
  }

  const problems = markupProblems(markup, where);
  for (const slot of blanks.keys()) {
    if (slot < 1 || slot > slots.length) {
      problems.push(`${where}: blank （${String(slot)}） has no slot`);
    }
  }
  slots.forEach((slot, index) => {
    problems.push(
      ...slotProblems(
        slot,
        index + 1,
        blanks.get(index + 1) ?? 0,
        points,
        where
      )
    );
  });
  return problems;
};

/**
 * A ★ sentence: its markup, and every window.
 *
 * Code checks the window's shape. Whether its four chunks have exactly one
 * valid order is for the reviewer — that is the trap of this question type.
 */
const composeProblems = (
  item: ComposeItem,
  points: ReadonlySet<string>
): string[] => {
  const where = item.id;
  const chunks = chunksOf(item.sentence);
  const problems = markupProblems(item.sentence, where);

  if (parse(item.sentence).some((segment) => segment.kind === `blank`)) {
    problems.push(`${where}: a ★ sentence has no （n） blanks`);
  }
  chunks.forEach((chunk, index) => {
    if (chunk.text === ``) {
      problems.push(`${where}: chunk ${String(index + 1)} is empty`);
    }
  });
  const starts = item.windows.map((window) => window.start);
  if (new Set(starts).size !== starts.length) {
    problems.push(`${where}: two windows start at the same chunk`);
  }
  for (const window of item.windows) {
    const at = `${where} window at chunk ${String(window.start + 1)}`;
    const inside = chunks.slice(window.start, window.start + WINDOW_SIZE);
    if (inside.length < WINDOW_SIZE) {
      problems.push(`${at}: runs past the end of the sentence`);
      continue;
    }
    // The final chunk carries the 。, which would give its own place away.
    if (window.start + WINDOW_SIZE >= chunks.length) {
      problems.push(`${at}: ends the sentence; leave a chunk after it`);
    }
    // Two identical chunks would make two orders look the same, and the ★
    // answer ambiguous.
    if (new Set(inside.map((chunk) => chunk.text)).size !== WINDOW_SIZE) {
      problems.push(`${at}: two of its chunks are the same`);
    }
    for (const point of window.points) {
      if (!points.has(point)) {
        problems.push(`${at}: grammar point "${point}" is not in the list`);
      }
    }
  }
  return problems;
};

/** Everything code can find wrong with one item. Empty means it may ship. */
export const itemProblems = (
  item: Item,
  points: ReadonlySet<string>
): string[] => {
  switch (item.type) {
    case `form`:
      return blankedProblems(item.sentence, item.slots, points, item.id);
    case `compose`:
      return composeProblems(item, points);
    case `passage`:
      return [
        ...(item.intro === undefined
          ? []
          : markupProblems(item.intro, `${item.id} intro`)),
        ...blankedProblems(item.text, item.blanks, points, item.id)
      ];
  }
};

/** Problems that only show across the whole corpus. */
export const corpusProblems = (items: readonly Item[]): string[] => {
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const item of items) {
    if (seen.has(item.id)) problems.push(`${item.id}: id used twice`);
    seen.add(item.id);
  }
  return problems;
};

/** The longest text every string ends with. */
const sharedEnding = (texts: readonly string[]): string => {
  const [first = ``, ...rest] = texts;
  let length = first.length;
  for (const text of rest) {
    let same = 0;
    while (
      same < length &&
      same < text.length &&
      text[text.length - 1 - same] === first[first.length - 1 - same]
    ) {
      same += 1;
    }
    length = same;
  }
  return first.slice(first.length - length);
};

/**
 * Options that are longer than they need to be.
 *
 * When every option ends the same way — むずかしかったです, むずかしいです — the
 * shared ending belongs in the sentence: each character is read four times, and
 * the timer grows with it. A hint, not a problem, because code cannot tell a
 * shared です from an ending that is part of what varies. The reviewer decides.
 */
export const itemHints = (item: Item): string[] =>
  (item.type === `form`
    ? item.slots
    : item.type === `passage`
      ? item.blanks
      : []
  ).flatMap((slot, index) => {
    const ending = sharedEnding([slot.answer, ...slot.wrong].map(plain));
    return ending === ``
      ? []
      : [
          `${item.id} slot ${String(index + 1)}: every option ends in "${ending}"; move it into the sentence unless it is part of what varies`
        ];
  });

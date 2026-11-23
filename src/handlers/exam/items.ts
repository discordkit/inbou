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
 * `n5-b1-0001` is N5, bunpou 問題1, item 1; `n5-g1-0001` is goi 問題1.
 */
const idSchema = v.pipe(v.string(), v.regex(/^n[1-5]-[bdg][1-6]-\d{4}$/u));

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

// ─── Reading: 問題4–6 ───────────────────────────────────────────────────────
//
// A reading item is a text, or a picture's material, with several questions. A test asks one or two of them, so an item that comes up again asks something new. Reading questions test no grammar point, so they carry no points and no review link.

/**
 * A reading or vocabulary option: its text, or its text and why it is wrong.
 *
 * Reading is comprehension, not a grammar point, so a student who chose a wrong option needs to know what in the text rules it out; a near-miss reading such as はんふん needs its rule. A medium or hard question explains every wrong option; an easy one may leave its note to say what the question asked.
 */
const optionSchema = v.union([
  text,
  v.strictObject({
    option: text,
    /** What in the text makes this option wrong. Shown at the reveal to a student who chose it. */
    why: text
  })
]);

export type Option = v.InferOutput<typeof optionSchema>;

/** An option's text, with or without its why. */
export const optionText = (option: Option): string =>
  typeof option === `string` ? option : option.option;

/** Why an option is wrong, if the item says. */
export const whyOf = (option: Option): string | undefined =>
  typeof option === `string` ? undefined : option.why;

/**
 * Grammar points that decide a reading question, when one does. Most reading questions turn on the text, not on a point, so this is optional; where it is given, the reveal links the point's review page.
 */
const readingPoints = v.optional(v.pipe(v.array(text), v.minLength(1)));

/**
 * A reading question whose options are drawn: the answer and three of `wrong`, shuffled, as for a slot.
 */
const drawnQuestionSchema = v.strictObject({
  /** The stem. One sentence per line: the card shows each line as a heading. */
  question: text,
  answer: text,
  /** Three or more, each wrong for THIS text. Three are drawn. */
  wrong: v.pipe(v.array(optionSchema), v.minLength(3)),
  difficulty: v.picklist([1, 2, 3]),
  points: readingPoints,
  /** What the question asks, and where the text answers it. */
  note: text
});

/**
 * A reading question whose four options keep the order they are written in.
 *
 * For options with an order of their own, as the paper prints them: times, prices, days. Shuffled, 9:30 could come before 9:00. `answer` counts from 1, as the buttons do.
 */
const orderedQuestionSchema = v.strictObject({
  question: text,
  /** The answer's option is plain text: only the wrong ones say why. */
  options: v.pipe(v.array(optionSchema), v.length(4)),
  answer: v.picklist([1, 2, 3, 4]),
  difficulty: v.picklist([1, 2, 3]),
  points: readingPoints,
  note: text
});

const readingQuestionSchema = v.union([
  drawnQuestionSchema,
  orderedQuestionSchema
]);

/** 問題4: a short text, about 80 characters. A test asks one of its questions. */
export const shortItemSchema = v.strictObject({
  id: idSchema,
  type: v.literal(`short`),
  status: v.picklist([`draft`, `reviewed`]),
  /** Above the text: the setting and who reads it, such as （{学校|がっこう}で）. */
  intro: v.optional(text),
  text: text,
  /** The text in English, shown at the reveal. */
  en: text,
  questions: v.pipe(v.array(readingQuestionSchema), v.minLength(1))
});

/** 問題5: a text of about 250 characters. A test asks two of its questions. */
export const midItemSchema = v.strictObject({
  id: idSchema,
  type: v.literal(`mid`),
  status: v.picklist([`draft`, `reviewed`]),
  intro: v.optional(text),
  text: text,
  en: text,
  /**
   * In the order the text answers them. A test asks two and keeps this order, as the paper does, so each must stand alone: no question may give another's answer away.
   */
  questions: v.pipe(v.array(readingQuestionSchema), v.minLength(2))
});

/** Lines of text: a notice, the details on a flyer. */
const textBlockSchema = v.strictObject({
  text: v.pipe(v.array(text), v.minLength(1))
});

/**
 * A grid: a timetable, opening hours, a class schedule. Every row is as wide as the head. A cell may be empty, such as the corner of a schedule.
 */
const tableBlockSchema = v.strictObject({
  table: v.strictObject({
    head: v.pipe(v.array(v.string()), v.minLength(2)),
    rows: v.pipe(v.array(v.array(v.string())), v.minLength(1))
  })
});

/** Lists side by side, each a heading over name and value pairs: a menu, a price list. */
const listsBlockSchema = v.strictObject({
  lists: v.pipe(
    v.array(
      v.strictObject({
        head: text,
        rows: v.pipe(v.array(v.tuple([text, text])), v.minLength(1))
      })
    ),
    v.minLength(1)
  )
});

/** Boxes two to a row, each a heading over a few lines: the routes on a route chart, the notices on a board. */
const panelsBlockSchema = v.strictObject({
  panels: v.pipe(
    v.array(
      v.strictObject({
        head: text,
        lines: v.pipe(v.array(text), v.minLength(1))
      })
    ),
    v.minLength(2)
  )
});

const blockSchema = v.union([
  textBlockSchema,
  tableBlockSchema,
  listsBlockSchema,
  panelsBlockSchema
]);

const lines = v.pipe(v.array(text), v.minLength(1));
const count = v.pipe(v.number(), v.integer(), v.minValue(0));

/** A colour by name. Each template has its own palette, so a picture keeps to colours that look right on it. */
const toneSchema = v.picklist([
  `red`,
  `orange`,
  `yellow`,
  `green`,
  `blue`,
  `navy`,
  `purple`,
  `pink`,
  `brown`,
  `gray`
]);

/**
 * Paper, signs and boards: a title over blocks, drawn in the style of the real thing. The kind picks the look: a printed notice with 記 and 以上, a handwritten sign taped to a door, a clinic's signboard, a poster, a cork board, a café's chalkboard, a supermarket flyer, a whiteboard, a store directory, a school timetable.
 */
const sheetSchema = v.strictObject({
  kind: v.picklist([
    `notice`,
    `sign`,
    `signboard`,
    `poster`,
    `board`,
    `chalkboard`,
    `flyer`,
    `whiteboard`,
    `directory`,
    `timetable`
  ]),
  tone: v.optional(toneSchema),
  icon: v.optional(v.picklist([`clinic`, `pool`, `book`, `school`])),
  /** Lines above the title: who it is for, the date. */
  head: v.optional(lines),
  title: text,
  blocks: v.pipe(v.array(blockSchema), v.minLength(1)),
  /** Lines below: who it is from, 以上. */
  foot: v.optional(lines)
});

/** The timetable at a bus stop or on a platform: a row for each hour, its minutes beside it, a column for each kind of day. */
const stopTimetableSchema = v.strictObject({
  kind: v.literal(`stop-timetable`),
  mode: v.picklist([`bus`, `train`]),
  stop: text,
  /** Where the bus or train goes: 〜ゆき. */
  bound: text,
  columns: v.pipe(v.array(text), v.minLength(1), v.maxLength(3)),
  rows: v.pipe(
    v.array(
      v.strictObject({
        hour: v.pipe(count, v.maxValue(24)),
        /** One list per column. A minute may carry a mark the notes explain, such as 「25●」. */
        minutes: v.array(v.array(text))
      })
    ),
    v.minLength(1)
  ),
  notes: v.optional(lines)
});

/** The departure board over a platform: kind of train, time, where it goes, which platform. */
const departureBoardSchema = v.strictObject({
  kind: v.literal(`departure-board`),
  head: v.tuple([text, text, text, text]),
  rows: v.pipe(
    v.array(
      v.strictObject({
        type: text,
        tone: toneSchema,
        time: text,
        dest: text,
        track: text
      })
    ),
    v.minLength(2)
  ),
  /** The line that scrolls along the bottom. */
  note: v.optional(text)
});

/** A route-search app's results, as a phone shows them. */
const routeSearchSchema = v.strictObject({
  kind: v.literal(`route-search`),
  from: text,
  to: text,
  when: text,
  routes: v.pipe(
    v.array(
      v.strictObject({
        label: text,
        depart: text,
        arrive: text,
        time: text,
        fare: text,
        transfers: text,
        legs: lines,
        /** The app's badges: 早, 安, 楽. */
        tags: v.optional(lines)
      })
    ),
    v.minLength(2)
  )
});

/** The fare chart above a station's ticket machines. Exactly one station is the one you are at. */
const fareChartSchema = v.strictObject({
  kind: v.literal(`fare-chart`),
  title: text,
  stations: v.pipe(
    v.array(
      v.strictObject({
        name: text,
        fare: text,
        here: v.optional(v.literal(true))
      })
    ),
    v.minLength(3)
  ),
  notes: v.optional(lines)
});

/** Arrows that point the way. One set, shared by the alt text and the picture. */
export const ARROWS = { left: `←`, right: `→`, up: `↑`, down: `↓` } as const;

/** The signs hanging in a station: exits, transfers, toilets. */
const stationSignsSchema = v.strictObject({
  kind: v.literal(`station-signs`),
  signs: v.pipe(
    v.array(
      v.strictObject({
        tone: toneSchema,
        arrow: v.picklist([`left`, `right`, `up`, `down`]),
        lines
      })
    ),
    v.minLength(2)
  )
});

const amountSchema = v.strictObject({ label: text, amount: count });

/** A till receipt. The build checks the sums, as a till would. */
const receiptSchema = v.strictObject({
  kind: v.literal(`receipt`),
  store: text,
  head: v.optional(lines),
  items: v.pipe(
    v.array(v.strictObject({ name: text, price: count })),
    v.minLength(1)
  ),
  total: amountSchema,
  paid: amountSchema,
  change: amountSchema,
  foot: v.optional(lines)
});

/** A meal-ticket machine (食券機) or a drinks machine: groups of buttons, each a name and a price. */
const machineSchema = v.strictObject({
  kind: v.literal(`machine`),
  variant: v.picklist([`tickets`, `drinks`]),
  title: text,
  groups: v.pipe(
    v.array(
      v.strictObject({
        head: text,
        tone: toneSchema,
        buttons: v.pipe(
          v.array(
            v.strictObject({
              name: text,
              price: count,
              /** A lit label on the button, such as 売り切れ. */
              mark: v.optional(text)
            })
          ),
          v.minLength(1)
        )
      })
    ),
    v.minLength(1)
  ),
  /** Stickers on the machine. */
  notes: v.optional(lines)
});

/** A shop's stamp card: slots, the stamps so far, and what a full row earns. */
const stampCardSchema = v.strictObject({
  kind: v.literal(`stamp-card`),
  shop: text,
  title: text,
  slots: v.pipe(count, v.minValue(4), v.maxValue(20)),
  stamped: count,
  rewards: v.pipe(
    v.array(v.strictObject({ at: count, label: text })),
    v.minLength(1)
  ),
  notes: v.optional(lines)
});

/** A ticket with a tear-off stub: a film, a concert. */
const ticketSchema = v.strictObject({
  kind: v.literal(`ticket`),
  venue: text,
  title: text,
  fields: v.pipe(
    v.array(v.strictObject({ label: text, value: text })),
    v.minLength(2)
  ),
  stub: v.optional(lines)
});

/** A month on a wall: a rubbish calendar, a library's closed days. Marked days are coloured, and the legend says what each colour means. */
const calendarSchema = v.strictObject({
  kind: v.literal(`calendar`),
  title: text,
  /** The weekday heads, Sunday first. */
  week: v.pipe(v.array(text), v.length(7)),
  /** The weekday of the 1st, 0 for Sunday. */
  first: v.pipe(count, v.maxValue(6)),
  days: v.pipe(count, v.minValue(28), v.maxValue(31)),
  legend: v.pipe(
    v.array(v.strictObject({ tone: toneSchema, short: text, label: text })),
    v.minLength(1)
  ),
  marks: v.array(v.strictObject({ day: count, tone: toneSchema })),
  notes: v.optional(lines)
});

/** A forecast, as a weather app or the news shows it. */
const weatherSchema = v.strictObject({
  kind: v.literal(`weather`),
  title: text,
  /** Row labels: the high, the low, the chance of rain. */
  labels: v.tuple([text, text, text]),
  days: v.pipe(
    v.array(
      v.strictObject({
        day: text,
        sky: v.picklist([
          `sunny`,
          `cloudy`,
          `rain`,
          `snow`,
          `sunny-cloudy`,
          `cloudy-rain`
        ]),
        label: text,
        high: v.number(),
        low: v.number(),
        rain: count
      })
    ),
    v.minLength(3),
    v.maxLength(7)
  ),
  notes: v.optional(lines)
});

/** The paper bag a pharmacy hands medicine over in: when to take it, how much, for how many days. */
const medicineBagSchema = v.strictObject({
  kind: v.literal(`medicine-bag`),
  clinic: text,
  patient: text,
  medicine: text,
  slots: v.pipe(
    v.array(v.strictObject({ label: text, checked: v.boolean() })),
    v.minLength(2)
  ),
  when: text,
  amount: text,
  days: text,
  notes: v.optional(lines)
});

/** A printed form, filled in by hand: a missed-delivery slip, an application. */
const formSchema = v.strictObject({
  kind: v.literal(`form`),
  variant: v.picklist([`delivery`, `application`]),
  title: text,
  head: v.optional(lines),
  fields: v.pipe(
    v.array(
      v.strictObject({
        label: text,
        /** Written by hand. */
        value: v.optional(text),
        checks: v.optional(
          v.pipe(
            v.array(v.strictObject({ label: text, checked: v.boolean() })),
            v.minLength(1)
          )
        )
      })
    ),
    v.minLength(2)
  ),
  foot: v.optional(lines)
});

/** A group chat on a phone. */
const chatSchema = v.strictObject({
  kind: v.literal(`chat`),
  room: text,
  day: v.optional(text),
  messages: v.pipe(
    v.array(
      v.strictObject({
        from: text,
        text,
        time: text,
        /** The reader's own message, on the right. */
        me: v.optional(v.literal(true))
      })
    ),
    v.minLength(2)
  )
});

/**
 * What a 問題6 picture shows: a kind of document someone living in Japan meets, structured rather than drawn, so a template lays it out and an edit is a reviewable diff.
 *
 * The kinds are part of what is tested. A student who knows a bus-stop timetable lists minutes by the hour, or that a receipt's おつり is the change, reads them faster.
 */
const materialSchema = v.variant(`kind`, [
  sheetSchema,
  stopTimetableSchema,
  departureBoardSchema,
  routeSearchSchema,
  fareChartSchema,
  stationSignsSchema,
  receiptSchema,
  machineSchema,
  stampCardSchema,
  ticketSchema,
  calendarSchema,
  weatherSchema,
  medicineBagSchema,
  formSchema,
  chatSchema
]);

/** 問題6: information to search, shown as a picture. A test asks one of its questions. */
export const infoItemSchema = v.strictObject({
  id: idSchema,
  type: v.literal(`info`),
  status: v.picklist([`draft`, `reviewed`]),
  material: materialSchema,
  /** The material in English, shown at the reveal. */
  en: text,
  questions: v.pipe(v.array(readingQuestionSchema), v.minLength(1))
});

// ─── Vocabulary: Section 1 ─────────────────────────────────────────────────
//
// Section 1 prints everything in kana except what it tests: the kanji a 漢字読み question asks the reading of, and a 表記 question's spellings. So these items carry no ruby and the card has no readings line, and a target's reading has no way onto the card before its reveal.

/** What every vocabulary item has. Each is one question: a sentence and its options. */
const vocabFields = {
  id: idSchema,
  status: v.picklist([`draft`, `reviewed`]),
  /** The sentence in English, shown at the reveal. */
  en: text,
  answer: text,
  /** Three or more, each wrong in THIS sentence. Three are drawn. */
  wrong: v.pipe(v.array(optionSchema), v.minLength(3)),
  difficulty: v.picklist([1, 2, 3]),
  /** What the question asks, and its trap. Shown at the reveal. */
  note: text
};

/**
 * The dictionary form of the word a 漢字読み or 表記 question asks about, as JMdict spells it: 半分, 書く, ワイシャツ.
 *
 * Checked against the N5 word list, and used by the draw so that one test never asks the same word in both 問題.
 */
const wordField = text;

/** 問題1 漢字読み: read the underlined kanji, and choose its hiragana. */
export const kanjiItemSchema = v.strictObject({
  ...vocabFields,
  type: v.literal(`kanji`),
  word: wordField,
  /** Kana, but for one `__target__` in kanji: `ケーキを __半分__ たべました。` */
  sentence: text
});

/** 問題2 表記: the underlined word is in kana; choose how it is written. */
export const spellingItemSchema = v.strictObject({
  ...vocabFields,
  type: v.literal(`spelling`),
  word: wordField,
  /** All kana, with one `__target__`. The options are its spellings, in kanji or katakana. */
  sentence: text
});

/** 問題3 文脈規定: choose the word that fits the blank. */
export const contextItemSchema = v.strictObject({
  ...vocabFields,
  type: v.literal(`context`),
  /** All kana, with one {@link BLANK}. The options are one word class, in one form. */
  sentence: text
});

/** 問題4 言い換え類義: choose the sentence that means about the same. */
export const paraphraseItemSchema = v.strictObject({
  ...vocabFields,
  type: v.literal(`paraphrase`),
  /** All kana. The card underlines all of it, and the options are whole sentences. */
  sentence: text
});

export const itemSchema = v.variant(`type`, [
  formItemSchema,
  composeItemSchema,
  passageItemSchema,
  shortItemSchema,
  midItemSchema,
  infoItemSchema,
  kanjiItemSchema,
  spellingItemSchema,
  contextItemSchema,
  paraphraseItemSchema
]);
export const itemsSchema = v.array(itemSchema);

export type Slot = v.InferOutput<typeof slotSchema>;
export type Window = v.InferOutput<typeof windowSchema>;
export type FormItem = v.InferOutput<typeof formItemSchema>;
export type ComposeItem = v.InferOutput<typeof composeItemSchema>;
export type PassageItem = v.InferOutput<typeof passageItemSchema>;
export type ReadingQuestion = v.InferOutput<typeof readingQuestionSchema>;
export type Material = v.InferOutput<typeof materialSchema>;
export type Block = v.InferOutput<typeof blockSchema>;
export type Sheet = v.InferOutput<typeof sheetSchema>;
export type Tone = v.InferOutput<typeof toneSchema>;
export type ShortItem = v.InferOutput<typeof shortItemSchema>;
export type MidItem = v.InferOutput<typeof midItemSchema>;
export type InfoItem = v.InferOutput<typeof infoItemSchema>;
export type KanjiItem = v.InferOutput<typeof kanjiItemSchema>;
export type SpellingItem = v.InferOutput<typeof spellingItemSchema>;
export type ContextItem = v.InferOutput<typeof contextItemSchema>;
export type ParaphraseItem = v.InferOutput<typeof paraphraseItemSchema>;
/** A Section 1 item: one sentence, one question. */
export type VocabItem = KanjiItem | SpellingItem | ContextItem | ParaphraseItem;
export type Item = v.InferOutput<typeof itemSchema>;

/** Is this a Section 1 item? */
export const isVocab = (item: Item): item is VocabItem =>
  item.type === `kanji` ||
  item.type === `spelling` ||
  item.type === `context` ||
  item.type === `paraphrase`;
/**
 * What kind of question an item asks. It decides a question's instructions, its timer and its card. The 問題 number does not: each test section numbers its own 問題 from 1.
 */
export type ItemType = Item[`type`];

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
  meaning: text,
  /** A Tofugu grammar page, and optionally `#section`, to review the point. */
  tofugu: v.optional(
    v.pipe(v.string(), v.regex(/^[a-z0-9-]+(?:#[a-z0-9-]+)?$/u))
  )
});
export const grammarPointsSchema = v.array(grammarPointSchema);
export type GrammarPoint = v.InferOutput<typeof grammarPointSchema>;

/** Where a student who missed a grammar point can read about it. */
export interface ReviewLink {
  /** The point as the paper writes it, such as `で`. */
  label: string;
  url: string;
}

const TOFUGU = `https://www.tofugu.com/japanese-grammar/`;

/** `particle-de#for-means-of-an-action` as the address it names. */
export const tofuguUrl = (page: string): string => {
  const hash = page.indexOf(`#`);
  return hash === -1
    ? `${TOFUGU}${page}/`
    : `${TOFUGU}${page.slice(0, hash)}/${page.slice(hash)}`;
};

/** Every grammar point an item tests, across its slots, windows or blanks. */
export const pointsOf = (item: Item): string[] => {
  switch (item.type) {
    case `form`:
      return item.slots.flatMap((unit) => unit.points);
    case `compose`:
      return item.windows.flatMap((unit) => unit.points);
    case `passage`:
      return item.blanks.flatMap((unit) => unit.points);
    // Reading tests reading. A question names a point only where one decides it.
    case `short`:
    case `mid`:
    case `info`:
      return item.questions.flatMap((question) => question.points ?? []);
    // Vocabulary tests words, not grammar.
    case `kanji`:
    case `spelling`:
    case `context`:
    case `paraphrase`:
      return [];
  }
};

/**
 * A picture's material as markup, one line per line of the picture.
 *
 * The one text form of the picture: its alt text, the readings line under it, and its share of the timer all come from here, so none can drift from what the picture shows.
 */
export const materialMarkup = (material: Material): string =>
  materialLines(material).join(`\n`);

const blockLines = (block: Block): string[] =>
  `text` in block
    ? block.text
    : `table` in block
      ? [block.table.head, ...block.table.rows].map((row) =>
          row.filter((cell) => cell !== ``).join(` `)
        )
      : `lists` in block
        ? block.lists.flatMap((list) => [
            list.head,
            ...list.rows.map((row) => row.join(` `))
          ])
        : block.panels.flatMap((panel) => [panel.head, ...panel.lines]);

/** A price as a till prints it: ¥1,200. */
export const yen = (amount: number): string =>
  `¥${amount.toLocaleString(`en-US`)}`;

/** How a box on a form reads aloud: ticked or not. */
export const CHECKS = { on: `☑`, off: `☐` } as const;

const optional = (more: readonly string[] | undefined): readonly string[] =>
  more ?? [];

const materialLines = (material: Material): string[] => {
  switch (material.kind) {
    case `stop-timetable`:
      return [
        material.stop,
        material.bound,
        material.columns.join(` / `),
        ...material.rows.map(
          (row) =>
            `${String(row.hour)}: ${row.minutes.map((column) => (column.length === 0 ? `－` : column.join(` `))).join(` / `)}`
        ),
        ...optional(material.notes)
      ];
    case `departure-board`:
      return [
        material.head.join(` `),
        ...material.rows.map(
          (row) => `${row.type} ${row.time} ${row.dest} ${row.track}`
        ),
        ...optional(material.note === undefined ? [] : [material.note])
      ];
    case `route-search`:
      return [
        `${material.from} → ${material.to}`,
        material.when,
        ...material.routes.flatMap((route) => [
          `${route.label} ${route.depart} → ${route.arrive}`,
          `${route.time} ${route.fare} ${route.transfers}`,
          route.legs.join(` → `),
          ...(route.tags === undefined ? [] : [route.tags.join(` `)])
        ])
      ];
    case `fare-chart`:
      return [
        material.title,
        ...material.stations.map(
          (station) => `${station.name} ${station.fare}`
        ),
        ...optional(material.notes)
      ];
    case `station-signs`:
      return material.signs.map(
        (sign) => `${ARROWS[sign.arrow]} ${sign.lines.join(` `)}`
      );
    case `receipt`:
      return [
        material.store,
        ...optional(material.head),
        ...material.items.map((item) => `${item.name} ${yen(item.price)}`),
        ...[material.total, material.paid, material.change].map(
          (line) => `${line.label} ${yen(line.amount)}`
        ),
        ...optional(material.foot)
      ];
    case `machine`:
      return [
        material.title,
        ...material.groups.flatMap((group) => [
          group.head,
          ...group.buttons.map((button) =>
            [button.name, `${String(button.price)}{円|えん}`, button.mark]
              .filter((part) => part !== undefined)
              .join(` `)
          )
        ]),
        ...optional(material.notes)
      ];
    case `stamp-card`:
      return [
        material.shop,
        material.title,
        `スタンプ ${String(material.stamped)} / ${String(material.slots)}`,
        ...material.rewards.map(
          (reward) => `${String(reward.at)}: ${reward.label}`
        ),
        ...optional(material.notes)
      ];
    case `ticket`:
      return [
        material.venue,
        material.title,
        ...material.fields.map((field) => `${field.label} ${field.value}`),
        ...optional(material.stub)
      ];
    case `calendar`:
      return [
        material.title,
        `1: ${material.week[material.first] ?? ``}`,
        ...material.legend.map(
          (entry) =>
            `${entry.short} (${entry.label}): ${material.marks
              .filter((mark) => mark.tone === entry.tone)
              .map((mark) => String(mark.day))
              .join(` `)}`
        ),
        material.week.join(` `),
        ...optional(material.notes)
      ];
    case `weather`:
      return [
        material.title,
        material.labels.join(` / `),
        ...material.days.map(
          (day) =>
            `${day.day} ${day.label} ${String(day.high)}℃ / ${String(day.low)}℃ / ${String(day.rain)}%`
        ),
        ...optional(material.notes)
      ];
    case `medicine-bag`:
      return [
        material.clinic,
        material.patient,
        material.medicine,
        material.slots
          .map(
            (slot) => `${slot.checked ? CHECKS.on : CHECKS.off}${slot.label}`
          )
          .join(` `),
        material.when,
        material.amount,
        material.days,
        ...optional(material.notes)
      ];
    case `form`:
      return [
        material.title,
        ...optional(material.head),
        ...material.fields.flatMap((field) => [
          field.value === undefined
            ? field.label
            : `${field.label} ${field.value}`,
          ...(field.checks ?? []).map(
            (check) =>
              `${check.checked ? CHECKS.on : CHECKS.off} ${check.label}`
          )
        ]),
        ...optional(material.foot)
      ];
    case `chat`:
      return [
        material.room,
        ...optional(material.day === undefined ? [] : [material.day]),
        ...material.messages.map(
          (message) => `${message.from} ${message.time}: ${message.text}`
        )
      ];
    case `notice`:
    case `sign`:
    case `signboard`:
    case `poster`:
    case `board`:
    case `chalkboard`:
    case `flyer`:
    case `whiteboard`:
    case `directory`:
    case `timetable`:
      return [
        ...optional(material.head),
        material.title,
        ...material.blocks.flatMap(blockLines),
        ...optional(material.foot)
      ];
  }
};

/**
 * The review link for every point an item uses, by point id.
 *
 * Only points with a page, and only points in use, so the bundle carries no link that no question can show.
 */
export const reviewLinksOf = (
  points: readonly GrammarPoint[],
  items: readonly Item[]
): Record<string, ReviewLink> => {
  const used = new Set(items.flatMap(pointsOf));
  return Object.fromEntries(
    points.flatMap((point) =>
      point.tofugu !== undefined && used.has(point.id)
        ? [[point.id, { label: point.pattern, url: tofuguUrl(point.tofugu) }]]
        : []
    )
  );
};

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
/**
 * What a passage's blanks need because a test asks any four of them and shows the rest filled in.
 *
 * Two blanks on one grammar point would test it twice on one card, and a filled one would give the other away. Two blanks with only punctuation between them read as one gap.
 */
const passageBlankProblems = (item: PassageItem): string[] => {
  const problems: string[] = [];
  const first = new Map<string, number>();
  item.blanks.forEach((blank, index) => {
    for (const point of blank.points) {
      const earlier = first.get(point);
      if (earlier === undefined) first.set(point, index + 1);
      else
        problems.push(
          `${item.id}: blanks （${String(earlier)}） and （${String(index + 1)}） both test ${point}`
        );
    }
  });
  const marks = [...item.text.matchAll(/（(\d+)）/gu)];
  marks.slice(1).forEach((mark, index) => {
    const before = marks[index];
    const gap = item.text.slice(before.index + before[0].length, mark.index);
    if (gap.replace(/[\s、。「」]/gu, ``) === ``)
      problems.push(
        `${item.id}: blanks ${before[0]} and ${mark[0]} sit side by side`
      );
  });
  return problems;
};

/**
 * Reading markup: ruby only. `（1）` is a blank to the parser, and reading has none, so a number in brackets must be written another way.
 */
const readingMarkupProblems = (markup: string, where: string): string[] => [
  ...(parse(markup).some((segment) => segment.kind === `blank`)
    ? [
        `${where}: reading text has no （n） blanks; write the number another way`
      ]
    : []),
  ...markupProblems(markup, where)
];

/**
 * A medium or hard question says why each wrong option is wrong, because the answer may not be obvious to a student (the user's rule, 2026-11-22). An easy question's note is enough.
 */
const whyProblems = (
  wrongs: readonly Option[],
  difficulty: Difficulty,
  where: string
): string[] =>
  difficulty === 1
    ? []
    : wrongs
        .filter((wrong) => whyOf(wrong) === undefined)
        .map(
          (wrong) =>
            `${where}: a medium or hard question says why each wrong option is wrong; "${optionText(wrong)}" has no why`
        );

const readingQuestionProblems = (
  question: ReadingQuestion,
  points: ReadonlySet<string>,
  where: string
): string[] => {
  const problems = readingMarkupProblems(
    question.question,
    `${where} question`
  );
  // The wrong options, whichever way the question holds them.
  const wrongs =
    `wrong` in question
      ? question.wrong
      : question.options.filter((_, index) => index + 1 !== question.answer);
  if (`wrong` in question) {
    const texts = question.wrong.map(optionText);
    if (texts.includes(question.answer)) {
      problems.push(`${where}: the answer is also in the wrong pool`);
    }
    if (new Set(texts).size !== texts.length) {
      problems.push(`${where}: the wrong pool repeats an option`);
    }
    problems.push(
      ...readingMarkupProblems(question.answer, `${where} answer`),
      ...texts.flatMap((wrong) =>
        readingMarkupProblems(wrong, `${where} wrong`)
      )
    );
  } else {
    const texts = question.options.map(optionText);
    if (new Set(texts).size !== texts.length) {
      problems.push(`${where}: two options are the same`);
    }
    const answer = question.options.at(question.answer - 1);
    if (answer !== undefined && whyOf(answer) !== undefined) {
      problems.push(`${where}: the answer has a why, as if it were wrong`);
    }
    problems.push(
      ...texts.flatMap((option) =>
        readingMarkupProblems(option, `${where} option`)
      )
    );
  }
  problems.push(...whyProblems(wrongs, question.difficulty, where));
  for (const point of question.points ?? []) {
    if (!points.has(point)) {
      problems.push(`${where}: grammar point "${point}" is not in the list`);
    }
  }
  return problems;
};

/**
 * Every string in a picture's material, with where it sits.
 *
 * Walks the data rather than naming fields, so a field added to a document kind is checked the day it exists. Names such as `tone` hold no kanji, so they pass.
 */
const stringsOf = (
  value: unknown,
  at: string
): Array<{ text: string; at: string }> => {
  if (typeof value === `string`) return [{ text: value, at }];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      stringsOf(entry, `${at} ${String(index + 1)}`)
    );
  }
  if (typeof value === `object` && value !== null) {
    return Object.entries(value).flatMap(([key, entry]) =>
      stringsOf(entry, `${at} ${key}`)
    );
  }
  return [];
};

/** What the schema cannot see: sums that must add up, rows that must fill their columns. */
const structureProblems = (material: Material, where: string): string[] => {
  switch (material.kind) {
    case `stop-timetable`:
      return [
        ...material.rows.flatMap((row) =>
          row.minutes.length === material.columns.length
            ? []
            : [
                `${where} hour ${String(row.hour)}: ${String(row.minutes.length)} lists of minutes, but there are ${String(material.columns.length)} columns`
              ]
        ),
        ...(material.rows.every(
          (row, index) =>
            index === 0 || row.hour > material.rows[index - 1].hour
        )
          ? []
          : [`${where}: the hours must run in order`])
      ];
    case `fare-chart`:
      return material.stations.filter((station) => station.here).length === 1
        ? []
        : [`${where}: mark exactly one station as the one you are at`];
    case `receipt`: {
      const sum = material.items.reduce((all, item) => all + item.price, 0);
      const { total, paid, change } = material;
      return [
        ...(sum === total.amount
          ? []
          : [
              `${where}: the items add up to ${yen(sum)}, but the total says ${yen(total.amount)}`
            ]),
        ...(paid.amount - total.amount === change.amount
          ? []
          : [
              `${where}: ${yen(paid.amount)} paid for ${yen(total.amount)} leaves ${yen(paid.amount - total.amount)}, but the change says ${yen(change.amount)}`
            ])
      ];
    }
    case `calendar`: {
      const tones = material.legend.map((entry) => entry.tone);
      const days = material.marks.map((mark) => mark.day);
      return [
        ...(new Set(tones).size === tones.length
          ? []
          : [`${where}: two legend entries share a colour`]),
        ...material.marks.flatMap((mark) => [
          ...(tones.includes(mark.tone)
            ? []
            : [
                `${where}: day ${String(mark.day)} is ${mark.tone}, which the legend does not explain`
              ]),
          ...(mark.day >= 1 && mark.day <= material.days
            ? []
            : [
                `${where}: day ${String(mark.day)} is not in a ${String(material.days)}-day month`
              ])
        ]),
        ...(new Set(days).size === days.length
          ? []
          : [`${where}: a day is marked twice`])
      ];
    }
    case `stamp-card`:
      return [
        ...(material.stamped <= material.slots
          ? []
          : [
              `${where}: ${String(material.stamped)} stamps on a card of ${String(material.slots)}`
            ]),
        ...material.rewards.flatMap((reward) =>
          reward.at >= 1 && reward.at <= material.slots
            ? []
            : [
                `${where}: a reward at stamp ${String(reward.at)}, but the card has ${String(material.slots)}`
              ]
        )
      ];
    case `departure-board`:
    case `route-search`:
    case `station-signs`:
    case `machine`:
    case `ticket`:
    case `weather`:
    case `medicine-bag`:
    case `form`:
    case `chat`:
      return [];
    case `notice`:
    case `sign`:
    case `signboard`:
    case `poster`:
    case `board`:
    case `chalkboard`:
    case `flyer`:
    case `whiteboard`:
    case `directory`:
    case `timetable`:
      return material.blocks.flatMap((block, index) => {
        if (!(`table` in block)) return [];
        const { head, rows } = block.table;
        return rows.flatMap((row, number) =>
          row.length === head.length
            ? []
            : [
                `${where} block ${String(index + 1)} row ${String(number + 1)}: ${String(row.length)} cells, but the head has ${String(head.length)}`
              ]
        );
      });
  }
};

const materialProblems = (material: Material, where: string): string[] => [
  ...stringsOf(material, where).flatMap(({ text: markup, at }) =>
    readingMarkupProblems(markup, at)
  ),
  ...structureProblems(material, where)
];

const questionsProblems = (
  questions: readonly ReadingQuestion[],
  points: ReadonlySet<string>,
  id: string
): string[] =>
  questions.flatMap((question, index) =>
    readingQuestionProblems(
      question,
      points,
      `${id} question ${String(index + 1)}`
    )
  );

/** A 漢字読み or 表記 question's underlined word: `__半分__`. */
const TARGET = /__([^_]+)__/gu;
/** What a 漢字読み answer is written in: the paper asks for it ひらがなで. */
const HIRAGANA = /^\p{Script=Hiragana}+$/u;

/** The underlined words in a vocabulary sentence. */
export const targetsOf = (sentence: string): string[] =>
  [...sentence.matchAll(TARGET)].map(([, word]) => word);

/** A vocabulary sentence with its underlined word shown another way: written, or with its reading. */
export const withTarget = (
  sentence: string,
  show: (word: string) => string
): string => sentence.replace(TARGET, (_, word: string) => show(word));

/** A vocabulary sentence without its underlined word. */
const outsideTargets = (sentence: string): string =>
  sentence.replaceAll(TARGET, ``);

const kanjiIn = (text: string): string[] =>
  text.match(/\p{Script=Han}/gu) ?? [];

/**
 * What is mechanically wrong with a Section 1 item.
 *
 * The paper's script rule is the heart of it: everything in kana except what is tested. A kanji elsewhere would need a reading the paper does not print, and a reading on the card could give a 漢字読み answer away.
 */
const vocabProblems = (item: VocabItem): string[] => {
  const where = item.id;
  const texts = item.wrong.map(optionText);
  const options = [item.answer, ...texts];
  const targets = targetsOf(item.sentence);
  const problems: string[] = [];

  if (texts.includes(item.answer)) {
    problems.push(`${where}: the answer is also in the wrong pool`);
  }
  if (new Set(texts).size !== texts.length) {
    problems.push(`${where}: the wrong pool repeats an option`);
  }
  if (/[{}|]/u.test(item.sentence)) {
    problems.push(
      `${where}: Section 1 prints no readings; write the sentence without ruby`
    );
  }
  problems.push(...whyProblems(item.wrong, item.difficulty, where));

  const underlined = item.type === `kanji` || item.type === `spelling`;
  if (underlined && targets.length !== 1) {
    problems.push(`${where}: underline exactly one word, as __…__`);
  }
  if (!underlined && targets.length > 0) {
    problems.push(`${where}: only 漢字読み and 表記 underline a word`);
  }
  const blanks = item.sentence.split(BLANK).length - 1;
  if (item.type === `context` ? blanks !== 1 : blanks > 0) {
    problems.push(
      item.type === `context`
        ? `${where}: a 文脈規定 sentence has exactly one ${BLANK}`
        : `${where}: only 文脈規定 has a ${BLANK}`
    );
  }

  // Everything but the tested word is kana.
  const outside =
    item.type === `kanji` ? outsideTargets(item.sentence) : item.sentence;
  for (const char of kanjiIn(outside)) {
    problems.push(
      `${where}: kanji ${char} in the sentence; Section 1 writes everything but the tested word in kana`
    );
  }

  switch (item.type) {
    case `kanji`: {
      const [target = ``] = targets;
      if (kanjiIn(target).length === 0) {
        problems.push(`${where}: the underlined word has no kanji to read`);
      }
      for (const char of kanjiIn(target)) {
        if (!PAPER_KANJI.has(char)) {
          problems.push(
            `${where}: kanji ${char} is above N4; the paper would not ask its reading`
          );
        }
      }
      for (const option of options) {
        if (!HIRAGANA.test(option)) {
          problems.push(
            `${where}: option "${option}" is not hiragana; 漢字読み answers are written ひらがなで`
          );
        }
      }
      break;
    }
    case `spelling`: {
      const [target = ``] = targets;
      if (!KANA.test(target.replaceAll(` `, ``))) {
        problems.push(
          `${where}: the underlined word must be kana; it is what the student spells`
        );
      }
      if (HIRAGANA.test(item.answer)) {
        problems.push(
          `${where}: the answer is all hiragana; a 表記 answer is written in kanji or katakana`
        );
      }
      for (const char of kanjiIn(item.answer)) {
        if (!PAPER_KANJI.has(char)) {
          problems.push(
            `${where}: kanji ${char} is above N4; the paper would not ask the student to write it`
          );
        }
      }
      break;
    }
    case `context`:
    case `paraphrase`:
      for (const char of options.flatMap(kanjiIn)) {
        problems.push(
          `${where}: kanji ${char} in an option; Section 1 writes these in kana`
        );
      }
      break;
  }
  return problems;
};

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
        ...blankedProblems(item.text, item.blanks, points, item.id),
        ...passageBlankProblems(item)
      ];
    case `short`:
    case `mid`:
      return [
        ...(item.intro === undefined
          ? []
          : readingMarkupProblems(item.intro, `${item.id} intro`)),
        ...readingMarkupProblems(item.text, item.id),
        ...questionsProblems(item.questions, points, item.id)
      ];
    case `info`:
      return [
        ...materialProblems(item.material, item.id),
        ...questionsProblems(item.questions, points, item.id)
      ];
    case `kanji`:
    case `spelling`:
    case `context`:
    case `paraphrase`:
      return vocabProblems(item);
  }
};

/**
 * `data/jlpt/vocab.json`: the N5 and N4 words, as JMdict writes and reads them, and every reading of their kanji spellings. Built by `exam:vocab`.
 */
export const vocabListSchema = v.strictObject({
  source: text,
  levels: text,
  license: text,
  words: v.array(
    v.strictObject({
      level: v.picklist([5, 4]),
      kanji: v.array(text),
      kana: v.array(text)
    })
  ),
  /** Every reading JMdict gives a kanji spelling, from every entry that has it. */
  readings: v.record(v.string(), v.array(text))
});
export type VocabList = v.InferOutput<typeof vocabListSchema>;

type ListedWord = VocabList[`words`][number];

/** Every listed word a spelling or reading belongs to. */
const listedAs = (list: VocabList, form: string): ListedWord[] =>
  list.words.filter(
    (word) => word.kanji.includes(form) || word.kana.includes(form)
  );

/**
 * What the word list says is wrong with a 漢字読み or 表記 item.
 *
 * The trap a reviewer misses most: an option that is wrong here but right somewhere. 大人 is おとな, but JMdict also reads it だいにん, as a fare sign does; はし is 橋 and also 箸. So no 漢字読み option may be another reading of its kanji, and no 表記 option another N5 or N4 word with the same reading. An underlined word that is not the word's own form (書いて for 書く) is checked only for its word.
 */
export const wordProblems = (
  items: readonly Item[],
  list: VocabList
): string[] => {
  const readings = new Map(Object.entries(list.readings));
  return items.flatMap((item) => {
    if (item.type !== `kanji` && item.type !== `spelling`) return [];
    const where = item.id;
    if (listedAs(list, item.word).length === 0) {
      return [
        `${where}: ${item.word} is not an N5 or N4 word on the list; check its spelling, or choose another word`
      ];
    }
    const [target = ``] = targetsOf(item.sentence);
    const wrongs = item.wrong.map(optionText);
    const problems: string[] = [];

    if (item.type === `kanji`) {
      const read = readings.get(target);
      if (read === undefined) return [];
      if (!read.includes(item.answer)) {
        problems.push(
          `${where}: JMdict does not read ${target} as ${item.answer}`
        );
      }
      for (const wrong of wrongs.filter((option) => read.includes(option))) {
        problems.push(
          `${where}: ${wrong} is also a reading of ${target}, so the option is right somewhere`
        );
      }
      return problems;
    }

    const kana = target.replaceAll(` `, ``);
    const sameSound = list.words.filter((word) => word.kana.includes(kana));
    const own = sameSound.filter(
      (word) => word.kanji.includes(item.word) || word.kana.includes(item.word)
    );
    if (
      own.length > 0 &&
      !own.some(
        (word) =>
          word.kanji.includes(item.answer) || word.kana.includes(item.answer)
      )
    ) {
      problems.push(
        `${where}: ${item.answer} is not how JMdict writes ${kana}`
      );
    }
    for (const wrong of wrongs) {
      if (
        sameSound.some(
          (word) => word.kanji.includes(wrong) || word.kana.includes(wrong)
        )
      ) {
        problems.push(
          `${where}: ${wrong} is also an N5 or N4 word read ${kana}, so the option is right somewhere`
        );
      }
    }
    return problems;
  });
};

/** What the word list says a reviewer should look at: a word from N4, which the N5 paper rarely tests. */
export const wordHints = (items: readonly Item[], list: VocabList): string[] =>
  items.flatMap((item) =>
    (item.type === `kanji` || item.type === `spelling`) &&
    listedAs(list, item.word).length > 0 &&
    listedAs(list, item.word).every((word) => word.level === 4)
      ? [`${item.id}: ${item.word} is an N4 word; the N5 paper tests N5 words`]
      : []
  );

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
export const itemHints = (item: Item): string[] => {
  // Reading options are short sentences, and nearly all end in ます。, which cannot move. So for reading only whole shared words count: the ending after its first space. バスで 行きます。 and あるいて 行きます。 share 行きます。; 食べます。 and 飲みます。 share nothing worth moving. Ordered options are left out: times and prices share 時 or 円 because the paper writes them that way.
  const pools: Array<{ label: string; options: string[]; words: boolean }> =
    item.type === `form` || item.type === `passage`
      ? (item.type === `form` ? item.slots : item.blanks).map(
          (slot, index) => ({
            label: `slot ${String(index + 1)}`,
            options: [slot.answer, ...slot.wrong],
            words: false
          })
        )
      : item.type === `short` || item.type === `mid` || item.type === `info`
        ? item.questions.flatMap((question, index) =>
            `wrong` in question
              ? [
                  {
                    label: `question ${String(index + 1)}`,
                    options: [
                      question.answer,
                      ...question.wrong.map(optionText)
                    ],
                    words: true
                  }
                ]
              : []
          )
        : // A ★ window's options are its chunks; a vocabulary option is a whole word or sentence, as the paper prints it.
          [];
  const giveaway =
    (item.type === `kanji` || item.type === `spelling`) &&
    outsideTargets(item.sentence).includes(item.answer)
      ? [
          `${item.id}: the answer "${item.answer}" also appears outside the underlined word, which may give it away`
        ]
      : [];
  return [
    ...giveaway,
    ...pools.flatMap(({ label, options, words }) => {
      const shared = sharedEnding(options.map(plain));
      const space = shared.indexOf(` `);
      const ending = !words
        ? shared
        : space === -1
          ? ``
          : shared.slice(space + 1);
      return ending === ``
        ? []
        : [
            `${item.id} ${label}: every option ends in "${ending}"; move it into the sentence unless it is part of what varies`
          ];
    })
  ];
};

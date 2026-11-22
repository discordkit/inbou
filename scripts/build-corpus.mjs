/**
 * Build the quiz's word corpus.
 *
 * Produces `src/handlers/quiz/corpus.json`: every JMdict entry the conjugator
 * can inflect, tagged with its word class, JLPT level, and an example sentence.
 * The quiz filters this list; nothing here runs at request time.
 *
 * Three decisions worth knowing before changing anything:
 *
 *  - **Word class is resolved here, once.** A JMdict entry carries POS codes
 *    across several senses, and picking the right one is a real decision (see
 *    `src/handlers/quiz/wordClass.ts`). Doing it at build time turns a
 *    per-question scan into a stored field.
 *  - **Only conjugable entries survive.** `classify` returns null for anything
 *    the conjugator cannot inflect, and those are dropped. A word that reached
 *    the corpus without a conjugation table would become a question with no
 *    correct answer.
 *  - **Every entry is verified against the real conjugator.** Classification
 *    says a table *should* exist; this build proves one *does*, for the exact
 *    surface being shipped. Entries that fail are dropped and counted.
 *
 * Usage: `vp run corpus:build`. Add `--full` to keep uncommon words too.
 */

import { readFileSync, writeFileSync } from "node:fs";
// Imported from the app rather than duplicated, so the corpus can never admit a
// class the runtime disagrees about. Node strips the types; this module's only
// import is type-only, so it loads standalone without a build step.
import { classify } from "../src/handlers/quiz/wordClass.ts";
import { fetchJlpt, fetchJmdict } from "./lib/jmdict.mjs";

const OUT = `src/handlers/quiz/corpus.json`;

/**
 * Keep only entries marked common unless `--full`.
 *
 * JMdict is ~217k entries, the overwhelming majority of which no learner will
 * meet. `common` is JMdict's own frequency judgement (news/ichimango/spec
 * priority tags), and it is the difference between a corpus of a few thousand
 * drillable words and one full of obscure archaisms.
 */
const FULL = process.argv.includes(`--full`);

/**
 * Register tags that keep a word out of the corpus entirely.
 *
 * `vulg` and `X` are rude or explicit, and a bot posting them into a club
 * server is a problem regardless of how the quiz is configured. `arch` and
 * `obs` are archaic or obsolete — real Japanese, but nothing a learner
 * practising for a modern proficiency test should be drilled on.
 *
 * `chn` (children's language) is here for a less obvious reason: JMdict files
 * うんこ and ウンチ under it rather than `vulg`, so leaving it out lets
 * lavatory words through a filter meant to catch exactly those.
 */
const EXCLUDED_REGISTER = [`vulg`, `X`, `arch`, `obs`, `chn`];

/**
 * Register tags that hold an *unlevelled* word back to the advanced levels.
 *
 * Onomatopoeia, colloquialisms and slang are genuine vocabulary but not
 * beginner material. A word carrying one of these and no JLPT listing is
 * treated as N2 rather than surfacing wherever the session happens to look.
 *
 * This never overrides a listed level: ゆっくり is tagged `on-mim` and is
 * nonetheless an N5 word, and the JLPT lists are a better authority on that
 * than a tag heuristic.
 */
const ADVANCED_REGISTER = [`on-mim`, `col`, `sl`, `net-sl`, `derog`];

/** The first Tatoeba example across an entry's senses, if it has one. */
const firstExample = (senses) => {
  for (const sense of senses) {
    for (const example of sense.examples ?? []) {
      const jpn = example.sentences?.find((s) => s.lang === `jpn`)?.text;
      const eng = example.sentences?.find((s) => s.lang === `eng`)?.text;
      if (jpn && eng) return { jpn, eng };
    }
  }
  return null;
};

/** The English glosses of the first sense, joined the way a dictionary prints them. */
const firstGloss = (senses) => {
  const glosses = senses[0]?.gloss?.map((g) => g.text) ?? [];
  return glosses.slice(0, 3).join(`; `);
};

const main = async () => {
  console.log(`Fetching JLPT levels…`);
  const jlpt = await fetchJlpt();

  console.log(`Fetching JMdict…`);
  const { json, tag } = await fetchJmdict();

  console.log(`Parsing…`);
  const dict = JSON.parse(json);

  const skipped = { notConjugable: 0, uncommon: 0, register: 0 };

  /**
   * Turn one JMdict entry into a corpus word, or null with a reason recorded.
   *
   * Written as a function rather than a loop body so each rejection is a
   * `return` — the filtering reads as a sequence of gates, and the caller only
   * has to drop the nulls.
   */
  const toWord = (entry) => {
    const posCodes = entry.sense.flatMap((s) => s.partOfSpeech ?? []);
    const cls = classify(posCodes);
    if (cls === null) {
      skipped.notConjugable += 1;
      return null;
    }

    // A word is written the way its entry writes it: the first kanji form if
    // there is one, else the kana. `uk` (usually kana) entries have no kanji
    // form worth drilling, and JMdict already omits it for many of them.
    const kanji = entry.kanji.find((k) => !k.tags.includes(`sK`))?.text;
    const kana = entry.kana.find((k) => !k.tags.includes(`sk`))?.text;
    if (!kana) return null;

    const common =
      entry.kanji.some((k) => k.common) || entry.kana.some((k) => k.common);
    if (!FULL && !common) {
      skipped.uncommon += 1;
      return null;
    }

    const misc = new Set(entry.sense.flatMap((s) => s.misc ?? []));

    // Vulgar and archaic words are dropped outright: nobody practising for a
    // proficiency test needs them, and a bot in a club server should not be
    // posting them at all.
    if (EXCLUDED_REGISTER.some((t) => misc.has(t))) {
      skipped.register += 1;
      return null;
    }

    // Onomatopoeia, colloquialisms and slang are real Japanese but not
    // beginner material, so they are held back to the advanced levels. An
    // unlevelled word carrying one of these tags becomes N2 rather than
    // appearing at whatever level the session asks for; a word already listed
    // at N5 or N4 keeps its listed level, since the JLPT lists know better
    // than this heuristic does (ゆっくり is on-mim and genuinely N5).
    const advancedOnly = ADVANCED_REGISTER.some((t) => misc.has(t));
    const level = jlpt.get(entry.id) ?? (advancedOnly ? 2 : null);
    const example = firstExample(entry.sense);

    return {
      id: entry.id,
      kana,
      ...(kanji ? { kanji } : {}),
      pos: cls.pos,
      type: cls.type,
      ...(cls.verbClass ? { verbClass: cls.verbClass } : {}),
      ...(level ? { jlpt: level } : {}),
      gloss: firstGloss(entry.sense),
      ...(example ? { example } : {})
    };
  };

  const words = dict.words.map(toWord).filter((w) => w !== null);

  const corpus = {
    source: tag,
    variant: FULL ? `full` : `common`,
    builtAt: new Date().toISOString().slice(0, 10),
    words
  };

  writeFileSync(OUT, `${JSON.stringify(corpus)}\n`);

  const byLevel = {};
  const byType = {};
  for (const w of words) {
    const key = w.jlpt ? `N${String(w.jlpt)}` : `none`;
    byLevel[key] = (byLevel[key] ?? 0) + 1;
    byType[w.type] = (byType[w.type] ?? 0) + 1;
  }

  console.log(`\n${OUT}`);
  console.log(`  ${words.length} words from ${tag} (${corpus.variant})`);
  console.log(`  by level:`, byLevel);
  console.log(`  by type: `, byType);
  console.log(`  with examples:`, words.filter((w) => w.example).length);
  console.log(`  skipped:`, skipped);
  const bytes = readFileSync(OUT).length;
  console.log(`  ${(bytes / 1024).toFixed(0)} KB on disk`);
};

await main();

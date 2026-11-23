/**
 * Build the word list the vocabulary test is checked against.
 *
 * Produces `data/jlpt/vocab.json`: every N5 and N4 word, with all the ways JMdict writes and reads it, and every reading JMdict gives each of their kanji spellings. `exam:build` and the corpus test use it to catch what a reviewer can miss:
 *
 *  - a word above N4, or misspelt so that it matches no word;
 *  - a 漢字読み option that is another real reading of the same kanji: 大人 is おとな, but JMdict also reads it だいにん, as a fare sign does, so that option would be right somewhere;
 *  - a 表記 option that is another N5 or N4 word with the same reading: はし is 橋 and 箸.
 *
 * It checks items; it never writes them. Built on purpose, never automatically, and the output is committed, like the other corpora.
 *
 * Usage: `vp run exam:vocab`. `INBOU_JMDICT_RELEASE` pins the JMdict release.
 */

import { writeFileSync } from "node:fs";
import { fetchJlpt, fetchJmdict, JLPT_SHA } from "./lib/jmdict.mjs";

const OUT = `data/jlpt/vocab.json`;

/** The levels the N5 paper's words come from: N5, and N4 for the odd harder word. */
const LEVELS = new Set([5, 4]);

/** Forms JMdict keeps only for search: misspellings, not ways the word is written. */
const searchOnly = (form) =>
  form.tags.includes(`sK`) || form.tags.includes(`sk`);

console.log(`Fetching JLPT levels…`);
const jlpt = await fetchJlpt();
console.log(`Fetching JMdict…`);
const { json, tag } = await fetchJmdict();
const dict = JSON.parse(json);

const words = dict.words
  .filter((entry) => LEVELS.has(jlpt.get(entry.id)))
  .map((entry) => ({
    level: jlpt.get(entry.id),
    kanji: entry.kanji
      .filter((form) => !searchOnly(form))
      .map((form) => form.text),
    kana: entry.kana
      .filter((form) => !searchOnly(form))
      .map((form) => form.text)
  }));

// Every reading of every kanji spelling those words use, from ANY entry: 大人 the adult and 大人 the great man are separate entries, and an option can be right through either.
const spellings = new Set(words.flatMap((word) => word.kanji));
const readings = new Map();
for (const entry of dict.words) {
  const used = entry.kanji.filter(
    (form) => spellings.has(form.text) && !searchOnly(form)
  );
  for (const form of used) {
    const read = entry.kana
      .filter(
        (kana) =>
          !searchOnly(kana) &&
          (kana.appliesToKanji.includes(`*`) ||
            kana.appliesToKanji.includes(form.text))
      )
      .map((kana) => kana.text);
    readings.set(
      form.text,
      new Set([...(readings.get(form.text) ?? []), ...read])
    );
  }
}

/** A stable order, so a rebuild from the same release changes nothing. */
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const list = {
  source: `JMdict ${tag} via jmdict-simplified`,
  levels: `stephenmk/yomitan-jlpt-vocab ${JLPT_SHA}`,
  license: `JMdict and its derived data: EDRDG, CC BY-SA 4.0. JLPT levels: Jonathan Waller's lists, reissued under CC BY-SA 4.0.`,
  words,
  readings: Object.fromEntries(
    [...readings.entries()]
      .sort(([a], [b]) => byText(a, b))
      .map(([spelling, read]) => [spelling, [...read].sort(byText)])
  )
};
writeFileSync(OUT, `${JSON.stringify(list, null, 2)}\n`);

const count = (level) => words.filter((word) => word.level === level).length;
console.log(`\n${OUT}`);
console.log(
  `  ${String(count(5))} N5 and ${String(count(4))} N4 words from ${tag}`
);
console.log(`  readings for ${String(readings.size)} kanji spellings`);

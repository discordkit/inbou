/**
 * Build the mock-test corpus.
 *
 * Reads the hand-written items under `data/jlpt/n5/`, checks every one of them,
 * and writes the reviewed ones to `src/handlers/exam/corpus.json`. Like the
 * word corpus, it is built on purpose, never automatically, and the output is
 * committed.
 *
 * Three rules worth knowing before changing anything:
 *
 *  - **Every item is checked, drafts included.** A draft with a broken blank is
 *    a problem now, not when someone reviews it. One problem fails the build.
 *  - **Only reviewed items ship.** Code cannot tell whether a wrong option is
 *    really wrong in its sentence; a person has to. `--drafts` includes drafts
 *    for a local preview, and must never be committed — `exam.spec.ts` fails if
 *    it is.
 *  - **The checks are the app's own.** `items.ts` imports only valibot so this
 *    script can load it, and `blueprint.ts` only a type, so the coverage report
 *    reads the same blueprint the draw does.
 *
 * Usage: `vp run exam:build`, or `vp run exam:build -- --drafts` to preview.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import * as v from "valibot";
import { parse } from "yaml";
import { BLUEPRINTS } from "../src/handlers/exam/blueprint.ts";
import {
  corpusProblems,
  grammarPointsSchema,
  itemHints,
  itemProblems,
  itemsSchema,
  pointsOf,
  reviewLinksOf
} from "../src/handlers/exam/items.ts";

const ROOT = `data/jlpt/n5`;
const OUT = `src/handlers/exam/corpus.json`;
const DRAFTS = process.argv.includes(`--drafts`);

const read = (path) => parse(readFileSync(path, `utf8`));

/** Parse with a schema, or stop with every issue and where it is. */
const parseOrExit = (schema, data, file) => {
  const result = v.safeParse(schema, data);
  if (result.success) return result.output;
  for (const issue of result.issues) {
    const path = (issue.path ?? []).map((step) => step.key).join(`.`);
    console.error(`${file} ${path}: ${issue.message}`);
  }
  process.exit(1);
};

const points = parseOrExit(
  grammarPointsSchema,
  read(`${ROOT}/grammar-points.yaml`),
  `grammar-points.yaml`
);
const pointIds = new Set(points.map((point) => point.id));
if (pointIds.size !== points.length) {
  console.error(`grammar-points.yaml: a grammar point id is used twice`);
  process.exit(1);
}

const items = readdirSync(`${ROOT}/bunpou`)
  .filter((file) => file.endsWith(`.yaml`))
  .sort()
  .flatMap((file) =>
    parseOrExit(itemsSchema, read(`${ROOT}/bunpou/${file}`), file)
  );

const problems = [
  ...corpusProblems(items),
  ...items.flatMap((item) => itemProblems(item, pointIds))
];
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`\n${String(problems.length)} problems. Nothing was written.`);
  process.exit(1);
}

// Hints never fail the build: they need a reviewer's judgement.
const hints = items.flatMap(itemHints);
for (const hint of hints) console.log(`hint: ${hint}`);

const shipped = items.filter((item) => DRAFTS || item.status === `reviewed`);
const review = reviewLinksOf(points, shipped);
writeFileSync(
  OUT,
  `${JSON.stringify({ level: `N5`, drafts: DRAFTS, items: shipped, review }, null, 2)}\n`
);

console.log(
  `Wrote ${String(shipped.length)} of ${String(items.length)} items to ${OUT}${
    DRAFTS ? ` — DRAFTS INCLUDED, do not commit` : ``
  }.`
);

// Review links: which points in use have no Tofugu page, so the gaps stay visible.
const linkless = [...new Set(shipped.flatMap(pointsOf))].filter(
  (point) => !(point in review)
);
console.log(
  `Review links: ${String(Object.keys(review).length)} points in use have one${
    linkless.length === 0 ? `.` : `; none for ${linkless.join(`, `)}.`
  }`
);

// Coverage: how many cards each deck holds, beside what one test draws. A
// deck is playable when it holds at least twice that, so two tests in a row
// differ. 問題1's cards are slots, 問題2's windows, and 問題3's whole passages.
const unitsOf = (mondai) =>
  shipped.flatMap((item) =>
    mondai === 1 && item.type === `form`
      ? item.slots
      : mondai === 2 && item.type === `compose`
        ? item.windows
        : []
  );
const report = (label, have, draw) =>
  console.log(
    `${label}: ${String(have)} cards, a test draws ${String(draw)} (${have >= draw * 2 ? `ok` : `short`})`
  );

for (const [test, plans] of Object.entries(BLUEPRINTS)) {
  for (const plan of plans) {
    if (plan.mondai === 3) {
      const passages = shipped.filter(
        (item) => item.type === `passage` && item.blanks.length >= plan.blanks
      ).length;
      report(`${test} 問題3 passages`, passages, 1);
    } else {
      const units = unitsOf(plan.mondai);
      for (const level of [1, 2, 3]) {
        report(
          `${test} 問題${String(plan.mondai)} difficulty ${String(level)}`,
          units.filter((unit) => unit.difficulty === level).length,
          plan.mix[level]
        );
      }
    }
  }
}

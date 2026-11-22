#!/usr/bin/env node
/* oxlint-disable no-console */
/* oxlint-disable no-await-in-loop -- one picture at a time, so only one canvas and its fonts are in memory at once */
/**
 * Draw every 問題6 picture the corpus ships, for the assets Worker to host.
 *
 * Reads `corpus.json` and writes each picture to `dist/assets/` under the name the corpus build gave it. The names are hashes of what each picture draws, so a file already there is the same picture and is not drawn again.
 *
 * Fails, and writes nothing, when:
 *
 *  - **corpus.json is stale.** A template or font changed since `exam:build`, so the handlers would link a name this draw does not produce, and the card would show a broken picture.
 *  - **a picture does not fit.** Taller than the height cap, or with text running past the right edge, where it would be cut off.
 *
 * Usage: `vp run exam:draw`.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { measure, render } from "takumi-js";
// Before the templates load: it lets their "./kit.js" imports reach the .ts files.
import "./lib/ts-hooks.mjs";
import {
  fontsFor,
  overflowOf,
  pictureName,
  versionsOf
} from "./lib/pictures.mjs";

const REPO = process.cwd();
const OUT = join(REPO, `dist/assets`);
/** Drawn at twice the layout size, so the picture stays sharp when a phone or a full-size view scales it up. */
const SCALE = 2;

const { materialHtml, materialWidth, MATERIAL_MAX_HEIGHT } = await import(
  `../src/handlers/exam/material/index.ts`
);
const { bare } = await import(`../src/handlers/exam/items.ts`);

const corpus = JSON.parse(
  readFileSync(join(REPO, `src/handlers/exam/corpus.json`), `utf8`)
);
const versions = versionsOf(REPO);
const fonts = fontsFor(REPO);

const problems = [];
const plans = [];
for (const item of corpus.items.filter((entry) => entry.type === `info`)) {
  const html = materialHtml(item.material, bare);
  const width = materialWidth(item.material);
  const name = pictureName(item.id, html, width, versions);
  if (corpus.pictures?.[item.id] === name) {
    const tree = await measure(html, {
      width,
      height: MATERIAL_MAX_HEIGHT * 3,
      fonts
    });
    const height = Math.ceil(tree.height);
    if (height > MATERIAL_MAX_HEIGHT) {
      problems.push(
        `${item.id}: ${String(height)} px tall, over the ${String(MATERIAL_MAX_HEIGHT)} px cap`
      );
    }
    for (const over of overflowOf(tree, width)) {
      problems.push(
        `${item.id}: text runs past the right edge (${String(width)} px): ${over}`
      );
    }
    plans.push({ html, width, height, name });
  } else {
    problems.push(
      `${item.id}: corpus.json names this picture ${corpus.pictures?.[item.id] ?? `nothing`}, but it draws as ${name}. Run \`vp run exam:build\`.`
    );
  }
}

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(problem);
  }
  console.error(`\n${String(problems.length)} problems. Nothing was drawn.`);
  process.exit(1);
}

const missing = plans.filter(({ name }) => !existsSync(join(OUT, name)));
for (const { html, width, height, name } of missing) {
  const file = join(OUT, name);
  const webp = await render(html, {
    width: width * SCALE,
    height: height * SCALE,
    devicePixelRatio: SCALE,
    fonts,
    format: `webp`,
    lossless: true
  });
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, webp);
}
console.log(
  `Pictures: ${String(plans.length)} in the corpus, ${String(missing.length)} drawn, the rest already in dist/assets.`
);

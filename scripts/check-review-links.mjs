/* oxlint-disable no-await-in-loop -- one request at a time, a second apart, on purpose */
/**
 * Check every Tofugu review link in `grammar-points.yaml`.
 *
 * The build can only check that a link is shaped right. Whether the page exists, and has the section the link names, needs the network, so it is a separate task: run it after adding or changing a `tofugu` field. Each page is fetched once, a second apart, to be polite to Tofugu.
 *
 * Usage: `vp run exam:links`. Exits 1 if any link is broken.
 */
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { parse } from "yaml";
import { tofuguUrl } from "../src/handlers/exam/items.ts";

const points = parse(readFileSync(`data/jlpt/n5/grammar-points.yaml`, `utf8`));
const linked = points.filter((point) => typeof point.tofugu === `string`);
const pages = [...new Set(linked.map((point) => point.tofugu.split(`#`)[0]))];

const html = new Map();
for (const page of pages) {
  const response = await fetch(tofuguUrl(page));
  html.set(page, response.ok ? await response.text() : null);
  if (!response.ok) console.error(`${page}: HTTP ${String(response.status)}`);
  await sleep(1000);
}

const broken = linked.filter((point) => {
  const [page, section] = point.tofugu.split(`#`);
  const body = html.get(page);
  if (body === null) return true;
  if (typeof section === `string` && !body.includes(`id="${section}"`)) {
    console.error(`${point.id}: ${page} has no section #${section}`);
    return true;
  }
  return false;
});

console.log(
  `Checked ${String(linked.length)} links on ${String(pages.length)} pages: ${
    broken.length === 0 ? `all good` : `${String(broken.length)} broken`
  }.`
);
if (broken.length > 0) process.exit(1);

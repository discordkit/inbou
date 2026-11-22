import { readFileSync } from "node:fs";
import { measure } from "takumi-js";
import { describe, expect, it } from "vite-plus/test";
import { fontsFor, overflowOf } from "../../../../scripts/lib/pictures.mjs";
import corpus from "../corpus.json" with { type: "json" };
import type { InfoItem, Material } from "../items.js";
import { bare } from "../items.js";
import {
  MATERIAL_MAX_HEIGHT,
  materialHtml,
  materialWidth
} from "../material/index.js";

/**
 * The 問題6 pictures, laid out with the real fonts but never drawn.
 *
 * `measure()` lays a picture out as the draw would and returns where everything lands, so whether a picture fits is a test like any other, without writing a pixel. The draw script checks the same before it writes anything.
 */

const fonts = fontsFor(process.cwd());
const pages = (corpus.items as { type: string }[]).filter(
  (item): item is InfoItem => item.type === `info`
);

/** How tall a picture lays out, and any text past its right edge. */
const fit = async (
  material: Material
): Promise<{ height: number; over: string[] }> => {
  const width = materialWidth(material);
  const tree = await measure(materialHtml(material, bare), {
    width,
    height: MATERIAL_MAX_HEIGHT * 3,
    fonts
  });
  return { height: Math.ceil(tree.height), over: overflowOf(tree, width) };
};

describe(`the 問題6 pictures`, () => {
  it(`has pictures to check`, () => {
    // WHY: an empty list would pass the fit check below vacuously.
    expect(pages.length).toBeGreaterThan(0);
    // Read, so a stale import cannot hide a corpus with none.
    expect(readFileSync(`src/handlers/exam/corpus.json`, `utf8`)).toContain(
      `"type": "info"`
    );
  });

  it(`fits every shipped picture on its canvas`, async () => {
    // WHY: Discord shrinks a picture taller than a chat window until its text cannot be read, and text past the right edge is cut off. The eye only checks the pictures someone happened to open.
    const fits = await Promise.all(
      pages.map(async (page) => fit(page.material))
    );
    const misfits = pages.flatMap((page, index) => {
      const { height, over } = fits[index] ?? { height: 0, over: [] };
      return [
        ...(height > MATERIAL_MAX_HEIGHT
          ? [`${page.id}: ${String(height)} px tall`]
          : []),
        ...over.map((text) => `${page.id}: ${text}`)
      ];
    });
    expect(misfits).toEqual([]);
  }, 60_000);

  it(`catches text that cannot wrap and runs past the edge`, async () => {
    // WHY: Japanese wraps between any two characters, so it never overflows; a run with no break in it, such as a long number or a word in Latin letters, does. The fit check above can only fail if it sees one. Without this, a check that saw nothing would pass forever.
    const { over } = await fit({
      kind: `notice`,
      title: `おしらせ`,
      blocks: [{ text: [`0120`.repeat(40)] }]
    });
    expect(over.length).toBeGreaterThan(0);
  }, 30_000);
});

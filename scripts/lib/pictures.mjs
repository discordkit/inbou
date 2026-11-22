/**
 * What names a 問題6 picture, and the fonts it is drawn with.
 *
 * Shared by the corpus build, which records each picture's name in corpus.json, the draw, which writes the file under that name, and the corpus test, which checks the two agree. Plain JavaScript with no app imports, so all three can load it.
 *
 * **A picture is named by what it draws**: its template's HTML, its width, and the exact versions of the renderer and fonts. So its URL changes exactly when the picture would, and Discord, which caches a URL's picture for a long time, never shows an old one. The rendered bytes are not hashed, because the same picture drawn on Windows and on Linux CI may differ by a pixel, and the name must not.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** Where the hosted pictures live, under the assets Worker's root. */
export const PICTURE_DIR = `dokkai`;

/**
 * The faces the templates name, and the packages they come from.
 *
 * `weights` lists the files a static package ships; a variable package has one file for every weight.
 */
export const FONT_FAMILIES = [
  {
    pkg: `@fontsource-variable/noto-sans-jp`,
    name: `Noto Sans JP`,
    slug: `noto-sans-jp`
  },
  {
    pkg: `@fontsource-variable/noto-serif-jp`,
    name: `Noto Serif JP`,
    slug: `noto-serif-jp`
  },
  {
    pkg: `@fontsource/zen-maru-gothic`,
    name: `Zen Maru Gothic`,
    slug: `zen-maru-gothic`,
    weights: [500, 700, 900]
  },
  {
    pkg: `@fontsource/klee-one`,
    name: `Klee One`,
    slug: `klee-one`,
    weights: [400, 600]
  },
  {
    pkg: `@fontsource/dotgothic16`,
    name: `DotGothic16`,
    slug: `dotgothic16`,
    weights: [400]
  }
];

/**
 * The renderer's and fonts' versions, as package.json pins them.
 *
 * Read from the manifest rather than from node_modules, so the name depends on what the repository asks for, not on what one machine happens to have installed.
 */
export const versionsOf = (repo) => {
  const { devDependencies } = JSON.parse(
    readFileSync(join(repo, `package.json`), `utf8`)
  );
  return [`takumi-js`, ...FONT_FAMILIES.map(({ pkg }) => pkg)]
    .map((pkg) => `${pkg}@${devDependencies[pkg] ?? `missing`}`)
    .join(` `);
};

/** `dokkai/n5-d6-0001.3f9a1c2b7d4e.webp`: the item, then twelve hex digits of what it draws. */
export const pictureName = (id, html, width, versions) => {
  const hash = createHash(`sha256`)
    .update(JSON.stringify({ html, width, versions }))
    .digest(`hex`)
    .slice(0, 12);
  return `${PICTURE_DIR}/${id}.${hash}.webp`;
};

/** `U+3000-303F, U+FF00` as `[start, end]` pairs, which is what takumi takes. */
const toPairs = (css) =>
  css.split(`,`).map((part) => {
    const [from, to = from] = part.trim().replace(/^U\+/iu, ``).split(`-`);
    return [Number.parseInt(from, 16), Number.parseInt(to, 16)];
  });

/**
 * Every font file takumi may need, loaded only when a glyph in its range is drawn.
 *
 * fontsource splits each Japanese face into about a hundred subset files by Unicode range; takumi takes each as a separate face with its range, and reads a file only if the picture uses it.
 */
export const fontsFor = (repo) => {
  const require = createRequire(join(repo, `package.json`));
  return FONT_FAMILIES.flatMap(({ pkg, name, slug, weights }) => {
    const dir = dirname(require.resolve(`${pkg}/package.json`));
    const ranges = JSON.parse(readFileSync(join(dir, `unicode.json`), `utf8`));
    return Object.entries(ranges).flatMap(([key, css]) => {
      const part = key.replace(/^\[(\d+)\]$/u, `$1`);
      return (weights ?? [null]).flatMap((weight) => {
        const file = join(
          dir,
          `files`,
          `${slug}-${part}-${weight ?? `wght`}-normal.woff2`
        );
        if (!existsSync(file)) return [];
        return [
          {
            name,
            ...(weight === null ? {} : { weight }),
            unicodeRange: toPairs(css),
            data: () => readFile(file)
          }
        ];
      });
    });
  });
};

/**
 * Text that runs past the canvas's right edge, by the measured layout.
 *
 * Japanese wraps between any two characters, so it always fits. A run with no break in it, such as a long number, a phone number or a word in Latin letters, does not wrap, and runs past the edge, where it is cut off. Measured, because the eye only checks the pictures someone happened to open.
 */
export const overflowOf = (tree, width, slack = 1) => {
  const over = [];
  const walk = (node) => {
    const left = node.transform[4];
    for (const run of node.runs) {
      const right = left + run.x + run.width;
      if (right > width + slack) {
        over.push(`"${run.text}" ends at ${right.toFixed(1)} px`);
      }
    }
    for (const child of node.children) {
      walk(child);
    }
  };
  walk(tree);
  return over;
};

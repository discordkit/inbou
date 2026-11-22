import type { Tone } from "../items.js";

/**
 * The pieces every 問題6 template is built from.
 *
 * takumi lays out HTML with flexbox, so every box here is `display:flex`. It draws borders, shadows, gradients, rotation, outlined text and SVG images; it has no vertical writing.
 */

/** Markup as the picture prints it: `bare` from items.ts, passed in so the ruby rule stays in one place. */
export type Show = (markup: string) => string;

/** The faces a real document might use. The draw script loads each by these names. */
export const FONTS = {
  /** Most print: signs, apps, receipts. */
  sans: `'Noto Sans JP'`,
  /** Mincho, for formal notices from a school or a building. */
  serif: `'Noto Serif JP'`,
  /** Rounded, for flyers, posters and anything meant to look friendly. */
  round: `'Zen Maru Gothic'`,
  /** A pen hand, for handwritten signs, forms and boards. */
  hand: `'Klee One'`,
  /** Dot-matrix, for a station's departure board. */
  dot: `'DotGothic16'`
} as const;

/** Each tone as a strong ink and a pale fill. */
export const TONES: Record<Tone, { ink: string; pale: string }> = {
  red: { ink: `#d63a3a`, pale: `#fde3e1` },
  orange: { ink: `#e2702a`, pale: `#feead9` },
  yellow: { ink: `#d9a400`, pale: `#fff4c7` },
  green: { ink: `#2a9354`, pale: `#dcf2e4` },
  blue: { ink: `#2b74cf`, pale: `#dde9fb` },
  navy: { ink: `#24396b`, pale: `#e1e6f2` },
  purple: { ink: `#7a4cc2`, pale: `#ece3f8` },
  pink: { ink: `#d94f86`, pale: `#fce1ec` },
  brown: { ink: `#8a5a2b`, pale: `#f3e6d6` },
  gray: { ink: `#5f6670`, pale: `#eceef1` }
};

export const esc = (text: string): string =>
  text.replace(/&/gu, `&amp;`).replace(/</gu, `&lt;`).replace(/>/gu, `&gt;`);

/** A flex box: a row unless the style says otherwise. */
export const box = (style: string, ...children: string[]): string =>
  `<div style="display:flex;${style}">${children.join(``)}</div>`;

/** A flex column. */
export const col = (style: string, ...children: string[]): string =>
  box(`flex-direction:column;${style}`, ...children);

/** A short piece of text that never wraps. Takes text already shown. */
export const label = (text: string, style = ``): string =>
  box(style, esc(text));

/**
 * Text that wraps only between phrases.
 *
 * The paper spaces N5 text into phrases, and a break inside one splits a word. Each phrase is a box that never breaks, and the line wraps between boxes. Takes text already shown.
 */
export const words = (text: string, size: number, style = ``): string =>
  box(
    `flex-wrap:wrap;column-gap:${String(Math.round(size * 0.3))}px;font-size:${String(size)}px;line-height:${String(Math.round(size * 1.45))}px;${style}`,
    ...text
      .split(/\s+/u)
      .filter((phrase) => phrase !== ``)
      .map((phrase) => box(``, esc(phrase)))
  );

/** An SVG drawn as an image. */
export const svg = (
  body: string,
  width: number,
  height: number,
  viewBox = `0 0 ${String(width)} ${String(height)}`
): string =>
  `<img src="data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="${viewBox}">${body}</svg>`
  )}" width="${String(width)}" height="${String(height)}" />`;

/** An icon drawn on a 40-unit square, at any size. */
const icon =
  (body: string): ((size: number) => string) =>
  (size: number): string =>
    svg(body, size, size, `0 0 40 40`);

/** Small pictures a sign carries, drawn rather than written, so they hold no text to read. */
export const ICONS = {
  clinic: icon(
    `<rect width="40" height="40" rx="8" fill="#ffffff"/><rect x="15" y="6" width="10" height="28" fill="#2a9354"/><rect x="6" y="15" width="28" height="10" fill="#2a9354"/>`
  ),
  pool: icon(
    `<rect width="40" height="40" rx="8" fill="#ffffff"/><circle cx="26" cy="11" r="4" fill="#2b74cf"/><path d="M8 22 l10 -6 l6 6" stroke="#2b74cf" stroke-width="3" fill="none"/><path d="M4 28 q4 -4 8 0 t8 0 t8 0 t8 0" stroke="#2b74cf" stroke-width="3" fill="none"/><path d="M4 34 q4 -4 8 0 t8 0 t8 0 t8 0" stroke="#2b74cf" stroke-width="3" fill="none"/>`
  ),
  book: icon(
    `<rect width="40" height="40" rx="8" fill="#ffffff"/><path d="M6 10 q7 -3 14 2 v20 q-7 -5 -14 -2 z" fill="#8a5a2b"/><path d="M34 10 q-7 -3 -14 2 v20 q7 -5 14 -2 z" fill="#b07a45"/>`
  ),
  school: icon(
    `<rect width="40" height="40" rx="8" fill="#ffffff"/><path d="M6 18 L20 8 L34 18 Z" fill="#d63a3a"/><rect x="9" y="18" width="22" height="16" fill="#e2702a"/><rect x="17" y="24" width="6" height="10" fill="#ffffff"/><circle cx="20" cy="14" r="2.5" fill="#ffffff"/>`
  ),
  bus: icon(
    `<rect x="7" y="4" width="26" height="28" rx="5" fill="#ffffff"/><rect x="10" y="8" width="20" height="11" rx="2" fill="#24396b"/><circle cx="13" cy="25" r="2.5" fill="#24396b"/><circle cx="27" cy="25" r="2.5" fill="#24396b"/><rect x="10" y="32" width="5" height="4" fill="#ffffff"/><rect x="25" y="32" width="5" height="4" fill="#ffffff"/>`
  ),
  train: icon(
    `<rect x="8" y="4" width="24" height="26" rx="7" fill="#ffffff"/><rect x="11" y="9" width="18" height="9" rx="2" fill="#2a9354"/><circle cx="14" cy="24" r="2.2" fill="#2a9354"/><circle cx="26" cy="24" r="2.2" fill="#2a9354"/><path d="M12 30 L8 37 M28 30 L32 37" stroke="#ffffff" stroke-width="3"/>`
  ),
  tick: (size: number, color: string) =>
    icon(
      `<path d="M6 21 L16 31 L34 9" stroke="${color}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
    )(size)
} as const;

/** A tone that stays the same for the same text, so a subject keeps its colour across a timetable. */
export const toneOf = (text: string): Tone => {
  const order: readonly Tone[] = [
    `blue`,
    `orange`,
    `green`,
    `pink`,
    `purple`,
    `yellow`,
    `red`,
    `brown`
  ];
  let hash = 0;
  for (const char of text)
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return order[hash % order.length] ?? `blue`;
};

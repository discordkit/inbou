import type { Block, Sheet } from "../items.js";
import {
  FONTS,
  ICONS,
  TONES,
  box,
  col,
  esc,
  label,
  toneOf,
  words,
  type Show
} from "./kit.js";

/**
 * Paper, signs and boards. Each kind is a skin over the same blocks: the data says what the sheet holds, the kind says what it looks like.
 */

export const SHEET_WIDTH = 600;

interface Theme {
  font: string;
  size: number;
  ink: string;
  rule: string;
  headFill: string;
  headInk: string;
  accent: string;
  /** Width inside the sheet's padding, for boxes that sit two to a row. */
  inner: number;
  /** Shade the first column like the head: a timetable's days, a schedule's names. */
  sideHead?: boolean;
  /** Colour each cell by its text, so a subject keeps its colour. */
  cellTone?: boolean;
  /** Pinned notes on a board lean a little. */
  tilt?: boolean;
  panelFills?: readonly string[];
}

const textBlock = (lines: readonly string[], show: Show, t: Theme): string =>
  col(
    `gap:4px;color:${t.ink}`,
    ...lines.map((line) => words(show(line), t.size))
  );

const tableBlock = (
  head: readonly string[],
  rows: ReadonlyArray<readonly string[]>,
  show: Show,
  t: Theme
): string => {
  // Every column is the same width. A month calendar has seven, and 「13▲」 only fits in one with less padding.
  const padding = head.length >= 6 ? 4 : 10;
  const cell = (cell: string, heading: boolean, first: boolean): string => {
    const shown = show(cell);
    const fill =
      heading || (first && t.sideHead === true)
        ? `background:${t.headFill};color:${t.headInk};font-weight:700;`
        : t.cellTone === true && shown !== `` && !first
          ? `background:${TONES[toneOf(shown)].pale};`
          : ``;
    return box(
      `flex:1;justify-content:center;align-items:center;padding:6px ${String(padding)}px;border:1px solid ${t.rule};${fill}`,
      words(shown, t.size, `justify-content:center`)
    );
  };
  return col(
    `color:${t.ink}`,
    box(``, ...head.map((text) => cell(text, true, false))),
    ...rows.map((row) =>
      box(``, ...row.map((text, index) => cell(text, false, index === 0)))
    )
  );
};

const listsBlock = (
  lists: ReadonlyArray<{
    head: string;
    rows: ReadonlyArray<readonly [string, string]>;
  }>,
  show: Show,
  t: Theme
): string =>
  box(
    `gap:32px;color:${t.ink}`,
    ...lists.map((list) =>
      col(
        `flex:1`,
        label(
          show(list.head),
          `font-size:${String(t.size + 2)}px;line-height:${String(t.size + 14)}px;font-weight:700;padding-bottom:4px;border-bottom:3px solid ${t.accent};margin-bottom:4px`
        ),
        ...list.rows.map(([name, value]) =>
          box(
            `justify-content:space-between;font-size:${String(t.size + 2)}px;line-height:${String(t.size + 20)}px;border-bottom:1px solid ${t.rule}`,
            label(show(name)),
            label(show(value))
          )
        )
      )
    )
  );

const panelsBlock = (
  panels: ReadonlyArray<{ head: string; lines: readonly string[] }>,
  show: Show,
  t: Theme
): string => {
  const gap = 14;
  const width = Math.floor((t.inner - gap) / 2);
  return box(
    `flex-wrap:wrap;gap:${String(gap)}px`,
    ...panels.map((panel, index) => {
      const fill = t.panelFills?.[index % t.panelFills.length] ?? `#ffffff`;
      const lean =
        t.tilt === true
          ? `transform:rotate(${index % 2 === 0 ? `-1.5` : `1.2`}deg);`
          : ``;
      return col(
        `width:${String(width)}px;background:${fill};border:2px solid ${t.accent};border-radius:8px;${lean}${t.tilt === true ? `box-shadow:2px 3px 5px rgba(0,0,0,0.35);` : ``}`,
        t.tilt === true
          ? box(
              `justify-content:center;padding-top:6px`,
              box(
                `width:16px;height:16px;border-radius:50%;background:#d63a3a;box-shadow:1px 2px 2px rgba(0,0,0,0.4)`
              )
            )
          : ``,
        label(
          show(panel.head),
          `background:${t.accent};color:#ffffff;font-size:${String(t.size)}px;line-height:${String(t.size + 12)}px;font-weight:700;padding:2px 12px;${t.tilt === true ? `margin:4px 8px 0;border-radius:4px;` : ``}`
        ),
        col(
          `padding:6px 12px 10px;color:${t.ink}`,
          ...panel.lines.map((line) => words(show(line), t.size))
        )
      );
    })
  );
};

const blocksOf = (blocks: readonly Block[], show: Show, t: Theme): string[] =>
  blocks.map((block) =>
    `text` in block
      ? textBlock(block.text, show, t)
      : `table` in block
        ? tableBlock(block.table.head, block.table.rows, show, t)
        : `lists` in block
          ? listsBlock(block.lists, show, t)
          : panelsBlock(block.panels, show, t)
  );

const lineList = (
  lines: readonly string[] | undefined,
  show: Show,
  size: number,
  style: string
): string =>
  lines === undefined
    ? ``
    : col(style, ...lines.map((line) => words(show(line), size)));

/** A printed notice from a school or a building: Mincho on white paper, 記 and 以上, the sender on the right. */
const notice = (sheet: Sheet, show: Show): string => {
  const t: Theme = {
    font: FONTS.serif,
    size: 23,
    ink: `#1b1b1b`,
    rule: `#555555`,
    headFill: `#f1f1f1`,
    headInk: `#1b1b1b`,
    accent: `#1b1b1b`,
    inner: SHEET_WIDTH - 36 - 64
  };
  return col(
    `width:${String(SHEET_WIDTH)}px;background:#ddd9d0;padding:18px;font-family:${t.font}`,
    col(
      `background:#ffffff;padding:24px 32px 28px;gap:14px;box-shadow:0 3px 8px rgba(0,0,0,0.25)`,
      lineList(sheet.head, show, 20, `align-items:flex-end;color:${t.ink}`),
      box(
        `justify-content:center;padding:4px 0 6px`,
        words(
          show(sheet.title),
          30,
          `font-weight:700;color:${t.ink};justify-content:center;letter-spacing:2px`
        )
      ),
      ...blocksOf(sheet.blocks, show, t),
      lineList(sheet.foot, show, 20, `align-items:flex-end;color:${t.ink}`)
    )
  );
};

/** A handwritten sign taped to a shop's glass door. */
const sign = (sheet: Sheet, show: Show): string => {
  const marker = TONES[sheet.tone ?? `red`].ink;
  const t: Theme = {
    font: FONTS.hand,
    size: 27,
    ink: `#1f2a5a`,
    rule: `#1f2a5a`,
    headFill: `#fffdf4`,
    headInk: `#1f2a5a`,
    accent: marker,
    inner: SHEET_WIDTH - 52 - 64
  };
  const tape = (side: string): string =>
    box(
      `position:absolute;top:-10px;${side}:18px;width:90px;height:26px;background:rgba(236,226,190,0.85);transform:rotate(${side === `left` ? `-8` : `7`}deg)`
    );
  return col(
    `width:${String(SHEET_WIDTH)}px;background-image:linear-gradient(135deg,#71818a,#4a5960);padding:30px 26px;font-family:${t.font}`,
    col(
      `position:relative;background:#fffdf4;padding:30px 32px 26px;gap:12px;transform:rotate(-1deg);box-shadow:2px 4px 8px rgba(0,0,0,0.4)`,
      tape(`left`),
      tape(`right`),
      lineList(sheet.head, show, 22, `color:${t.ink}`),
      box(
        `justify-content:center`,
        words(
          show(sheet.title),
          40,
          `font-weight:600;color:${marker};justify-content:center`
        )
      ),
      ...blocksOf(sheet.blocks, show, t),
      lineList(sheet.foot, show, 24, `align-items:flex-end;color:${t.ink}`)
    )
  );
};

/** A facility's signboard: a coloured band with its symbol, then the details on white. */
const signboard = (sheet: Sheet, show: Show): string => {
  const tone = TONES[sheet.tone ?? `green`];
  const t: Theme = {
    font: FONTS.sans,
    size: 25,
    ink: `#1f2328`,
    rule: `#c4cad2`,
    headFill: tone.pale,
    headInk: tone.ink,
    accent: tone.ink,
    inner: SHEET_WIDTH - 32 - 48
  };
  return col(
    `width:${String(SHEET_WIDTH)}px;background:#d5d9de;padding:16px;font-family:${t.font}`,
    col(
      `background:#ffffff;border-radius:14px;box-shadow:0 3px 8px rgba(0,0,0,0.3);border:3px solid ${tone.ink}`,
      box(
        `background:${tone.ink};color:#ffffff;padding:12px 22px;gap:14px;align-items:center;border-radius:10px 10px 0 0`,
        sheet.icon === undefined ? `` : ICONS[sheet.icon](46),
        words(
          show(sheet.title),
          34,
          `font-family:${FONTS.round};font-weight:700`
        )
      ),
      lineList(
        sheet.head,
        show,
        23,
        `background:${tone.pale};color:${tone.ink};padding:6px 22px;font-weight:700`
      ),
      col(
        `padding:16px 22px 18px;gap:12px`,
        ...blocksOf(sheet.blocks, show, t)
      ),
      lineList(
        sheet.foot,
        show,
        22,
        `background:${tone.pale};color:${t.ink};padding:8px 22px;border-radius:0 0 10px 10px`
      )
    )
  );
};

/** An event poster: a strong colour, a big rounded title, the details on a white card. */
const poster = (sheet: Sheet, show: Show): string => {
  const tone = TONES[sheet.tone ?? `orange`];
  const t: Theme = {
    font: FONTS.round,
    size: 23,
    ink: `#2a2a2a`,
    rule: `#e3d6c8`,
    headFill: tone.pale,
    headInk: tone.ink,
    accent: tone.ink,
    inner: SHEET_WIDTH - 48 - 36
  };
  const dot = (style: string): string =>
    box(`position:absolute;border-radius:50%;${style}`);
  return col(
    `position:relative;width:${String(SHEET_WIDTH)}px;background:${tone.ink};padding:24px;gap:14px;font-family:${t.font};overflow:hidden`,
    dot(
      `width:180px;height:180px;top:-60px;right:-50px;background:rgba(255,255,255,0.18)`
    ),
    dot(
      `width:110px;height:110px;bottom:-30px;left:-30px;background:rgba(255,255,255,0.15)`
    ),
    dot(`width:26px;height:26px;top:40px;left:30px;background:#fff4c7`),
    lineList(
      sheet.head,
      show,
      24,
      `align-items:center;color:#ffffff;font-weight:700`
    ),
    box(
      `justify-content:center`,
      words(
        show(sheet.title),
        44,
        `color:#ffffff;font-weight:900;justify-content:center;-webkit-text-stroke:1px rgba(0,0,0,0.15);text-shadow:3px 3px 0 rgba(0,0,0,0.22)`
      )
    ),
    col(
      `background:#ffffff;border-radius:18px;padding:18px;gap:12px`,
      ...blocksOf(sheet.blocks, show, t)
    ),
    lineList(
      sheet.foot,
      show,
      22,
      `align-items:center;color:#ffffff;font-weight:700`
    )
  );
};

/** A cork board in a wooden frame, with notices pinned to it. */
const board = (sheet: Sheet, show: Show): string => {
  const t: Theme = {
    font: FONTS.round,
    size: 24,
    ink: `#2a2a2a`,
    rule: `#b9a48a`,
    headFill: `#fff8e1`,
    headInk: `#2a2a2a`,
    accent: `#5a4632`,
    inner: SHEET_WIDTH - 28 - 44,
    tilt: true,
    panelFills: [`#fff7c2`, `#ffe1ea`, `#dff0ff`, `#e3f6dc`]
  };
  return col(
    `width:${String(SHEET_WIDTH)}px;background:#7a5230;padding:14px;font-family:${t.font}`,
    col(
      `background:#c99c6c;padding:20px 22px 26px;gap:18px;box-shadow:inset 0 0 12px rgba(0,0,0,0.35)`,
      box(
        `justify-content:center`,
        box(
          `background:#ffffff;padding:6px 24px;transform:rotate(-1deg);box-shadow:2px 3px 4px rgba(0,0,0,0.35)`,
          words(show(sheet.title), 30, `font-weight:700;color:#2a2a2a`)
        )
      ),
      lineList(sheet.head, show, 22, `align-items:center;color:#3b2a1a`),
      ...blocksOf(sheet.blocks, show, t),
      lineList(sheet.foot, show, 21, `align-items:flex-end;color:#3b2a1a`)
    )
  );
};

/** A café's chalkboard menu in a wooden frame. */
const chalkboard = (sheet: Sheet, show: Show): string => {
  const t: Theme = {
    font: FONTS.hand,
    size: 26,
    ink: `#f4f1e6`,
    rule: `rgba(244,241,230,0.45)`,
    headFill: `rgba(255,255,255,0.08)`,
    headInk: `#f6dd6b`,
    accent: `#f4a3b5`,
    inner: SHEET_WIDTH - 28 - 52
  };
  return col(
    `width:${String(SHEET_WIDTH)}px;background:#6b4a2b;padding:14px;font-family:${t.font}`,
    col(
      `background-image:linear-gradient(160deg,#2f5446,#213d33);padding:22px 26px 26px;gap:16px`,
      lineList(sheet.head, show, 22, `align-items:center;color:#9fd3f0`),
      box(
        `justify-content:center`,
        words(
          show(sheet.title),
          40,
          `color:#f6dd6b;font-weight:600;justify-content:center`
        )
      ),
      ...blocksOf(sheet.blocks, show, t),
      lineList(sheet.foot, show, 22, `color:#9fd3f0`)
    )
  );
};

/** A supermarket flyer: yellow paper, a red banner, big red prices. */
const flyer = (sheet: Sheet, show: Show): string => {
  const red = `#e0262f`;
  const t: Theme = {
    font: FONTS.round,
    size: 25,
    ink: `#1a1a1a`,
    rule: `#f0b8b8`,
    headFill: red,
    headInk: `#ffffff`,
    accent: red,
    inner: SHEET_WIDTH - 36
  };
  const lists = (block: Block): string =>
    `lists` in block
      ? box(
          `gap:14px`,
          ...block.lists.map((list) =>
            col(
              `flex:1;background:#ffffff;border:3px solid ${red};border-radius:12px;padding:0 0 8px`,
              box(
                `justify-content:center;background:${red};color:#ffffff;font-size:28px;line-height:42px;font-weight:900;border-radius:8px 8px 0 0`,
                esc(show(list.head))
              ),
              ...list.rows.map(([name, value]) =>
                box(
                  `justify-content:space-between;align-items:center;padding:2px 12px;border-bottom:1px dashed ${t.rule}`,
                  label(
                    show(name),
                    `font-size:23px;font-weight:700;color:#1a1a1a`
                  ),
                  label(
                    show(value),
                    `font-size:32px;font-weight:900;color:${red};-webkit-text-stroke:1px #ffffff`
                  )
                )
              )
            )
          )
        )
      : blocksOf([block], show, t).join(``);
  return col(
    `width:${String(SHEET_WIDTH)}px;background:#ffe33d;font-family:${t.font}`,
    col(
      `background:${red};padding:14px 18px;align-items:center;gap:4px`,
      lineList(
        sheet.head,
        show,
        22,
        `align-items:center;color:#ffe33d;font-weight:700`
      ),
      words(
        show(sheet.title),
        42,
        `color:#ffffff;font-weight:900;justify-content:center;text-shadow:3px 3px 0 #9a1218`
      )
    ),
    col(
      `padding:16px 18px 18px;gap:14px`,
      ...sheet.blocks.map((block) =>
        `text` in block
          ? col(
              `border:3px dashed ${red};border-radius:10px;padding:8px 12px;background:#fff8c9`,
              textBlock(block.text, show, { ...t, size: 23 })
            )
          : lists(block)
      ),
      lineList(
        sheet.foot,
        show,
        21,
        `align-items:center;color:#1a1a1a;font-weight:700`
      )
    )
  );
};

/** A whiteboard in an office or a shared kitchen, written in marker. */
const whiteboard = (sheet: Sheet, show: Show): string => {
  const t: Theme = {
    font: FONTS.hand,
    size: 25,
    ink: `#1d1d1d`,
    rule: `#8a9099`,
    headFill: `#ffffff`,
    headInk: `#1f5fbf`,
    accent: `#1f5fbf`,
    inner: SHEET_WIDTH - 24 - 44,
    sideHead: true
  };
  return col(
    `width:${String(SHEET_WIDTH)}px;background-image:linear-gradient(180deg,#c9ced4,#a9afb6);padding:12px;font-family:${t.font}`,
    col(
      `background:#fbfcfd;padding:18px 22px 20px;gap:12px`,
      box(
        `border-bottom:3px solid #d63a3a;padding-bottom:2px`,
        words(show(sheet.title), 34, `font-weight:600;color:#1d1d1d`)
      ),
      lineList(sheet.head, show, 22, `color:#d63a3a`),
      ...blocksOf(sheet.blocks, show, t),
      lineList(sheet.foot, show, 22, `color:#d63a3a`)
    ),
    box(
      `height:16px;margin-top:4px;background:#9aa0a7;gap:16px;padding:3px 40px`,
      box(`width:56px;height:10px;background:#1d1d1d;border-radius:3px`),
      box(`width:56px;height:10px;background:#d63a3a;border-radius:3px`),
      box(`width:56px;height:10px;background:#1f5fbf;border-radius:3px`)
    )
  );
};

/** A department store's floor directory: a dark panel, each floor on a coloured number. */
const directory = (sheet: Sheet, show: Show): string => {
  const floorTones = [
    `red`,
    `orange`,
    `green`,
    `blue`,
    `purple`,
    `pink`,
    `brown`
  ] as const;
  const t: Theme = {
    font: FONTS.sans,
    size: 24,
    ink: `#f2f4f8`,
    rule: `#3a4458`,
    headFill: `#2a3346`,
    headInk: `#ffffff`,
    accent: `#f2b134`,
    inner: SHEET_WIDTH - 40
  };
  const floors = (block: Block): string =>
    `lists` in block
      ? col(
          `gap:0`,
          ...block.lists.flatMap((list) => [
            label(
              show(list.head),
              `color:#f2b134;font-size:22px;letter-spacing:2px;padding-bottom:6px`
            ),
            ...list.rows.map(([floor, what], index) =>
              box(
                `align-items:center;gap:16px;padding:7px 0;border-top:1px solid ${t.rule}`,
                box(
                  `min-width:130px;justify-content:center;background:${TONES[floorTones[index % floorTones.length] ?? `red`].ink};color:#ffffff;font-size:24px;font-weight:700;border-radius:6px;padding:2px 10px`,
                  esc(show(floor))
                ),
                words(show(what), 25, `color:#f2f4f8`)
              )
            )
          ])
        )
      : blocksOf([block], show, t).join(``);
  return col(
    `width:${String(SHEET_WIDTH)}px;background:#1d2433;padding:20px;gap:14px;font-family:${t.font}`,
    box(
      `justify-content:center;border-bottom:3px solid #f2b134;padding-bottom:8px`,
      words(
        show(sheet.title),
        32,
        `color:#ffffff;font-weight:700;font-family:${FONTS.round}`
      )
    ),
    lineList(sheet.head, show, 21, `color:#c9d1e0`),
    ...sheet.blocks.map(floors),
    lineList(sheet.foot, show, 21, `color:#c9d1e0`)
  );
};

/** A school timetable on a classroom wall: each subject in its own colour. */
const timetable = (sheet: Sheet, show: Show): string => {
  const t: Theme = {
    font: FONTS.round,
    size: 25,
    ink: `#2a2a2a`,
    rule: `#c9b99a`,
    headFill: `#2f4b6e`,
    headInk: `#ffffff`,
    accent: `#2f4b6e`,
    inner: SHEET_WIDTH - 40,
    sideHead: true,
    cellTone: true
  };
  return col(
    `width:${String(SHEET_WIDTH)}px;background:#fdfaf1;padding:20px;gap:14px;font-family:${t.font}`,
    box(
      `justify-content:center;align-items:center;gap:12px`,
      sheet.icon === undefined ? `` : ICONS[sheet.icon](42),
      words(show(sheet.title), 32, `font-weight:700;color:#2f4b6e`)
    ),
    lineList(sheet.head, show, 22, `align-items:center;color:#5a4a2a`),
    ...blocksOf(sheet.blocks, show, t),
    lineList(sheet.foot, show, 22, `color:#5a4a2a`)
  );
};

export const sheetHtml = (sheet: Sheet, show: Show): string => {
  switch (sheet.kind) {
    case `notice`:
      return notice(sheet, show);
    case `sign`:
      return sign(sheet, show);
    case `signboard`:
      return signboard(sheet, show);
    case `poster`:
      return poster(sheet, show);
    case `board`:
      return board(sheet, show);
    case `chalkboard`:
      return chalkboard(sheet, show);
    case `flyer`:
      return flyer(sheet, show);
    case `whiteboard`:
      return whiteboard(sheet, show);
    case `directory`:
      return directory(sheet, show);
    case `timetable`:
      return timetable(sheet, show);
  }
};

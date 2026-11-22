import { ARROWS, type Material, type Tone } from "../items.js";
import {
  FONTS,
  ICONS,
  TONES,
  box,
  col,
  esc,
  label,
  words,
  type Show
} from "./kit.js";

/** Getting about: the papers and screens of buses and trains. */

type Of<K extends Material[`kind`]> = Extract<Material, { kind: K }>;

/** A bus stop's or a platform's timetable: a row for each hour, its minutes beside it. Weekday, Saturday and holiday columns are told apart by colour, as on the real thing. */
export const stopTimetable = (m: Of<`stop-timetable`>, show: Show): string => {
  const main = m.mode === `bus` ? `#24396b` : `#2a9354`;
  const columnInks = [`#2b2b2b`, `#2b74cf`, `#d63a3a`];
  const hourWidth = 64;
  return col(
    `width:560px;background:#e4e7eb;padding:14px;font-family:${FONTS.sans}`,
    col(
      `background:#ffffff;border:3px solid ${main};border-radius:6px`,
      box(
        `background:${main};padding:10px 16px;gap:14px;align-items:center`,
        ICONS[m.mode](46),
        col(
          `gap:4px`,
          words(show(m.stop), 30, `color:#ffffff;font-weight:700`),
          box(
            ``,
            label(
              show(m.bound),
              `background:#ffffff;color:${main};font-size:21px;font-weight:700;padding:0 12px;border-radius:14px`
            )
          )
        )
      ),
      box(
        `border-bottom:2px solid ${main}`,
        box(`width:${String(hourWidth)}px;background:#f1f3f5`),
        ...m.columns.map((column, index) =>
          box(
            `flex:1;justify-content:center;padding:4px 0;font-size:22px;font-weight:700;color:#ffffff;background:${columnInks[index] ?? `#2b2b2b`};border-left:1px solid #ffffff`,
            esc(show(column))
          )
        )
      ),
      ...m.rows.map((row) =>
        box(
          `border-bottom:1px solid #d5d9de`,
          box(
            `width:${String(hourWidth)}px;justify-content:center;align-items:center;background:#f1f3f5;font-size:26px;font-weight:700;color:${main}`,
            String(row.hour)
          ),
          ...m.columns.map((_, index) =>
            box(
              `flex:1;flex-wrap:wrap;column-gap:14px;padding:6px 12px;border-left:1px solid #d5d9de;font-size:25px;line-height:34px;color:${columnInks[index] ?? `#2b2b2b`}`,
              ...(row.minutes[index] ?? []).map((minute) => {
                // A mark after the minute, such as ●, prints small beside it, as on a real timetable.
                const [, digits = ``, mark = ``] =
                  /^(\d*)(.*)$/u.exec(show(minute)) ?? [];
                return box(
                  `align-items:center`,
                  esc(digits),
                  mark === ``
                    ? ``
                    : box(`font-size:14px;margin-left:1px`, esc(mark))
                );
              })
            )
          )
        )
      ),
      m.notes === undefined
        ? ``
        : col(
            `padding:8px 14px 10px;gap:2px`,
            ...m.notes.map((note) => words(show(note), 20, `color:#3a3f45`))
          )
    )
  );
};

/** LED colours for the kinds of train on a departure board. */
const LED: Partial<Record<Tone, string>> = {
  green: `#4be16b`,
  orange: `#ffa12b`,
  red: `#ff5a4a`,
  yellow: `#ffe24a`,
  blue: `#5aa8ff`
};

/** The departure board over a platform: dot-matrix letters on black. */
export const departureBoard = (
  m: Of<`departure-board`>,
  show: Show
): string => {
  const widths = [130, 110, 0, 96];
  const cell = (text: string, index: number, style: string): string =>
    box(
      `${index === 2 ? `flex:1;` : `width:${String(widths[index] ?? 100)}px;`}${index === 3 ? `justify-content:center;` : ``}${style}`,
      esc(text)
    );
  return col(
    `width:640px;background:#3b3d40;padding:14px;font-family:${FONTS.dot}`,
    col(
      `background:#0a0a0a;border:4px solid #55585c;padding:10px 16px 12px;gap:6px`,
      box(
        `border-bottom:1px solid #333;padding-bottom:4px`,
        ...m.head.map((text, index) =>
          cell(show(text), index, `font-size:18px;color:#c8c8c8`)
        )
      ),
      ...m.rows.map((row) =>
        box(
          `align-items:center;padding:4px 0`,
          cell(
            show(row.type),
            0,
            `font-size:30px;color:${LED[row.tone] ?? `#ffa12b`}`
          ),
          cell(show(row.time), 1, `font-size:30px;color:#ffb02e`),
          cell(show(row.dest), 2, `font-size:30px;color:#ffb02e`),
          cell(show(row.track), 3, `font-size:30px;color:#f2f2f2`)
        )
      ),
      m.note === undefined
        ? ``
        : box(
            `border-top:1px solid #333;padding-top:6px`,
            words(show(m.note), 22, `color:#4be16b`)
          )
    )
  );
};

/** A route-search app's results on a phone. */
export const routeSearch = (m: Of<`route-search`>, show: Show): string => {
  const app = `#2b74cf`;
  const tagTones = [`#d63a3a`, `#2a9354`, `#2b74cf`, `#e2702a`];
  return col(
    `width:420px;background:#121212;padding:10px;border-radius:36px;font-family:${FONTS.sans}`,
    col(
      `background:#f0f2f5;border-radius:28px;overflow:hidden`,
      box(
        `justify-content:center;padding:8px 0 4px;background:${app}`,
        box(`width:90px;height:18px;background:#121212;border-radius:10px`)
      ),
      col(
        `background:${app};padding:8px 18px 14px;gap:4px`,
        box(
          `align-items:center;gap:10px;color:#ffffff`,
          words(show(m.from), 24, `font-weight:700`),
          box(`font-size:24px`, `→`),
          words(show(m.to), 24, `font-weight:700`)
        ),
        words(show(m.when), 18, `color:#dbe8fb`)
      ),
      col(
        `padding:10px;gap:10px`,
        ...m.routes.map((route) =>
          col(
            `background:#ffffff;border-radius:12px;padding:10px 14px;gap:6px;box-shadow:0 1px 3px rgba(0,0,0,0.15)`,
            box(
              `align-items:center;gap:10px`,
              label(
                show(route.label),
                `font-size:24px;color:${app};font-weight:700`
              ),
              box(
                `align-items:center;gap:8px;font-size:27px;font-weight:700;color:#1f2328`,
                esc(show(route.depart)),
                box(`font-size:20px;color:#8a929b`, `→`),
                esc(show(route.arrive))
              ),
              box(
                `gap:4px;margin-left:auto`,
                ...(route.tags ?? []).map((tag, index) =>
                  box(
                    `width:30px;height:30px;justify-content:center;align-items:center;border-radius:6px;background:${tagTones[index % tagTones.length] ?? app};color:#ffffff;font-size:18px;font-weight:700`,
                    esc(show(tag))
                  )
                )
              )
            ),
            box(
              `gap:14px;font-size:19px;color:#4a525b`,
              label(show(route.time), `font-weight:700;color:#1f2328`),
              label(show(route.fare)),
              label(show(route.transfers))
            ),
            box(
              `flex-wrap:wrap;align-items:center;gap:6px`,
              ...route.legs.flatMap((leg, index) => [
                index === 0 ? `` : box(`font-size:16px;color:#8a929b`, `→`),
                box(
                  `border-left:5px solid ${tagTones[(index + 1) % tagTones.length] ?? app};background:#f1f3f6;padding:1px 8px;font-size:18px;color:#1f2328`,
                  esc(show(leg))
                )
              ])
            )
          )
        )
      )
    )
  );
};

/** The fare chart over a station's ticket machines: a line of stations, each with its fare, and the one you are at in red. */
export const fareChart = (m: Of<`fare-chart`>, show: Show): string => {
  const line = `#2a9354`;
  const perRow = 5;
  const rows: Array<typeof m.stations> = [];
  for (let start = 0; start < m.stations.length; start += perRow) {
    rows.push(m.stations.slice(start, start + perRow));
  }
  const station = (s: (typeof m.stations)[number]): string =>
    col(
      `width:${String(Math.floor(600 / perRow))}px;align-items:center;gap:6px`,
      // Two lines' room for every name, filled from the bottom, so a long name never pushes its dot off the line.
      col(
        `height:56px;justify-content:flex-end`,
        words(
          show(s.name),
          20,
          `font-weight:700;color:${s.here === true ? `#d63a3a` : `#1f2328`};justify-content:center;text-align:center`
        )
      ),
      box(
        `width:100%;height:30px;justify-content:center;align-items:center;background-image:linear-gradient(180deg,transparent 40%,${line} 40%,${line} 60%,transparent 60%)`,
        s.here === true
          ? box(
              `width:28px;height:28px;border-radius:50%;background:#d63a3a;border:4px solid #ffffff;box-shadow:0 0 0 2px #d63a3a`
            )
          : box(
              `width:20px;height:20px;border-radius:50%;background:#ffffff;border:4px solid ${line}`
            )
      ),
      box(
        `justify-content:center;min-width:96px;padding:2px 8px;border:2px solid ${s.here === true ? `#d63a3a` : `#1f2328`};background:${s.here === true ? `#d63a3a` : `#ffffff`};color:${s.here === true ? `#ffffff` : `#1f2328`};font-size:24px;font-weight:700`,
        esc(show(s.fare))
      )
    );
  return col(
    `width:640px;background:#eef1f4;padding:16px 20px;gap:14px;font-family:${FONTS.sans}`,
    box(
      `background:#24396b;color:#ffffff;padding:6px 16px;border-radius:6px`,
      words(show(m.title), 26, `font-weight:700`)
    ),
    ...rows.map((row) =>
      box(`justify-content:flex-start`, ...row.map(station))
    ),
    m.notes === undefined
      ? ``
      : col(
          `gap:2px`,
          ...m.notes.map((note) => words(show(note), 20, `color:#3a3f45`))
        )
  );
};

/** Station signs: exits in yellow, lines in navy, the rest in grey, each with its arrow. */
export const stationSigns = (m: Of<`station-signs`>, show: Show): string => {
  const looks: Partial<Record<Tone, { fill: string; ink: string }>> = {
    yellow: { fill: `#f5c518`, ink: `#111111` },
    navy: { fill: `#24396b`, ink: `#ffffff` },
    green: { fill: `#2a9354`, ink: `#ffffff` },
    gray: { fill: `#4a4f56`, ink: `#ffffff` },
    orange: { fill: `#e2702a`, ink: `#ffffff` }
  };
  return col(
    `width:640px;background-image:linear-gradient(180deg,#2e3135,#45494f);padding:18px;gap:14px;font-family:${FONTS.sans}`,
    ...m.signs.map((sign) => {
      const look = looks[sign.tone] ?? {
        fill: TONES[sign.tone].ink,
        ink: `#ffffff`
      };
      const arrow = box(
        `width:72px;justify-content:center;align-items:center;font-size:52px;font-weight:900;color:${look.ink};border-${sign.arrow === `right` ? `left` : `right`}:2px solid ${look.ink}`,
        ARROWS[sign.arrow]
      );
      const text = col(
        `flex:1;padding:8px 16px;gap:2px;color:${look.ink}`,
        ...sign.lines.map((line, index) =>
          words(
            show(line),
            index === 0 ? 32 : 23,
            index === 0 ? `font-weight:900` : `font-weight:700`
          )
        )
      );
      return box(
        `background:${look.fill};border-radius:4px;box-shadow:0 3px 6px rgba(0,0,0,0.45)`,
        ...(sign.arrow === `right` ? [text, arrow] : [arrow, text])
      );
    })
  );
};

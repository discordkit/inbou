import type { Material } from "../items.js";
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

/** Daily life: calendars, forecasts, medicine, forms and messages. */

type Of<K extends Material[`kind`]> = Extract<Material, { kind: K }>;

const SUNDAY = `#d63a3a`;
const SATURDAY = `#2b74cf`;

/** A month on a wall. Marked days are filled with their colour and carry the legend's short word; Sundays are red and Saturdays blue, as on any Japanese calendar. */
export const calendar = (m: Of<`calendar`>, show: Show): string => {
  const cells: Array<number | null> = [
    ...Array.from({ length: m.first }, () => null),
    ...Array.from({ length: m.days }, (_, index) => index + 1)
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<Array<number | null>> = [];
  for (let start = 0; start < cells.length; start += 7)
    weeks.push(cells.slice(start, start + 7));
  const legendOf = (
    day: number
  ): Of<`calendar`>[`legend`][number] | undefined => {
    const mark = m.marks.find((entry) => entry.day === day);
    return mark === undefined
      ? undefined
      : m.legend.find((entry) => entry.tone === mark.tone);
  };
  const dayInk = (index: number): string =>
    index === 0 ? SUNDAY : index === 6 ? SATURDAY : `#2a2a2a`;
  return col(
    `width:600px;background:#f5f2ea;padding:18px;gap:10px;font-family:${FONTS.round}`,
    box(
      `justify-content:center`,
      words(show(m.title), 30, `font-weight:900;color:#2a2a2a`)
    ),
    col(
      `background:#ffffff;border:2px solid #cfc7b5`,
      box(
        `background:#efe9db`,
        ...m.week.map((day, index) =>
          box(
            `flex:1;justify-content:center;padding:4px 0;font-size:22px;font-weight:700;color:${dayInk(index)}`,
            esc(show(day))
          )
        )
      ),
      ...weeks.map((week) =>
        box(
          ``,
          ...week.map((day, index) => {
            const entry = day === null ? undefined : legendOf(day);
            return col(
              `flex:1;height:64px;padding:3px 6px;border-top:1px solid #e2dccd;border-left:${index === 0 ? `0` : `1px`} solid #e2dccd;background:${entry === undefined ? `#ffffff` : TONES[entry.tone].pale}`,
              label(
                day === null ? `` : String(day),
                `font-size:20px;font-weight:700;color:${dayInk(index)}`
              ),
              entry === undefined
                ? ``
                : box(
                    `justify-content:center`,
                    label(
                      show(entry.short),
                      `font-size:15px;font-weight:900;color:${TONES[entry.tone].ink}`
                    )
                  )
            );
          })
        )
      )
    ),
    col(
      `gap:4px;padding-top:4px`,
      ...m.legend.map((entry) =>
        box(
          `align-items:center;gap:10px`,
          label(
            show(entry.short),
            `background:${TONES[entry.tone].pale};color:${TONES[entry.tone].ink};border:2px solid ${TONES[entry.tone].ink};font-size:19px;font-weight:900;padding:0 8px;border-radius:4px`
          ),
          words(show(entry.label), 21, `color:#2a2a2a`)
        )
      )
    ),
    m.notes === undefined
      ? ``
      : col(
          `gap:2px`,
          ...m.notes.map((note) => words(show(note), 21, `color:#2a2a2a`))
        )
  );
};

/** Weather glyphs in their usual colours: sun orange, cloud grey, rain blue. */
const SKY = {
  sunny: [[`☀`, `#f29a1f`]],
  cloudy: [[`☁`, `#8a949e`]],
  rain: [[`☂`, `#2b74cf`]],
  snow: [[`☃`, `#6fb1e3`]],
  "sunny-cloudy": [
    [`☀`, `#f29a1f`],
    [`☁`, `#8a949e`]
  ],
  "cloudy-rain": [
    [`☁`, `#8a949e`],
    [`☂`, `#2b74cf`]
  ]
} as const;

/** A week's forecast, as a news programme or an app shows it: highs in red, lows in blue. */
export const weather = (m: Of<`weather`>, show: Show): string => {
  const rowLabel = (text: string, ink: string, height: number): string =>
    box(
      `height:${String(height)}px;align-items:center;font-size:17px;font-weight:700;color:${ink}`,
      esc(show(text))
    );
  return col(
    `width:640px;background-image:linear-gradient(180deg,#5aa9e6,#2b74cf);padding:16px;font-family:${FONTS.sans}`,
    col(
      `background:#ffffff;border-radius:14px;padding:14px 14px 12px;gap:8px`,
      words(show(m.title), 26, `font-weight:700;color:#1f3a63`),
      box(
        `gap:4px`,
        col(
          `width:72px;padding-top:${String(36 + 52 + 30)}px`,
          rowLabel(m.labels[0], `#d63a3a`, 34),
          rowLabel(m.labels[1], `#2b74cf`, 32),
          rowLabel(m.labels[2], `#5f6670`, 30)
        ),
        ...m.days.map((day) =>
          col(
            `flex:1;align-items:center;background:#f4f7fb;border-radius:8px`,
            box(
              `height:36px;align-items:center;font-size:21px;font-weight:700;color:#1f2328`,
              esc(show(day.day))
            ),
            box(
              `height:52px;align-items:center`,
              ...SKY[day.sky].map(([glyph, ink], index) =>
                box(
                  `font-size:${index === 0 && SKY[day.sky].length === 1 ? `40` : `30`}px;color:${ink}`,
                  glyph
                )
              )
            ),
            box(
              `height:30px;align-items:center;font-size:17px;color:#3a3f45`,
              esc(show(day.label))
            ),
            box(
              `height:34px;align-items:center;font-size:24px;font-weight:700;color:#d63a3a`,
              `${String(day.high)}℃`
            ),
            box(
              `height:32px;align-items:center;font-size:21px;color:#2b74cf`,
              `${String(day.low)}℃`
            ),
            box(
              `height:30px;align-items:center;font-size:19px;color:#5f6670`,
              `${String(day.rain)}%`
            )
          )
        )
      ),
      m.notes === undefined
        ? ``
        : col(
            `gap:2px`,
            ...m.notes.map((note) => words(show(note), 19, `color:#3a3f45`))
          )
    )
  );
};

/** The paper bag a pharmacy hands medicine over in: when to take it, how much, for how many days. */
export const medicineBag = (m: Of<`medicine-bag`>, show: Show): string => {
  const green = `#2a9354`;
  return col(
    `width:520px;background:#dfe8e3;padding:18px;font-family:${FONTS.sans}`,
    col(
      `background:#ffffff;border:2px solid #b8c4be;padding:0 0 16px;gap:12px;box-shadow:0 3px 8px rgba(0,0,0,0.2)`,
      box(
        `height:16px;background-image:repeating-linear-gradient(90deg,#ffffff 0px,#ffffff 10px,#e8eeea 10px,#e8eeea 20px)`
      ),
      box(
        `justify-content:center;padding:0 20px`,
        box(
          `background:${green};border-radius:8px;padding:4px 24px`,
          words(show(m.medicine), 34, `color:#ffffff;font-weight:900`)
        )
      ),
      box(
        `justify-content:center;padding:0 20px`,
        words(
          show(m.patient),
          28,
          `font-weight:700;color:#1f2328;border-bottom:2px solid #1f2328;padding:0 10px`
        )
      ),
      box(
        `justify-content:center;gap:12px;padding:6px 20px`,
        ...m.slots.map((slot) =>
          col(
            `align-items:center;gap:4px;width:96px;border:2px solid ${green};border-radius:8px;padding:6px 0`,
            words(
              show(slot.label),
              22,
              `font-weight:700;color:#1f2328;justify-content:center`
            ),
            box(
              `width:34px;height:34px;border:2px solid #1f2328;justify-content:center;align-items:center;background:#ffffff`,
              slot.checked ? ICONS.tick(30, `#d63a3a`) : ``
            )
          )
        )
      ),
      box(
        `justify-content:center;padding:0 20px`,
        box(
          `border:3px solid ${green};border-radius:24px;padding:2px 22px`,
          words(show(m.when), 26, `font-weight:900;color:${green}`)
        )
      ),
      col(
        `align-items:center;gap:2px;padding:0 20px`,
        words(show(m.amount), 24, `color:#1f2328;font-weight:700`),
        words(show(m.days), 24, `color:#1f2328;font-weight:700`)
      ),
      m.notes === undefined
        ? ``
        : col(
            `gap:2px;padding:0 24px`,
            ...m.notes.map((note) => words(show(note), 19, `color:#3a3f45`))
          ),
      box(
        `justify-content:flex-end;padding:4px 24px 0`,
        words(show(m.clinic), 19, `color:#5f6670`)
      )
    )
  );
};

const checkBoxes = (
  checks: ReadonlyArray<{ label: string; checked: boolean }>,
  show: Show,
  ink: string
): string =>
  box(
    `flex-wrap:wrap;gap:6px 18px`,
    ...checks.map((check) =>
      box(
        `align-items:center;gap:6px`,
        box(
          `width:24px;height:24px;border:2px solid #333333;background:#ffffff;justify-content:center;align-items:center`,
          check.checked ? ICONS.tick(22, ink) : ``
        ),
        words(show(check.label), 20, `color:#222222`)
      )
    )
  );

/** A printed form, filled in by hand in pen: a missed-delivery slip on coloured paper, or an application on white. */
export const form = (m: Of<`form`>, show: Show): string => {
  const delivery = m.variant === `delivery`;
  const pen = `#1f3a93`;
  const paper = delivery ? `#fff1c9` : `#ffffff`;
  const accent = delivery ? `#e2702a` : `#333333`;
  const labelFont = delivery ? FONTS.sans : FONTS.serif;
  return col(
    `width:600px;background:${delivery ? `#d7cfbe` : `#e3e3e3`};padding:16px;font-family:${labelFont}`,
    col(
      `background:${paper};border:2px solid ${delivery ? `#e2a400` : `#999999`};padding:14px;gap:10px;box-shadow:0 2px 6px rgba(0,0,0,0.2)`,
      delivery
        ? box(
            `justify-content:center;background:${accent};padding:6px`,
            words(show(m.title), 28, `color:#ffffff;font-weight:900`)
          )
        : box(
            `justify-content:center;padding:2px 0 6px`,
            words(
              show(m.title),
              30,
              `color:#222222;font-weight:700;letter-spacing:2px`
            )
          ),
      m.head === undefined
        ? ``
        : col(
            `align-items:flex-end`,
            ...m.head.map((line) => words(show(line), 18, `color:#333333`))
          ),
      col(
        `border:2px solid ${accent}`,
        ...m.fields.map((field, index) =>
          box(
            `border-top:${index === 0 ? `0` : `1px`} solid ${accent}`,
            box(
              `width:170px;padding:8px 10px;background:${delivery ? `#fde2c4` : `#f2f2f2`};border-right:1px solid ${accent};align-items:center`,
              words(show(field.label), 20, `font-weight:700;color:#222222`)
            ),
            col(
              `flex:1;padding:6px 12px;gap:6px;justify-content:center`,
              field.value === undefined
                ? ``
                : words(
                    show(field.value),
                    26,
                    `font-family:${FONTS.hand};color:${pen};font-weight:600`
                  ),
              field.checks === undefined
                ? ``
                : checkBoxes(field.checks, show, pen)
            )
          )
        )
      ),
      m.foot === undefined
        ? ``
        : col(
            `gap:2px`,
            ...m.foot.map((line) => words(show(line), 19, `color:#333333`))
          )
    )
  );
};

/** A group chat on a phone: others on the left with a name and an initial, the reader's own messages in green on the right. */
export const chat = (m: Of<`chat`>, show: Show): string =>
  col(
    `width:420px;background:#121212;padding:10px;border-radius:36px;font-family:${FONTS.sans}`,
    col(
      `background:#8ba4c6;border-radius:28px;overflow:hidden;padding-bottom:14px`,
      box(
        `justify-content:center;padding:8px 0 4px;background:#2f3e57`,
        box(`width:90px;height:18px;background:#121212;border-radius:10px`)
      ),
      box(
        `justify-content:center;background:#2f3e57;padding:6px 0 12px`,
        words(show(m.room), 22, `color:#ffffff;font-weight:700`)
      ),
      m.day === undefined
        ? ``
        : box(
            `justify-content:center;padding-top:10px`,
            label(
              show(m.day),
              `background:rgba(47,62,87,0.45);color:#ffffff;font-size:15px;padding:2px 12px;border-radius:10px`
            )
          ),
      col(
        `padding:8px 12px 0;gap:10px`,
        ...m.messages.map((message) => {
          const time = label(
            show(message.time),
            `font-size:13px;color:#eef2f8;align-self:flex-end;padding:0 4px`
          );
          const bubble = (fill: string): string =>
            box(
              `max-width:260px;background:${fill};border-radius:16px;padding:8px 12px`,
              words(show(message.text), 20, `color:#1f2328`)
            );
          if (message.me === true) {
            return box(
              `justify-content:flex-end;align-items:flex-end`,
              time,
              bubble(`#8de055`)
            );
          }
          const name = show(message.from);
          return box(
            `gap:8px`,
            box(
              `width:40px;height:40px;border-radius:50%;background:${TONES[toneOf(name)].ink};justify-content:center;align-items:center;color:#ffffff;font-size:18px;font-weight:700`,
              esc(Array.from(name)[0] ?? ``)
            ),
            col(
              `gap:2px`,
              label(name, `font-size:14px;color:#ffffff`),
              box(`align-items:flex-end`, bubble(`#ffffff`), time)
            )
          );
        })
      )
    )
  );

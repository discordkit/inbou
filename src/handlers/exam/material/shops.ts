import { yen, type Material } from "../items.js";
import {
  FONTS,
  TONES,
  box,
  col,
  label,
  toneOf,
  words,
  type Show
} from "./kit.js";

/** Shops and machines: what a till prints, what a machine sells, what a card collects. */

type Of<K extends Material[`kind`]> = Extract<Material, { kind: K }>;

const rule = (style = ``): string =>
  box(`border-top:2px dashed #9a9a9a;margin:6px 0;${style}`);

/** A till receipt on narrow thermal paper. */
export const receipt = (m: Of<`receipt`>, show: Show): string => {
  const row = (
    name: string,
    amount: number,
    size: number,
    weight: number
  ): string =>
    box(
      `justify-content:space-between;align-items:center;font-size:${String(size)}px;line-height:${String(size + 10)}px;font-weight:${String(weight)}`,
      words(show(name), size),
      label(yen(amount))
    );
  return col(
    `width:380px;background:#c9cdd1;padding:22px 26px;font-family:${FONTS.sans}`,
    col(
      `background:#fffffd;padding:22px 20px 26px;color:#222222;box-shadow:0 3px 8px rgba(0,0,0,0.3)`,
      box(
        `justify-content:center`,
        words(show(m.store), 26, `font-weight:700;justify-content:center`)
      ),
      m.head === undefined
        ? ``
        : col(
            `align-items:center;padding-top:4px`,
            ...m.head.map((line) =>
              words(show(line), 17, `color:#444444;justify-content:center`)
            )
          ),
      rule(),
      ...m.items.map((item) => row(item.name, item.price, 20, 400)),
      rule(),
      row(m.total.label, m.total.amount, 26, 700),
      row(m.paid.label, m.paid.amount, 20, 400),
      row(m.change.label, m.change.amount, 20, 400),
      m.foot === undefined
        ? ``
        : col(
            `align-items:center;padding-top:10px`,
            rule(`width:100%`),
            ...m.foot.map((line) =>
              words(show(line), 17, `color:#444444;justify-content:center`)
            )
          )
    )
  );
};

const sticker = (text: string, index: number): string =>
  box(
    `background:#fff27a;padding:6px 12px;transform:rotate(${index % 2 === 0 ? `-1.2` : `0.9`}deg);box-shadow:1px 2px 3px rgba(0,0,0,0.3)`,
    words(text, 20, `color:#1a1a1a;font-weight:700`)
  );

/** A meal-ticket machine (食券機): a grid of lit buttons by group, each with its price. */
const tickets = (m: Of<`machine`>, show: Show): string => {
  const inner = 600 - 32 - 6 - 28;
  const gap = 8;
  const width = Math.floor((inner - gap * 3) / 4);
  return col(
    `width:600px;background-image:linear-gradient(180deg,#b9c0c7,#9aa2aa);padding:16px;font-family:${FONTS.sans}`,
    col(
      `background-image:linear-gradient(180deg,#f1f3f5,#d7dce1);border:3px solid #8a929b;border-radius:12px;padding:14px;gap:12px`,
      box(
        `justify-content:center;background:#2f3640;border-radius:6px;padding:6px`,
        words(show(m.title), 26, `color:#ffffff;font-weight:700`)
      ),
      ...m.groups.map((group) =>
        col(
          `gap:8px`,
          label(
            show(group.head),
            `background:${TONES[group.tone].ink};color:#ffffff;font-size:20px;font-weight:700;padding:2px 12px;border-radius:4px`
          ),
          box(
            `flex-wrap:wrap;gap:${String(gap)}px`,
            ...group.buttons.map((button) =>
              col(
                `width:${String(width)}px;align-items:center;padding:8px 4px;gap:2px;border:2px solid ${TONES[group.tone].ink};border-radius:8px;background-image:linear-gradient(180deg,#ffffff,${TONES[group.tone].pale})`,
                words(
                  show(button.name),
                  24,
                  `font-weight:700;color:#1f2328;justify-content:center`
                ),
                label(
                  `${String(button.price)}円`,
                  `font-size:22px;color:${TONES[group.tone].ink};font-weight:700`
                ),
                button.mark === undefined
                  ? ``
                  : label(
                      show(button.mark),
                      `background:#e8262f;color:#ffffff;font-size:17px;font-weight:700;padding:0 8px;border-radius:10px`
                    )
              )
            )
          )
        )
      ),
      m.notes === undefined
        ? ``
        : box(
            `flex-wrap:wrap;gap:10px;padding-top:4px`,
            ...m.notes.map((note, index) => sticker(show(note), index))
          ),
      box(
        `justify-content:space-between;align-items:center;padding:6px 20px 0`,
        box(`width:110px;height:16px;background:#1f2328;border-radius:8px`),
        box(`width:160px;height:28px;background:#1f2328;border-radius:4px`)
      )
    )
  );
};

/** A drinks machine: a sample of each drink behind glass, a price display and a button under it. */
const drinks = (m: Of<`machine`>, show: Show): string => {
  const body = `#c62828`;
  return col(
    `width:600px;background:#3b3f44;padding:16px;font-family:${FONTS.sans}`,
    col(
      `background:${body};border-radius:12px;padding:14px;gap:12px`,
      box(
        `justify-content:center;background:#ffffff;border-radius:6px;padding:4px`,
        words(show(m.title), 26, `color:${body};font-weight:900`)
      ),
      ...m.groups.map((group) =>
        col(
          `background:#f4f6f8;border-radius:8px;padding:8px 10px 10px;gap:8px`,
          label(
            show(group.head),
            `background:${TONES[group.tone].ink};color:#ffffff;font-size:20px;font-weight:700;padding:0 14px;border-radius:12px;align-self:flex-start`
          ),
          box(
            `gap:10px;justify-content:space-around`,
            ...group.buttons.map((button) => {
              const can = TONES[toneOf(button.name)].ink;
              return col(
                `align-items:center;gap:4px;width:120px`,
                col(
                  `width:62px;height:96px;border-radius:14px 14px 8px 8px;background:${can};align-items:center;justify-content:center`,
                  box(`width:62px;height:26px;background:#ffffff`)
                ),
                words(
                  show(button.name),
                  18,
                  `color:#1f2328;justify-content:center;font-weight:700`
                ),
                box(
                  `background:#111111;padding:0 10px;border-radius:3px;font-family:${FONTS.dot};font-size:22px;color:#ffa12b`,
                  String(button.price)
                ),
                button.mark === undefined
                  ? box(
                      `width:38px;height:18px;border-radius:9px;background:${TONES[group.tone].ink}`
                    )
                  : label(
                      show(button.mark),
                      `background:#e8262f;color:#ffffff;font-size:16px;font-weight:700;padding:0 8px;border-radius:9px`
                    )
              );
            })
          )
        )
      ),
      m.notes === undefined
        ? ``
        : box(
            `flex-wrap:wrap;gap:10px`,
            ...m.notes.map((note, index) => sticker(show(note), index))
          ),
      box(
        `justify-content:flex-end;padding:0 16px`,
        box(`width:180px;height:44px;background:#1f2328;border-radius:6px`)
      )
    )
  );
};

export const machine = (m: Of<`machine`>, show: Show): string =>
  m.variant === `tickets` ? tickets(m, show) : drinks(m, show);

/** A café's stamp card: a slot for each visit, the stamps so far, and the prizes along the way. */
export const stampCard = (m: Of<`stamp-card`>, show: Show): string => {
  const brown = `#8a5a2b`;
  const perRow = 5;
  const slot = (number: number): string => {
    const reward = m.rewards.find((r) => r.at === number);
    const stamped = number <= m.stamped;
    // The prize sits under its circle, so a stamp never covers what the slot earns.
    return col(
      `width:96px;align-items:center;gap:4px`,
      col(
        `width:84px;height:84px;border-radius:50%;justify-content:center;align-items:center;border:2px dashed #c9a27a;background:${reward === undefined ? `#ffffff` : `#fff1c2`};position:relative`,
        label(String(number), `font-size:22px;color:#c9a27a`),
        stamped
          ? box(
              `position:absolute;top:4px;left:4px;width:72px;height:72px;border-radius:50%;border:4px solid rgba(214,58,58,0.85);justify-content:center;align-items:center;transform:rotate(-12deg);font-size:34px;color:rgba(214,58,58,0.85)`,
              `★`
            )
          : ``
      ),
      box(
        `height:44px;justify-content:center`,
        reward === undefined
          ? ``
          : words(
              show(reward.label),
              17,
              `color:#ffffff;background:${brown};font-weight:700;justify-content:center;padding:0 8px;border-radius:10px`
            )
      )
    );
  };
  const numbers = Array.from({ length: m.slots }, (_, index) => index + 1);
  const rows: number[][] = [];
  for (let start = 0; start < numbers.length; start += perRow)
    rows.push(numbers.slice(start, start + perRow));
  return col(
    `width:600px;background:#e9e3d8;padding:20px;font-family:${FONTS.round}`,
    col(
      `background:#fffaf0;border:3px solid ${brown};border-radius:18px;padding:18px 20px;gap:12px;box-shadow:0 3px 8px rgba(0,0,0,0.25)`,
      box(
        `justify-content:space-between;align-items:flex-end;border-bottom:2px solid ${brown};padding-bottom:6px`,
        words(show(m.shop), 30, `color:${brown};font-weight:900`),
        words(show(m.title), 22, `color:#5a3c1c;font-weight:700`)
      ),
      ...rows.map((row) =>
        box(`justify-content:space-between`, ...row.map(slot))
      ),
      m.notes === undefined
        ? ``
        : col(
            `gap:2px`,
            ...m.notes.map((note) => words(show(note), 19, `color:#5a3c1c`))
          )
    )
  );
};

/** A cinema or concert ticket, with the stub that tears off. */
export const ticket = (m: Of<`ticket`>, show: Show): string => {
  const band = `#7a4cc2`;
  return col(
    `width:640px;background:#2b2f36;padding:24px;font-family:${FONTS.sans}`,
    box(
      `background:#ffffff;border-radius:10px`,
      box(`width:16px;background:${band};border-radius:10px 0 0 10px`),
      col(
        `flex:1;padding:14px 18px;gap:8px`,
        words(show(m.venue), 18, `color:#6a717a`),
        words(
          show(m.title),
          30,
          `font-family:${FONTS.round};font-weight:900;color:#1f2328`
        ),
        box(
          `flex-wrap:wrap;gap:10px 22px`,
          ...m.fields.map((field) =>
            col(
              `min-width:170px`,
              words(show(field.label), 16, `color:#6a717a`),
              words(show(field.value), 25, `font-weight:700;color:#1f2328`)
            )
          )
        )
      ),
      col(
        `width:150px;border-left:3px dashed #b6bcc4;background:#f3effa;padding:14px 12px;gap:6px;border-radius:0 10px 10px 0;justify-content:center`,
        ...(m.stub ?? []).map((line) =>
          words(show(line), 18, `color:#3b2a66;font-weight:700`)
        )
      )
    )
  );
};

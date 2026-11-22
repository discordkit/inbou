import type { Material } from "../items.js";
import type { Show } from "./kit.js";
import { calendar, chat, form, medicineBag, weather } from "./life.js";
import { SHEET_WIDTH, sheetHtml } from "./sheets.js";
import { machine, receipt, stampCard, ticket } from "./shops.js";
import {
  departureBoard,
  fareChart,
  routeSearch,
  stationSigns,
  stopTimetable
} from "./transit.js";

/**
 * The HTML a 問題6 picture is drawn from.
 *
 * Pure: material in, an HTML string out, for takumi to lay out and draw. Nothing here touches the runtime, so the build draws pictures in Node and a Worker could draw them later.
 *
 * Each kind of document has its own template, built to look like the real thing: a bus-stop timetable, a receipt, a medicine bag. The picture holds only the information, never the options, and has no furigana: its readings go in a line under it. Every word it shows comes from the item's YAML, so the build checks it and the alt text holds it.
 */

/** Tallest a picture may be. A tall one is shrunk in the chat, and the student opens it full size; the 問題6 timer allows for that. */
export const MATERIAL_MAX_HEIGHT = 1000;

/** Canvas width in CSS pixels. The build draws at twice this, for sharp phone screens. A phone screen or a receipt is narrow, as the real thing is. */
export const materialWidth = (material: Material): number => {
  switch (material.kind) {
    case `stop-timetable`:
      return 560;
    case `departure-board`:
    case `fare-chart`:
    case `station-signs`:
    case `ticket`:
    case `weather`:
      return 640;
    case `route-search`:
    case `chat`:
      return 420;
    case `receipt`:
      return 380;
    case `medicine-bag`:
      return 520;
    case `machine`:
    case `stamp-card`:
    case `calendar`:
    case `form`:
    case `notice`:
    case `sign`:
    case `signboard`:
    case `poster`:
    case `board`:
    case `chalkboard`:
    case `flyer`:
    case `whiteboard`:
    case `directory`:
    case `timetable`:
      return SHEET_WIDTH;
  }
};

/** The picture's HTML. Takes `show` (`bare` from items.ts) rather than importing it, so the ruby rule stays in one place. */
export const materialHtml = (material: Material, show: Show): string => {
  switch (material.kind) {
    case `stop-timetable`:
      return stopTimetable(material, show);
    case `departure-board`:
      return departureBoard(material, show);
    case `route-search`:
      return routeSearch(material, show);
    case `fare-chart`:
      return fareChart(material, show);
    case `station-signs`:
      return stationSigns(material, show);
    case `receipt`:
      return receipt(material, show);
    case `machine`:
      return machine(material, show);
    case `stamp-card`:
      return stampCard(material, show);
    case `ticket`:
      return ticket(material, show);
    case `calendar`:
      return calendar(material, show);
    case `weather`:
      return weather(material, show);
    case `medicine-bag`:
      return medicineBag(material, show);
    case `form`:
      return form(material, show);
    case `chat`:
      return chat(material, show);
    case `notice`:
    case `sign`:
    case `signboard`:
    case `poster`:
    case `board`:
    case `chalkboard`:
    case `flyer`:
    case `whiteboard`:
    case `directory`:
    case `timetable`:
      return sheetHtml(material, show);
  }
};

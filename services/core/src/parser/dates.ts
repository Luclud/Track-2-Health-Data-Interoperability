// Date parsing for the scenario documents. English + German month names, Europe/Vienna times.
import { DateTime } from "luxon";
import { foldText } from "./names.ts";

export const ZONE = "Europe/Vienna";

const MONTHS: Record<string, number> = {};
const EN = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DE = ["januar", "februar", "marz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];
EN.forEach((m, i) => {
  MONTHS[m] = i + 1;
  MONTHS[m.slice(0, 3)] = i + 1;
});
DE.forEach((m, i) => {
  MONTHS[m] = i + 1;
  MONTHS[m.slice(0, 3)] = i + 1;
});
Object.assign(MONTHS, { janner: 1, jan: 1, jann: 1, feber: 2, sept: 9, mrz: 3, maerz: 3 });

export function monthFromName(name: string): number | undefined {
  return MONTHS[foldText(name).replace(/\.$/, "")];
}

export interface YMD {
  year: number;
  month: number;
  day: number;
}

function valid(y: number, m: number, d: number): YMD | undefined {
  const dt = DateTime.fromObject({ year: y, month: m, day: d }, { zone: ZONE });
  return dt.isValid ? { year: y, month: m, day: d } : undefined;
}

const MONTH_WORD = "([A-Za-zÄÖÜäöü]+\\.?)";

/** Parses "12 March 1961", "12. März 1961", "March 12, 1961", "1961-03-12", "12.03.1961". */
export function parseDate(input: string): YMD | undefined {
  const s = input.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return valid(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})$/.exec(s);
  if (m) return valid(+m[3]!, +m[2]!, +m[1]!);
  m = new RegExp(`^(\\d{1,2})\\.?\\s+${MONTH_WORD}\\s+(\\d{4})$`).exec(s);
  if (m) {
    const mo = monthFromName(m[2]!);
    return mo ? valid(+m[3]!, mo, +m[1]!) : undefined;
  }
  m = new RegExp(`^${MONTH_WORD}\\s+(\\d{1,2}),?\\s+(\\d{4})$`).exec(s);
  if (m) {
    const mo = monthFromName(m[1]!);
    return mo ? valid(+m[3]!, mo, +m[2]!) : undefined;
  }
  return undefined;
}

export function toIsoDate(d: YMD): string {
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/** Parses "<date>, HH:MM" (also "<date> HH:MM", "<date> um HH:MM Uhr") → ISO 8601 with Vienna offset. */
export function parseDateTime(input: string): string | undefined {
  const m = /^(.*?)(?:,|\s+um|\s+at)?\s+(\d{1,2})[:.](\d{2})(?:\s*(?:Uhr|h))?$/i.exec(input.trim());
  if (!m) return undefined;
  const d = parseDate(m[1]!.replace(/,\s*$/, ""));
  if (!d) return undefined;
  const dt = DateTime.fromObject({ ...d, hour: +m[2]!, minute: +m[3]! }, { zone: ZONE });
  if (!dt.isValid || +m[2]! > 23) return undefined;
  return dt.toISO({ suppressMilliseconds: true }) ?? undefined;
}

/**
 * Parses stays: "2 to 23 September 2026", "2 September to 3 October 2026",
 * "28 December 2026 to 10 January 2027", "2. bis 23. September 2026", "02.09.2026 - 23.09.2026".
 */
export function parseDateRange(input: string): { start: string; end: string } | undefined {
  const parts = input.trim().split(/\s+(?:to|bis|until|-|–|—)\s+|\s*[–—]\s*/i);
  if (parts.length !== 2) return undefined;
  const [a, b] = [parts[0]!.trim(), parts[1]!.trim()];
  const end = parseDate(b);
  if (!end) return undefined;
  let start = parseDate(a);
  if (!start) {
    const dayOnly = /^(\d{1,2})\.?$/.exec(a);
    const dayMonth = new RegExp(`^(\\d{1,2})\\.?\\s+${MONTH_WORD}$`).exec(a);
    if (dayOnly) start = valid(end.year, end.month, +dayOnly[1]!);
    else if (dayMonth) {
      const mo = monthFromName(dayMonth[2]!);
      if (mo) start = valid(mo > end.month ? end.year - 1 : end.year, mo, +dayMonth[1]!);
    }
  }
  if (!start) return undefined;
  const s = toIsoDate(start);
  const e = toIsoDate(end);
  return s <= e ? { start: s, end: e } : undefined;
}

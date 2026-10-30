// Account A, Dev Core — task CORE-1. Deterministic Markdown parser for the scenario format (DESIGN.md §3).
import type { ParsedLabResult, ParsedLabValue, ParsedRehabReport, ParseResult, PersonName } from "@brieftaube/shared";
import type { DocumentParser } from "../ports.ts";
import { parseDate, parseDateRange, parseDateTime, toIsoDate } from "./dates.ts";
import { isValidLoinc } from "./loinc.ts";
import { foldText, parsePersonName } from "./names.ts";

export { parsePersonName, samePerson, foldText, normalizeNamePart, formatPersonName } from "./names.ts";
export { isValidLoinc, loincCheckDigit } from "./loinc.ts";
export { parseDate, parseDateTime, parseDateRange, toIsoDate } from "./dates.ts";

type Field = "patient" | "requestedBy" | "sampleTaken" | "reported" | "validatedBy" | "stay" | "reason" | "writtenBy" | "sentBy";

const FIELD_ALIASES: Record<Field, string[]> = {
  patient: ["patient", "patientin", "patient/in"],
  requestedBy: ["requested by", "angefordert von", "anforderung", "zuweiser", "zuweiserin"],
  sampleTaken: ["sample taken", "sample collected", "collected", "probenahme", "abnahme", "blutabnahme", "entnahme"],
  reported: ["reported", "report date", "befundet", "befunddatum", "befundung"],
  validatedBy: ["validated by", "validiert von", "freigegeben von", "vidiert von"],
  stay: ["stay", "aufenthalt"],
  reason: ["reason", "grund", "anlass", "aufnahmegrund"],
  writtenBy: ["written by", "verfasst von", "erstellt von"],
  sentBy: ["sent by", "gesendet von", "versendet von", "übermittelt von"],
};

const ALIAS_TO_FIELD = new Map<string, Field>();
for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [Field, string[]][]) {
  for (const a of aliases) ALIAS_TO_FIELD.set(foldText(a), field);
}

/** Matches "Key: value" and "**Key:** value". */
function fieldLine(line: string): { field: Field; value: string } | undefined {
  const m = /^\s*(?:[-*]\s+)?\**([^:*|]{2,40}?)\**\s*:\s*\**\s*(.*?)\s*$/.exec(line);
  if (!m) return undefined;
  const field = ALIAS_TO_FIELD.get(foldText(m[1]!.trim()));
  return field ? { field, value: m[2]!.replace(/\*+$/, "").trim() } : undefined;
}

function parseNumber(s: string): number | undefined {
  const t = s.trim().replace(/\s/g, "").replace(/^[+]/, "");
  if (!/^-?\d+(?:[.,]\d+)?$/.test(t)) return undefined;
  return Number(t.replace(",", "."));
}

export function parseRange(s: string): { low?: number; high?: number } | undefined {
  const t = s.trim();
  if (!t) return {};
  const num = "(-?\\d+(?:[.,]\\d+)?)";
  let m = new RegExp(`^${num}\\s*(?:to|bis|-|–|—|\\.\\.)\\s*${num}$`, "i").exec(t);
  if (m) {
    const low = parseNumber(m[1]!);
    const high = parseNumber(m[2]!);
    return low !== undefined && high !== undefined && low <= high ? { low, high } : undefined;
  }
  m = new RegExp(`^(?:<|≤|<=|below|unter|bis)\\s*${num}$`, "i").exec(t);
  if (m) return { high: parseNumber(m[1]!) };
  m = new RegExp(`^(?:>|≥|>=|above|über|ueber|ab)\\s*${num}$`, "i").exec(t);
  if (m) return { low: parseNumber(m[1]!) };
  return undefined;
}

type Column = "test" | "result" | "unit" | "range" | "loinc";
const COLUMN_PATTERNS: [Column, RegExp][] = [
  ["loinc", /loinc/],
  ["range", /(reference|referenz|norm|range|bereich)/],
  ["unit", /^(unit|units|einheit|einh\.?)$/],
  ["result", /^(result|value|wert|ergebnis|messwert|befund)$/],
  ["test", /^(test|parameter|analyt|analyte|untersuchung|name|bezeichnung)$/],
];

function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => c.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

function parseNameAndRole(value: string): { name: PersonName; role?: string; rest: string[] } {
  const [namePart, ...rest] = value.split(",").map((s) => s.trim()).filter(Boolean);
  const out: { name: PersonName; role?: string; rest: string[] } = { name: parsePersonName(namePart ?? ""), rest: rest.slice(1) };
  if (rest[0]) out.role = rest[0];
  return out;
}

function parsePatient(value: string, problems: string[]): ParsedLabResult["patient"] | undefined {
  const m = /^(.+?)\s*,?\s*\(?\s*(?:born|geb\.?|geboren(?:\s+am)?|date of birth|dob|\*)\s*:?\s*([^)]+?)\)?\s*$/i.exec(value);
  if (!m) {
    problems.push(`patient line not understood: "${value}"`);
    return undefined;
  }
  const name = parsePersonName(m[1]!.replace(/,\s*$/, ""));
  const birth = parseDate(m[2]!);
  if (!name.family || name.given.length === 0) problems.push(`patient name not understood: "${m[1]}"`);
  if (!birth) problems.push(`patient birth date not understood: "${m[2]}"`);
  if (!birth || !name.family || name.given.length === 0) return undefined;
  delete name.prefix;
  return { name, birthDate: toIsoDate(birth) };
}

function detectKind(kindText: string): "lab-result" | "rehab-discharge-report" | undefined {
  const k = foldText(kindText);
  if (/(discharge|entlass|reha)/.test(k)) return "rehab-discharge-report";
  if (/(lab|labor|befund)/.test(k)) return "lab-result";
  return undefined;
}

export class MarkdownDocumentParser implements DocumentParser {
  parse(markdown: string): ParseResult {
    try {
      return this.parseUnsafe(markdown);
    } catch (e) {
      return { ok: false, method: "parser", problems: [`parser error: ${(e as Error).message}`] };
    }
  }

  private parseUnsafe(markdown: string): ParseResult {
    const problems: string[] = [];
    if (typeof markdown !== "string" || !markdown.trim()) return { ok: false, method: "parser", problems: ["empty document"] };
    const lines = markdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");

    const titleIdx = lines.findIndex((l) => /^#\s+\S/.test(l));
    const titleLine = titleIdx >= 0 ? lines[titleIdx]!.replace(/^#\s+/, "").trim() : "";
    const tm = /^(.+?)\s*:\s*(.+)$/.exec(titleLine);
    if (!tm) return { ok: false, method: "parser", problems: ["no title line '# <Organization>: <kind>'"] };
    const organization = tm[1]!.trim();
    const kind = detectKind(tm[2]!);
    if (!kind) return { ok: false, method: "parser", problems: [`unknown document kind "${tm[2]}"`] };

    const fields: Partial<Record<Field, string>> = {};
    for (const line of lines) {
      const f = fieldLine(line);
      if (f && fields[f.field] === undefined) fields[f.field] = f.value;
    }
    if (!fields.patient) return { ok: false, method: "parser", problems: ["no 'Patient:' line"] };
    const patient = parsePatient(fields.patient, problems);
    if (!patient) return { ok: false, method: "parser", problems };

    if (kind === "lab-result") return this.parseLab(lines, titleLine, organization, patient, fields, problems);
    return this.parseRehab(markdown, titleLine, organization, patient, fields, problems);
  }

  private parseLab(
    lines: string[],
    title: string,
    organization: string,
    patient: ParsedLabResult["patient"],
    fields: Partial<Record<Field, string>>,
    problems: string[],
  ): ParseResult {
    const sampleTaken = fields.sampleTaken ? parseDateTime(fields.sampleTaken) : undefined;
    const reported = fields.reported ? parseDateTime(fields.reported) : undefined;
    if (!sampleTaken) problems.push(`sample time not understood: "${fields.sampleTaken ?? ""}"`);
    if (!reported) problems.push(`report time not understood: "${fields.reported ?? ""}"`);

    const tableStart = lines.findIndex((l) => l.trim().startsWith("|"));
    if (tableStart < 0) return { ok: false, method: "parser", problems: [...problems, "no results table"] };
    let tableEnd = tableStart;
    while (tableEnd < lines.length && lines[tableEnd]!.trim().startsWith("|")) tableEnd++;
    const rows = lines.slice(tableStart, tableEnd).map(splitRow);
    const header = rows[0]!;
    const colIndex: Partial<Record<Column, number>> = {};
    header.forEach((h, i) => {
      const key = foldText(h).trim();
      for (const [col, re] of COLUMN_PATTERNS) {
        if (colIndex[col] === undefined && re.test(key)) {
          colIndex[col] = i;
          break;
        }
      }
    });
    for (const c of ["test", "result", "loinc"] as Column[]) {
      if (colIndex[c] === undefined) problems.push(`table column "${c}" missing`);
    }

    const values: ParsedLabValue[] = [];
    if (colIndex.test !== undefined && colIndex.result !== undefined && colIndex.loinc !== undefined) {
      for (const cells of rows.slice(1)) {
        if (isSeparatorRow(cells) || cells.every((c) => !c)) continue;
        const cell = (c: Column) => (colIndex[c] !== undefined ? cells[colIndex[c]!] ?? "" : "");
        const testName = cell("test");
        const value = parseNumber(cell("result"));
        const loinc = cell("loinc").replace(/\s/g, "");
        const range = parseRange(cell("range"));
        if (value === undefined) problems.push(`value for "${testName}" not a number: "${cell("result")}"`);
        if (!isValidLoinc(loinc)) problems.push(`LOINC code for "${testName}" invalid: "${loinc}"`);
        if (range === undefined) problems.push(`reference range for "${testName}" not understood: "${cell("range")}"`);
        if (value === undefined || !isValidLoinc(loinc) || range === undefined) continue;
        const v: ParsedLabValue = { testName, value, unitText: cell("unit"), loinc };
        if (range.low !== undefined) v.referenceLow = range.low;
        if (range.high !== undefined) v.referenceHigh = range.high;
        values.push(v);
      }
    }
    if (values.length === 0) problems.push("no lab values found");

    // Conclusion: prose lines after the table, excluding field lines and headings.
    const prose: string[] = [];
    for (const line of lines.slice(tableEnd)) {
      const t = line.trim();
      if (!t || t.startsWith("#") || fieldLine(t) || /^-{3,}$/.test(t)) continue;
      prose.push(t);
    }

    if (problems.length > 0 || !sampleTaken || !reported) return { ok: false, method: "parser", problems };
    const doc: ParsedLabResult = { kind: "lab-result", title, organization, patient, sampleTaken, reported, values };
    if (fields.requestedBy) doc.requestedBy = fields.requestedBy;
    if (prose.length) doc.conclusion = prose.join(" ");
    if (fields.validatedBy) {
      const v = parseNameAndRole(fields.validatedBy);
      doc.validatedBy = v.role ? { name: v.name, role: v.role } : { name: v.name };
    }
    return { ok: true, method: "parser", document: doc, problems: [] };
  }

  private parseRehab(
    markdown: string,
    title: string,
    organization: string,
    patient: ParsedRehabReport["patient"],
    fields: Partial<Record<Field, string>>,
    problems: string[],
  ): ParseResult {
    const doc: ParsedRehabReport = { kind: "rehab-discharge-report", title, organization, patient, markdown };
    if (fields.stay) {
      const stay = parseDateRange(fields.stay);
      if (stay) doc.stay = stay;
      else problems.push(`stay not understood: "${fields.stay}"`);
    }
    if (fields.reason) doc.reason = fields.reason;
    for (const key of ["writtenBy", "sentBy"] as const) {
      const v = fields[key];
      if (!v) continue;
      const p = parseNameAndRole(v);
      doc[key] = p.role ? { name: p.name, role: p.role } : { name: p.name };
    }
    if (problems.length > 0) return { ok: false, method: "parser", problems };
    return { ok: true, method: "parser", document: doc, problems: [] };
  }
}

export function createDocumentParser(): DocumentParser {
  return new MarkdownDocumentParser();
}

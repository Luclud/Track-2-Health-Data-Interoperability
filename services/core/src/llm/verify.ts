// Verification of LLM output (docs/DESIGN.md §3). Anything not literally backed by the source is rejected.
import type { ParsedDocument, ParsedLabValue, ParseResult, PersonName } from "@brieftaube/shared";
import { DateTime } from "luxon";
import { foldText, isValidLoinc, parseDate, parseDateRange, toIsoDate } from "../parser/index.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** All numbers written in the text ("1.0", "3,1", "10^9" → 10, 9). */
export function numbersIn(text: string): number[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(",", ".")));
}

/** Every date in the text, as YYYY-MM-DD, in any supported format. */
export function datesIn(text: string): Set<string> {
  const out = new Set<string>();
  const re = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\.\s?\d{1,2}\.\s?\d{4}\b|\b\d{1,2}\.?\s+[A-Za-zÄÖÜäöüß]+\.?\s+\d{4}\b|\b[A-Za-z]+\s+\d{1,2},?\s+\d{4}\b/g;
  for (const m of text.matchAll(re)) {
    const d = parseDate(m[0]);
    if (d) out.add(toIsoDate(d));
  }
  return out;
}

/** Date ranges written as one phrase ("Stay: 2 to 23 September 2026"), as "start..end". */
function rangesIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const r = parseDateRange(line.slice(line.lastIndexOf(":") + 1).replace(/[*_]/g, ""));
    if (r) out.add(`${r.start}..${r.end}`);
  }
  return out;
}

function personName(v: unknown): PersonName | undefined {
  if (!isObj(v)) return undefined;
  const family = s(v.family);
  const given = Array.isArray(v.given) ? v.given.map(s).filter(Boolean) : [];
  if (!family || !given.length) return undefined;
  const prefix = Array.isArray(v.prefix) ? v.prefix.map(s).filter(Boolean) : [];
  return { given, family, ...(prefix.length ? { prefix } : {}) };
}

function person(v: unknown): { name: PersonName; role?: string } | undefined {
  if (!isObj(v)) return undefined;
  const name = personName(v.name);
  return name ? { name, ...(s(v.role) ? { role: s(v.role) } : {}) } : undefined;
}

const isoDateTime = (v: unknown) => {
  const d = DateTime.fromISO(s(v), { setZone: true });
  return d.isValid ? d.toISO({ suppressMilliseconds: true })! : undefined;
};
const isoDate = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(s(v)) && DateTime.fromISO(s(v)).isValid ? s(v) : undefined);

export function verifyLlmDocument(source: string, candidate: unknown): ParseResult {
  const problems: string[] = [];
  const fail = (): ParseResult => ({ ok: false, method: "llm", problems });
  if (!isObj(candidate)) return { ok: false, method: "llm", problems: ["LLM did not return an object"] };
  const folded = foldText(source);
  const nums = numbersIn(source);
  const sourceDates = datesIn(source);
  const literal = (n: unknown, what: string) => {
    if (typeof n !== "number" || !Number.isFinite(n) || !nums.includes(n)) problems.push(`${what} ${String(n)} not in source`);
  };

  const kind = candidate.kind;
  if (kind !== "lab-result" && kind !== "rehab-discharge-report") problems.push(`unknown kind ${String(kind)}`);
  const p = isObj(candidate.patient) ? candidate.patient : {};
  const pname = personName(p.name);
  const birthDate = isoDate(p.birthDate);
  if (!pname) problems.push("patient name missing");
  else {
    if (!folded.includes(foldText(pname.family))) problems.push(`patient family name ${pname.family} not in source`);
    if (!folded.includes(foldText(pname.given[0]!))) problems.push(`patient given name ${pname.given[0]} not in source`);
  }
  if (!birthDate) problems.push(`birth date ${String(p.birthDate)} does not parse`);
  else if (!sourceDates.has(birthDate)) problems.push(`birth date ${birthDate} not in source`);
  if (problems.length || !pname || !birthDate) return fail();

  const head = { title: s(candidate.title), organization: s(candidate.organization), patient: { name: pname, birthDate } };
  let doc: ParsedDocument;
  if (kind === "lab-result") {
    const raw = Array.isArray(candidate.values) ? candidate.values : [];
    if (!raw.length) problems.push("no lab values");
    const values: ParsedLabValue[] = [];
    raw.forEach((v, i) => {
      if (!isObj(v)) return void problems.push(`value ${i + 1} is not an object`);
      const loinc = s(v.loinc);
      literal(v.value, `value ${i + 1}`);
      if (v.referenceLow !== undefined) literal(v.referenceLow, `reference low ${i + 1}`);
      if (v.referenceHigh !== undefined) literal(v.referenceHigh, `reference high ${i + 1}`);
      if (!loinc || !source.includes(loinc)) problems.push(`LOINC ${loinc || "(missing)"} not in source`);
      else if (!isValidLoinc(loinc)) problems.push(`LOINC ${loinc} fails the check digit`);
      values.push({
        testName: s(v.testName) || loinc,
        value: v.value as number,
        unitText: s(v.unitText),
        ...(typeof v.referenceLow === "number" ? { referenceLow: v.referenceLow } : {}),
        ...(typeof v.referenceHigh === "number" ? { referenceHigh: v.referenceHigh } : {}),
        loinc,
      });
    });
    const sampleTaken = isoDateTime(candidate.sampleTaken);
    const reported = isoDateTime(candidate.reported);
    if (!sampleTaken) problems.push(`sample time ${String(candidate.sampleTaken)} does not parse`);
    else if (!sourceDates.has(sampleTaken.slice(0, 10))) problems.push(`sample date ${sampleTaken.slice(0, 10)} not in source`);
    if (!reported) problems.push(`report time ${String(candidate.reported)} missing or does not parse`);
    else if (!sourceDates.has(reported.slice(0, 10))) problems.push(`report date ${reported.slice(0, 10)} not in source`);
    if (problems.length || !sampleTaken || !reported) return fail();
    const validatedBy = person(candidate.validatedBy);
    doc = {
      kind,
      ...head,
      ...(s(candidate.requestedBy) ? { requestedBy: s(candidate.requestedBy) } : {}),
      sampleTaken,
      reported,
      values,
      ...(s(candidate.conclusion) ? { conclusion: s(candidate.conclusion) } : {}),
      ...(validatedBy ? { validatedBy } : {}),
    };
  } else {
    const st = isObj(candidate.stay) ? candidate.stay : undefined;
    const stay = st && isoDate(st.start) && isoDate(st.end) ? { start: s(st.start), end: s(st.end) } : undefined;
    if (st && !stay) problems.push("stay dates do not parse");
    if (stay && (!sourceDates.has(stay.start) || !sourceDates.has(stay.end)) && !rangesIn(source).has(`${stay.start}..${stay.end}`)) problems.push(`stay ${stay.start}..${stay.end} not in source`);
    if (problems.length) return fail();
    const writtenBy = person(candidate.writtenBy);
    const sentBy = person(candidate.sentBy);
    doc = {
      kind: "rehab-discharge-report",
      ...head,
      ...(stay ? { stay } : {}),
      ...(s(candidate.reason) ? { reason: s(candidate.reason) } : {}),
      ...(writtenBy ? { writtenBy } : {}),
      ...(sentBy ? { sentBy } : {}),
      markdown: source,
    };
  }
  return { ok: true, method: "llm", document: doc, problems: [] };
}

/** 1-based line of `source` and its text (as received, without the line break). */
export interface SourceEvidence {
  line: number;
  text: string;
}

/**
 * The line that literally contains `value` (same number matching as the verification above).
 * Among several, prefer the line that also contains one of the hints (test name, LOINC code).
 */
export function evidenceForNumber(source: string, value: number, hints: string[] = []): SourceEvidence | undefined {
  const lines = source.split(/\r?\n/);
  const folded = hints.map((h) => foldText(h)).filter(Boolean);
  let best: { i: number; score: number } | undefined;
  lines.forEach((text, i) => {
    if (!numbersIn(text).includes(value)) return;
    const f = foldText(text);
    const score = folded.filter((h) => f.includes(h)).length;
    if (!best || score > best.score) best = { i, score };
  });
  return best ? { line: best.i + 1, text: lines[best.i]! } : undefined;
}

/** The line that names the patient, preferring one that also contains the birth date. */
export function evidenceForPatient(source: string, name: PersonName, birthDate?: string): SourceEvidence | undefined {
  const lines = source.split(/\r?\n/);
  const family = foldText(name.family);
  let best: { i: number; score: number } | undefined;
  lines.forEach((text, i) => {
    const f = foldText(text);
    if (!f.includes(family)) return;
    const score = (name.given[0] && f.includes(foldText(name.given[0])) ? 1 : 0) + (birthDate && datesIn(text).has(birthDate) ? 2 : 0);
    if (!best || score > best.score) best = { i, score };
  });
  return best ? { line: best.i + 1, text: lines[best.i]! } : undefined;
}

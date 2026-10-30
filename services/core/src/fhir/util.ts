// Helpers shared by the FHIR builders (docs/FHIR-MAPPING.md).
import { createHash, randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import type { PersonName } from "@brieftaube/shared";
import { SYSTEMS } from "@brieftaube/shared";
import type { HumanName, Quantity } from "fhir/r4.js";
import { foldText } from "../parser/names.ts";

export const ZONE = "Europe/Vienna";
export const ASSEMBLER_SUFFIX = "Brieftaube";

/** FHIR instant/dateTime in Europe/Vienna with seconds and offset, e.g. 2026-10-30T09:05:00+01:00 */
export function viennaInstant(iso: string): string {
  const dt = DateTime.fromISO(iso, { setZone: true });
  if (!dt.isValid) throw new Error(`invalid timestamp ${iso}`);
  return dt.setZone(ZONE).startOf("second").toISO({ suppressMilliseconds: true })!;
}

/** "2026-10-30 09:11" in Europe/Vienna, for narratives */
export function viennaMinute(iso: string): string {
  return DateTime.fromISO(iso, { setZone: true }).setZone(ZONE).toFormat("yyyy-MM-dd HH:mm");
}

export function slug(s: string): string {
  return foldText(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function escapeXhtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function narrative(text: string): { status: "generated"; div: string } {
  return { status: "generated", div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>${escapeXhtml(text)}</p></div>` };
}

export function base64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export function uuidUrn(newUuid: () => string = randomUUID): string {
  return `urn:uuid:${newUuid()}`;
}

export function humanName(n: PersonName): HumanName {
  const h: HumanName = { use: "official", family: n.family, given: [...n.given] };
  if (n.prefix?.length) h.prefix = [...n.prefix];
  return h;
}

export function displayName(n: PersonName, withPrefix = true): string {
  return [...(withPrefix ? n.prefix ?? [] : []), ...n.given, n.family].filter(Boolean).join(" ");
}

/** Units as written in the document → UCUM code (DESIGN.md §3). */
const UCUM: Record<string, string> = {
  "10^9/l": "10*9/L",
  "10*9/l": "10*9/L",
  "g/l": "g/L",
  "10^12/l": "10*12/L",
  "10*12/l": "10*12/L",
  s: "s",
  sec: "s",
  "g/dl": "g/dL",
  "mg/dl": "mg/dL",
  "mg/l": "mg/L",
  "mmol/l": "mmol/L",
  "µmol/l": "umol/L",
  "μmol/l": "umol/L",
  "umol/l": "umol/L",
  "u/l": "U/L",
  "%": "%",
  "ml/min/1.73m2": "mL/min/{1.73_m2}",
  "ml/min/1.73 m2": "mL/min/{1.73_m2}",
  "ml/min/1,73m2": "mL/min/{1.73_m2}",
};

export function quantity(value: number, unitText: string, loinc: string): Quantity {
  const u = unitText.trim();
  if (!u) {
    const code = loinc === "6301-6" ? "{INR}" : "1";
    return { value, unit: code, system: SYSTEMS.ucum, code };
  }
  const code = UCUM[u.toLowerCase()];
  return code ? { value, unit: code, system: SYSTEMS.ucum, code } : { value, unit: u };
}

export function interpretationCode(value: number, low?: number, high?: number): "N" | "H" | "L" | undefined {
  if (low === undefined && high === undefined) return undefined;
  if (low !== undefined && value < low) return "L";
  if (high !== undefined && value > high) return "H";
  return "N";
}

function decimals(n: number | undefined): number {
  if (n === undefined) return 0;
  const s = String(n);
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

/** "0.8 to 1.2", "2.0 to 4.0" (precision = the most precise of value and bounds), "< 5", "> 60" */
export function rangeText(value: number, low?: number, high?: number): string | undefined {
  const d = Math.max(decimals(value), decimals(low), decimals(high));
  const f = (n: number) => n.toFixed(d);
  if (low !== undefined && high !== undefined) return `${f(low)} to ${f(high)}`;
  if (high !== undefined) return `< ${f(high)}`;
  if (low !== undefined) return `> ${f(low)}`;
  return undefined;
}

const FEMALE_GIVEN = new Set(["eva", "johanna", "maria", "anna", "sabine", "karin", "petra", "ines", "lena", "claudia", "andrea", "susanne", "monika", "elisabeth", "barbara", "katharina", "julia", "sarah", "sophie", "ingrid", "birgit", "christine", "martina", "gabriele", "doris", "renate"]);
const ROLE_DE: Record<string, { f: string; m: string }> = {
  "medical director": { f: "Ärztliche Leiterin", m: "Ärztlicher Leiter" },
  "lab physician": { f: "Laborärztin", m: "Laborarzt" },
  "senior physician": { f: "Oberärztin", m: "Oberarzt" },
  "head physician": { f: "Primaria", m: "Primarius" },
  physician: { f: "Ärztin", m: "Arzt" },
  "discharge management": { f: "Entlassungsmanagement", m: "Entlassungsmanagement" },
};

/** German label for a role written in the document; unknown roles stay as written. */
export function roleDe(role: string | undefined, name: PersonName): string | undefined {
  if (!role) return undefined;
  const r = ROLE_DE[role.trim().toLowerCase()];
  if (!r) return role;
  const first = foldText(name.given[0] ?? "");
  return FEMALE_GIVEN.has(first) ? r.f : r.m;
}

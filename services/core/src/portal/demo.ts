// Lane OUTSIDE — task V2-JURY-2. Demo documents for the live jury demo (JURY_MODE=true only).
// Built from the synthetic scenario documents; the "Patient:" line is set to the person we want.
import { readFileSync } from "node:fs";
import type { PersonName } from "@brieftaube/shared";
import type { AuthorizedRequestView } from "../ports.ts";

export const DEMO_KINDS = ["beispiel", "falsche-patientin"] as const;
export type DemoKind = (typeof DEMO_KINDS)[number];
export const isDemoKind = (s: unknown): s is DemoKind => typeof s === "string" && (DEMO_KINDS as readonly string[]).includes(s);

const DOCS = new URL("../../../../scenario/documents/", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, DOCS), "utf8");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export interface DemoPatient { name: Pick<PersonName, "given" | "family">; birthDate: string }
const MAX: DemoPatient = { name: { given: ["Max"], family: "Beispiel" }, birthDate: "1960-01-01" };
const MARIA: DemoPatient = { name: { given: ["Maria"], family: "Beispiel" }, birthDate: "1961-03-12" };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").trim();
const samePatient = (a: DemoPatient, b: DemoPatient) =>
  fold(a.name.family) === fold(b.name.family) && fold(a.name.given[0] ?? "") === fold(b.name.given[0] ?? "") && a.birthDate === b.birthDate;

/** "1961-03-12" -> "12 March 1961" (the scenario documents use English dates) */
export function englishDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : iso;
}

export function withPatient(doc: string, p: DemoPatient): string {
  return doc.replace(/^Patient:.*$/m, `Patient: ${[...p.name.given, p.name.family].join(" ")}, born ${englishDate(p.birthDate)}`);
}

/** The document the demo button puts into the textarea. "falsche-patientin" is about another person (M3). */
export function demoDocument(kind: DemoKind, v: Pick<AuthorizedRequestView, "patient" | "documentType">): string {
  const template = v.documentType === "lab-result" ? read("lab-result-maria-beispiel.md") : read("rehab-report-maria-beispiel.md");
  if (kind === "beispiel") return withPatient(template, v.patient);
  const other = samePatient(v.patient, MAX) ? MARIA : MAX;
  if (other === MAX && v.documentType === "lab-result") return read("lab-result-max-beispiel.md");
  return withPatient(template, other);
}

// CORE-5 helpers: patient / document-type checks and German texts for answers.
import type { DocumentRequest, ParsedDocument, ParsedLabResult, ParsedRehabReport, PersonName, RegisterResult } from "@brieftaube/shared";
import { DOCUMENT_TYPE_LABELS_DE } from "@brieftaube/shared";
import { formatPersonName, samePerson } from "../parser/names.ts";
import { interpretationCode } from "../fhir/util.ts";
import type { AnswerInput } from "../ports.ts";

export type PatientCheck = { ok: true } | { ok: false; source: "form" | "document"; name: PersonName; birthDate: string };

export function checkPatient(r: DocumentRequest, form: AnswerInput, doc: ParsedDocument): PatientCheck {
  const same = (n: PersonName, b: string) => samePerson(n, r.patient.name) && b === r.patient.birthDate;
  if (!same(doc.patient.name, doc.patient.birthDate)) return { ok: false, source: "document", name: doc.patient.name, birthDate: doc.patient.birthDate };
  const formName: PersonName = { given: form.patientGiven.trim().split(/\s+/).filter(Boolean), family: form.patientFamily.trim() };
  if (!same(formName, form.patientBirthDate.trim())) return { ok: false, source: "form", name: formName, birthDate: form.patientBirthDate.trim() };
  return { ok: true };
}

export const dmy = (iso: string) => iso.split("-").reverse().join(".");
const fullName = (n: PersonName) => formatPersonName(n, false);

export const RESPONDER_MESSAGES = {
  "wrong-patient": "Das Dokument betrifft nicht die angefragte Person. Es wurde nichts abgelegt. Bitte prüfen Sie das Dokument und senden Sie das Dokument der angefragten Person.",
  "wrong-document-type": (r: DocumentRequest) => `Das Dokument ist kein ${DOCUMENT_TYPE_LABELS_DE[r.documentType]}. Es wurde nichts abgelegt. Bitte senden Sie den angefragten Dokumenttyp.`,
  unreadable: "Das Dokument konnte nicht gelesen werden. Es wurde nichts abgelegt. Bitte senden Sie es im Standardformat.",
} as const;

export function chatWrongPatient(r: DocumentRequest, other: { name: PersonName; birthDate: string }): string {
  return `🛑 ${r.reference}: Antwort betrifft eine andere Person (${fullName(other.name)}, geb. ${dmy(other.birthDate)}) – NICHT abgelegt. ${r.recipient.displayName} wurde gebeten, das richtige Dokument zu senden.`;
}
export function chatWrongType(r: DocumentRequest, got: ParsedDocument["kind"]): string {
  return `🛑 ${r.reference}: Antwort ist ein ${DOCUMENT_TYPE_LABELS_DE[got]}, angefragt war ${DOCUMENT_TYPE_LABELS_DE[r.documentType]} – NICHT abgelegt.`;
}
export function chatUnreadable(r: DocumentRequest): string {
  return `🛑 ${r.reference}: Antwort von ${r.recipient.displayName} konnte nicht gelesen werden – NICHT abgelegt. Absender wurde um das Standardformat gebeten.`;
}
export function chatHeld(r: DocumentRequest, reason: string): string {
  return `⏸ ${r.reference}: Antwort wartet auf Ihre Freigabe (Grund: ${reason})`;
}
export function chatHeldRejected(r: DocumentRequest, by: { displayName: string }): string {
  return `✋ ${r.reference}: Zurückgehaltene Antwort von ${by.displayName} verworfen – NICHT abgelegt.`;
}
export const HELD_REASON_DE = {
  "not-in-register": "Absender nicht in der Ärzteliste gefunden",
  "ai-extracted": "KI-gelesen – bitte Werte prüfen",
  unreadable: "Dokument nicht sicher lesbar",
} as const;

const SHORT: Record<string, string> = { "6301-6": "INR", "14979-9": "aPTT", "3173-2": "aPTT", "777-3": "Thrombozyten", "26515-7": "Thrombozyten", "3255-7": "Fibrinogen" };
const num = (n: number) => String(n);

export function labSummaryLine(doc: ParsedLabResult): string {
  const out: string[] = [];
  const items = doc.values.map((v) => {
    const name = SHORT[v.loinc] ?? v.testName.replace(/\s*\(.*\)\s*$/, "");
    const i = interpretationCode(v.value, v.referenceLow, v.referenceHigh);
    if (i === "H" || i === "L") out.push(`${name} ${i === "H" ? "↑" : "↓"}`);
    const range = v.loinc === "6301-6" && v.referenceLow !== undefined && v.referenceHigh !== undefined ? ` (${num(v.referenceLow)}–${num(v.referenceHigh)})` : "";
    const value = v.loinc === "6301-6" ? v.value.toFixed(1) : num(v.value);
    const unit = v.unitText && !/^10\^/.test(v.unitText) ? ` ${v.unitText}` : "";
    return `${name} ${value}${range}${unit}`;
  });
  return `${items.join(" · ")} – ${out.length ? `außerhalb des Referenzbereichs: ${out.join(", ")}` : "alle im Referenzbereich"}`;
}

export function chatFiled(r: DocumentRequest, doc: ParsedDocument, register: RegisterResult): string {
  const id = `Identität: ID Austria (simuliert)${register.checked ? (register.listed ? ", Ärzteliste ✓" : ", Ärzteliste ✗ (freigegeben)") : ""}`;
  if (doc.kind === "lab-result") return `✅ ${r.reference}: Laborbefund von ${r.recipient.displayName} abgelegt. ${labSummaryLine(doc)}. ${id}`;
  const d = doc as ParsedRehabReport;
  const stay = d.stay ? ` (Aufenthalt ${dmy(d.stay.start)}–${dmy(d.stay.end)})` : "";
  return `✅ ${r.reference}: Reha-Entlassungsbericht von ${r.recipient.displayName} abgelegt${stay}. ${id}`;
}

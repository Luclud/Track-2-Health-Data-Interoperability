// CORE-12: MedicationStatements for the rehab report's discharge medication (FHIR-MAPPING.md, optional).
import type { ParsedRehabReport } from "@brieftaube/shared";
import type { Bundle, BundleEntry, MedicationStatement } from "fhir/r4.js";
import type { FilingContext } from "./types.ts";
import { displayName, uuidUrn, viennaInstant } from "./util.ts";

const HEADING = /^#{2,3}\s*(medication at discharge|discharge medication|entlassungsmedikation|medikation bei entlassung|medikation)\b/i;
const STRENGTH = /^(.+?\d+(?:[.,]\d+)?\s*(?:mg|g|µg|mcg|ml|i\.?e\.?|iu))(?=\s|,|$)[,\s]*(.*)$/i;

/** Bullet lines of the discharge-medication section. */
export function dischargeMedications(markdown: string): { medication: string; dosage?: string }[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => HEADING.test(l.trim()));
  if (start < 0) return [];
  const out: { medication: string; dosage?: string }[] = [];
  for (const raw of lines.slice(start + 1)) {
    const l = raw.trim();
    if (/^#/.test(l)) break;
    const m = /^[-*•]\s+(.+)$/.exec(l);
    if (!m) continue;
    const s = STRENGTH.exec(m[1]!.trim());
    out.push(s ? { medication: s[1]!.trim(), ...(s[2]!.trim() ? { dosage: s[2]!.trim() } : {}) } : { medication: m[1]!.trim() });
  }
  return out;
}

/** Appends one MedicationStatement per discharge medication, derivedFrom the bundle's DocumentReference. */
export function addMedicationStatements(bundle: Bundle, doc: ParsedRehabReport, ctx: FilingContext): number {
  const docEntry = bundle.entry?.find((e) => e.resource?.resourceType === "DocumentReference");
  if (!docEntry?.fullUrl) return 0;
  const meds = dischargeMedications(doc.markdown);
  const { request: r } = ctx;
  const entries: BundleEntry[] = meds.map((m) => {
    const ms: MedicationStatement = {
      resourceType: "MedicationStatement",
      status: "active",
      medicationCodeableConcept: { text: m.medication },
      subject: { reference: `Patient/${r.patient.fhirId}`, display: displayName(r.patient.name, false) },
      ...(doc.stay ? { effectivePeriod: { start: doc.stay.end } } : {}),
      dateAsserted: viennaInstant(ctx.filedAt),
      informationSource: { display: doc.organization },
      derivedFrom: [{ reference: docEntry.fullUrl! }],
      note: [{ text: "Entlassungsmedikation laut Reha-Entlassungsbericht" }],
      ...(m.dosage ? { dosage: [{ text: m.dosage }] } : {}),
    };
    return { fullUrl: uuidUrn(ctx.newUuid), resource: ms, request: { method: "POST", url: "MedicationStatement" } };
  });
  const taskIdx = bundle.entry!.findIndex((e) => e.resource?.resourceType === "Task");
  bundle.entry!.splice(taskIdx < 0 ? bundle.entry!.length : taskIdx, 0, ...entries);
  return entries.length;
}

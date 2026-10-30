// V2-AI-1: what Dr. Hofer needs to check a held answer — values with the line of the received document that contains them.
import type { HeldReason, HeldReview, ParsedDocument } from "@brieftaube/shared";
import { evidenceForNumber, evidenceForPatient } from "../llm/verify.ts";
import { rehabExcerpt } from "./summary.ts";

export function heldReview(doc: ParsedDocument, sourceText: string, reason: HeldReason, method: HeldReview["method"]): HeldReview {
  const p = doc.patient;
  const patientEvidence = evidenceForPatient(sourceText, p.name, p.birthDate);
  const review: HeldReview = {
    method,
    reason,
    patient: { given: p.name.given, family: p.name.family, birthDate: p.birthDate, ...(patientEvidence ? { evidence: patientEvidence } : {}) },
    sourceText,
  };
  if (doc.kind === "lab-result") {
    review.values = doc.values.map((v) => ({
      testName: v.testName,
      ...(v.loinc ? { loinc: v.loinc } : {}),
      value: v.value,
      unit: v.unitText,
      ...(v.referenceLow !== undefined ? { low: v.referenceLow } : {}),
      ...(v.referenceHigh !== undefined ? { high: v.referenceHigh } : {}),
      // Verified values are always literally in the source; line 0 = not found (should not happen).
      evidence: evidenceForNumber(sourceText, v.value, [v.loinc, v.testName, v.testName.replace(/\s*\(.*\)\s*$/, "")]) ?? { line: 0, text: "" },
    }));
  } else {
    review.excerpt = rehabExcerpt(doc.markdown);
  }
  return review;
}

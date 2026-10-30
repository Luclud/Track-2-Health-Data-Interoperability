// Free-text requests: the doctor only writes what they need ("Gerinnung vor OP"). They never see or pick
// from the other clinic's archive. The sender (and the sender-side AI assist) decides which document fits.
// This is only a coarse first guess, used for the sender-side ranking and the identity policy until the
// answer arrives; the document actually sent decides the final type (see RequestService.submitAnswer).
import type { DocumentType } from "@brieftaube/shared";

const REHAB_WORDS = [
  "reha", "entlass", "physio", "mobilisation", "nachbehandlung", "arztbrief", "gangbild",
];

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/** Lab result unless the text clearly asks for a rehab/discharge report. */
export function guessDocumentType(note: string): DocumentType {
  const t = fold(note);
  return REHAB_WORDS.some((w) => t.includes(w)) ? "rehab-discharge-report" : "lab-result";
}

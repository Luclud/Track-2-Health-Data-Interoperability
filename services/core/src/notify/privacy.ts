// Guard for the challenge rule: emails and SMS must not contain the patient's name, birth date
// or the type of document. Done (written in the initial commit). Every MessageSender call must
// pass the text through assertNotificationIsClean() first.

import type { DocumentType, PatientSnapshot } from "@brieftaube/shared";

const MONTHS_EN = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTHS_DE = ["jänner", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];

/** Words that reveal the kind of document. Checked as substrings of the lowercased text. */
const DOCUMENT_WORDS: Record<DocumentType, string[]> = {
  "lab-result": ["labor", "lab ", "lab-", "laboratory", "befund", "blut", "blood", "gerinnung", "clotting", "inr", "aptt", "result"],
  "rehab-discharge-report": ["reha", "rehab", "entlass", "discharge", "kur", "report", "bericht", "befund"],
};
/** Generic medical words that hint at the content regardless of type. */
const GENERIC_WORDS = ["patient", "diagnos", "befund", "medizinisch", "medical"];

export interface PrivacyFinding {
  kind: "patient-name" | "birth-date" | "document-type";
  match: string;
}

function fold(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/ß/g, "ss");
}

function birthDateVariants(iso: string): string[] {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return [iso];
  const mi = Number(m) - 1;
  const dn = String(Number(d));
  const mn = String(Number(m));
  return [
    iso,
    `${d}.${m}.${y}`,
    `${dn}.${mn}.${y}`,
    `${d}/${m}/${y}`,
    `${m}/${d}/${y}`,
    `${dn} ${MONTHS_EN[mi]} ${y}`,
    `${dn}. ${MONTHS_DE[mi]} ${y}`,
    `${dn} ${MONTHS_DE[mi]} ${y}`,
    `${MONTHS_EN[mi]} ${dn}, ${y}`,
    `${d}${m}${y.slice(2)}`, // 120361 (Austrian SVNR style)
  ].map(fold);
}

/**
 * Returns findings. `recipientAddress` is removed from the text before checking, because
 * the address itself (e.g. "...@labor-kanal.example") may legitimately contain such words.
 */
export function findPrivacyLeaks(
  text: string,
  ctx: { patient: Pick<PatientSnapshot, "name" | "birthDate">; documentType: DocumentType; recipientAddress?: string },
): PrivacyFinding[] {
  let t = text;
  if (ctx.recipientAddress) t = t.split(ctx.recipientAddress).join(" ");
  const f = fold(t);
  const findings: PrivacyFinding[] = [];

  const names = [ctx.patient.name.family, ...ctx.patient.name.given].filter((n) => n.length >= 2);
  for (const n of names) {
    const re = new RegExp(`(^|[^\\p{L}])${fold(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "u");
    if (re.test(f)) findings.push({ kind: "patient-name", match: n });
  }
  for (const v of birthDateVariants(ctx.patient.birthDate)) {
    if (f.includes(v)) findings.push({ kind: "birth-date", match: v });
  }
  const year = ctx.patient.birthDate.slice(0, 4);
  if (new RegExp(`(^|\\D)${year}(\\D|$)`).test(f)) findings.push({ kind: "birth-date", match: year });

  for (const w of [...DOCUMENT_WORDS[ctx.documentType], ...GENERIC_WORDS]) {
    if (f.includes(fold(w))) findings.push({ kind: "document-type", match: w.trim() });
  }
  return findings;
}

export class PrivacyViolationError extends Error {
  readonly findings: PrivacyFinding[];
  constructor(findings: PrivacyFinding[]) {
    super(`Notification would leak: ${findings.map((x) => `${x.kind}(${x.match})`).join(", ")}`);
    this.findings = findings;
    this.name = "PrivacyViolationError";
  }
}

export function assertNotificationIsClean(...args: Parameters<typeof findPrivacyLeaks>): void {
  const findings = findPrivacyLeaks(...args);
  if (findings.length > 0) throw new PrivacyViolationError(findings);
}

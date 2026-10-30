// Audit log entries. One entry per step; the six required steps are AuditStep below.
// Stored in SQLite + appended to data/audit.jsonl, and mirrored as FHIR AuditEvent (best effort).

export const AUDIT_STEPS = [
  "request-sent",
  "link-opened",
  "identity-checked",
  "answer-sent",
  "answer-filed",
  "misdelivery-caught",
] as const;

export type AuditStep = (typeof AUDIT_STEPS)[number];

export type ActorKind = "internal-practitioner" | "outside-person" | "unverified-visitor" | "system";

export interface AuditActor {
  kind: ActorKind;
  /** Matrix id, eID subject (bPK), "anonymous" or "brieftaube" */
  id: string;
  display: string;
}

export interface AuditEntry {
  id: string;
  requestId: string;
  requestReference: string;
  step: AuditStep;
  /** WHEN */
  at: string; // ISO 8601
  /** WHO */
  actor: AuditActor;
  /** WHAT, in one sentence (German or English is fine, keep it consistent: English) */
  what: string;
  outcome: "success" | "failure" | "warning";
  /** Extra machine-readable details, e.g. { misdelivery: "wrong-patient", ipHash: "..." } */
  details?: Record<string, unknown>;
  /** FHIR AuditEvent id once mirrored */
  fhirAuditEventId?: string;
}

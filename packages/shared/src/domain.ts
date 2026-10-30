// Domain model of a document request. See docs/ARCHITECTURE.md for the state machine.

export type DocumentType = "lab-result" | "rehab-discharge-report";

export type Channel = "email" | "sms";

export type RequestStatus =
  | "sent" // notification sent, link not opened yet
  | "opened" // link opened, identity not yet checked
  | "identity-failed" // someone opened it but was not the named recipient (request stays open for the right person)
  | "verified" // the named recipient proved their identity
  | "filed" // answer accepted and stored on the FHIR server
  | "held" // answer received but not filed automatically; Dr. Hofer must decide (see HeldReason)
  | "rejected" // answer refused (wrong patient, wrong document type); request stays open for a corrected answer
  | "expired"
  | "cancelled";

export interface PersonName {
  /** Given names, e.g. ["Maria"] */
  given: string[];
  family: string;
  /** Titles such as "Dr." or "Prof." are kept separately and ignored for matching. */
  prefix?: string[];
}

/** What Dr. Hofer knows about the outside person. */
export interface Recipient {
  /** Full name as typed by the doctor, e.g. "Dr. Eva Brandl". Parsed into PersonName by the core. */
  displayName: string;
  name: PersonName;
  /** Free text, e.g. "Laborärztin", "Entlassungsmanagement" */
  role: string;
  organization: string;
  /** true if the recipient is a physician; decides whether the register check applies */
  isPhysician: boolean;
  channel: Channel;
  /** email address or E.164-ish phone number */
  address: string;
}

/** Internal network member who sends the request (from Matrix). */
export interface Requester {
  matrixUserId: string; // "@lena.hofer:klinikum.example"
  displayName: string; // "Dr. Lena Hofer"
  organization: string; // "Klinikum Beispielstadt"
  /** FHIR Practitioner id on our FHIR server, e.g. "lena-hofer" */
  practitionerId: string;
}

export interface PatientSnapshot {
  /** FHIR Patient id on our FHIR server */
  fhirId: string;
  name: PersonName;
  birthDate: string; // YYYY-MM-DD
  gender?: string;
}

export interface DocumentRequest {
  id: string; // uuid
  /** Short human reference shown in email/SMS and in Matrix, e.g. "BT-7K2Q" */
  reference: string;
  createdAt: string; // ISO 8601
  expiresAt: string;
  status: RequestStatus;
  requester: Requester;
  /** Matrix room the request came from; notifications go back here */
  roomId: string;
  patient: PatientSnapshot;
  documentType: DocumentType;
  /** Shown to the recipient ONLY after a successful identity check. Never in email/SMS. */
  note?: string;
  recipient: Recipient;
  /** Ids of resources filed on the FHIR server for this request */
  filedResources: string[]; // e.g. ["DiagnosticReport/abc", "Observation/def"]
  /** FHIR Task id representing this request on the FHIR server */
  fhirTaskId?: string;
  heldReason?: HeldReason;
  /** Last misdelivery / rejection reason, if any */
  lastProblem?: MisdeliveryKind;
}

export type HeldReason =
  | "not-in-register" // physician not found in the (mock) physician register
  | "ai-extracted" // document was read by the LLM fallback; doctor must confirm the values
  | "unreadable"; // neither parser nor LLM could read it reliably

export type MisdeliveryKind =
  | "identity-mismatch" // verified person is not the named recipient (typo'd address M1, forwarded email M2)
  | "wrong-patient" // document is about another patient (M3)
  | "wrong-document-type" // e.g. rehab report uploaded for a lab request
  | "suspicious-address"; // pre-send warning: confusable characters, unknown contact

/** Identity as returned by the (mock) eID provider after login. */
export interface VerifiedIdentity {
  provider: string; // "mock-id-austria"
  /** Sector-specific person identifier (bPK) — simulated */
  subject: string;
  name: PersonName;
  birthDate: string;
  /** eIDAS level of assurance */
  levelOfAssurance: "low" | "substantial" | "high";
  authenticatedAt: string;
}

export interface RegisterResult {
  checked: boolean;
  listed: boolean;
  /** e.g. "Ärzteliste (simuliert)" */
  registerName: string;
  /** Registration number if listed */
  registrationNumber?: string;
  specialty?: string;
}

export type IdentityCheckOutcome =
  | { ok: true; identity: VerifiedIdentity; register: RegisterResult; policy: IdentityPolicyId }
  | { ok: false; reason: "name-mismatch" | "loa-too-low" | "expired" | "already-answered"; identity?: VerifiedIdentity };

export type IdentityPolicyId = "eid-high+register" | "eid-high";

// ---- Parsed documents (output of the deterministic parser or the LLM fallback) ----

export interface ParsedPatient {
  name: PersonName;
  birthDate: string; // YYYY-MM-DD
}

export interface ParsedLabValue {
  testName: string; // "INR (prothrombin time)"
  value: number;
  /** Unit exactly as written in the document, "" if none */
  unitText: string;
  referenceLow?: number;
  referenceHigh?: number;
  loinc: string; // "6301-6"
}

export interface ParsedLabResult {
  kind: "lab-result";
  title: string; // "Labor Kanalstraße: lab report"
  organization: string; // "Labor Kanalstraße"
  patient: ParsedPatient;
  requestedBy?: string;
  sampleTaken: string; // ISO 8601 with offset, Europe/Vienna
  reported: string; // ISO 8601 with offset
  values: ParsedLabValue[];
  conclusion?: string;
  validatedBy?: { name: PersonName; role?: string };
}

export interface ParsedRehabReport {
  kind: "rehab-discharge-report";
  title: string; // "Reha Waldblick: discharge report"
  organization: string; // "Reha Waldblick"
  patient: ParsedPatient;
  stay?: { start: string; end: string }; // YYYY-MM-DD
  reason?: string;
  writtenBy?: { name: PersonName; role?: string };
  sentBy?: { name: PersonName; role?: string };
  /** Full original Markdown, attached unchanged to the DocumentReference */
  markdown: string;
}

export type ParsedDocument = ParsedLabResult | ParsedRehabReport;

export interface ParseResult {
  ok: boolean;
  document?: ParsedDocument;
  /** "parser" = deterministic, "llm" = fallback (must be verified, see docs/DESIGN.md) */
  method: "parser" | "llm";
  /** Human-readable reasons why parsing failed or what was uncertain */
  problems: string[];
}

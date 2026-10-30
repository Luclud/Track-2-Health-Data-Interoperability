// HTTP API between the doctor UI (widget / standalone website) and the core service.
// Base URL: PUBLIC_BASE_URL (default http://localhost:3000). All JSON.
//
// Authentication of the doctor:
//   AUTH_MODE=matrix -> header "Authorization: Bearer <Matrix OpenID access token>" obtained by the widget
//                       through matrix-widget-api. Core verifies it at
//                       {SYNAPSE_URL}/_matrix/federation/v1/openid/userinfo?access_token=...
//   AUTH_MODE=dev    -> header "X-Dev-User: @lena.hofer:klinikum.example" (standalone website, tests)

import type {
  Channel,
  DocumentRequest,
  DocumentType,
  HeldReason,
  MisdeliveryKind,
  PatientSnapshot,
  RequestStatus,
} from "./domain.ts";
import type { AuditEntry } from "./audit.ts";

/** POST /api/requests */
export interface CreateRequestBody {
  patientId: string; // FHIR Patient id
  documentType: DocumentType;
  note?: string;
  roomId: string;
  recipient: {
    displayName: string; // "Dr. Eva Brandl"
    role: string;
    organization: string;
    isPhysician: boolean;
    channel: Channel;
    address: string;
  };
  /** Set true after the doctor saw the warnings from /api/recipient-check and still wants to send */
  acknowledgeWarnings?: boolean;
}

export interface CreateRequestResponse {
  request: DocumentRequestView;
  warnings: RecipientWarning[];
  /** The recipient's link. Set ONLY when JURY_MODE=true (live demo: shown as QR code); never otherwise. */
  juryLink?: string;
}

/** POST /api/recipient-check  body: { channel, address, displayName } — call before sending */
export interface RecipientCheckBody {
  channel: Channel;
  address: string;
  displayName: string;
}

export interface RecipientWarning {
  code: "confusable-characters" | "uppercase-in-address" | "unknown-contact" | "name-not-in-address" | "invalid-format";
  message: string; // German, shown to the doctor
}

export interface RecipientCheckResponse {
  warnings: RecipientWarning[];
}

/** GET /api/requests?roomId=...  -> DocumentRequestView[] (newest first) */
/** GET /api/requests/:id          -> RequestDetailResponse */
export interface DocumentRequestView {
  id: string;
  reference: string;
  createdAt: string;
  status: RequestStatus;
  documentType: DocumentType;
  patient: PatientSnapshot;
  recipient: DocumentRequest["recipient"];
  filedResources: string[];
  heldReason?: DocumentRequest["heldReason"];
  lastProblem?: MisdeliveryKind;
  /** When the reminder (with a new link) was sent, if any */
  reminderSentAt?: string;
}

export interface RequestDetailResponse {
  request: DocumentRequestView;
  /** Audit trail for this request, oldest first */
  audit: AuditEntry[];
  /** Short human summary of what was filed, for display (e.g. lab values table) */
  summary?: FiledSummary;
  /** Only while status is "held": what was read, with evidence lines in the received document */
  review?: HeldReview;
}

/** 1-based line in HeldReview.sourceText that contains the value */
export interface Evidence {
  line: number;
  text: string;
}

export interface HeldReview {
  method: "deterministic" | "llm";
  reason: HeldReason;
  patient: { given: string[]; family: string; birthDate?: string; evidence?: Evidence };
  /** lab result */
  values?: { testName: string; loinc?: string; value: number; unit: string; low?: number; high?: number; evidence: Evidence }[];
  /** rehab discharge report */
  excerpt?: string;
  /** The received document, as received */
  sourceText: string;
}

export type FiledSummary =
  | {
      kind: "lab-result";
      values: {
        testName: string;
        loinc?: string;
        value: number;
        unit: string;
        low?: number;
        high?: number;
        interpretation: "N" | "H" | "L";
        /** Set when the value crosses a critical (panic) limit, e.g. { rule: "< 50" } */
        critical?: { rule: string };
      }[];
      conclusion?: string;
    }
  | { kind: "rehab-discharge-report"; title: string; stay?: { start: string; end: string }; excerpt: string };

/** POST /api/requests/:id/release  and  POST /api/requests/:id/reject  (held answers, P2) */
export interface HeldDecisionResponse {
  request: DocumentRequestView;
}

/** GET /api/patients?q=Beispiel -> PatientSnapshot[] */
export type PatientSearchResponse = PatientSnapshot[];

/** GET /api/ui-config (no auth) -> feature switches for the doctor UI */
export interface UiConfigResponse {
  juryMode: boolean;
  llmEnabled: boolean;
}

/** GET /api/me -> who the core thinks the doctor is */
export interface MeResponse {
  matrixUserId: string;
  displayName: string;
  organization: string;
}

/** GET /api/chat/messages?roomId=... — only used by the standalone website (ChatNotifier "memory" mode) */
export interface ChatMessageView {
  id: string;
  roomId: string;
  sender: string;
  sentAt: string;
  /** Plain text fallback */
  body: string;
  /** Simple HTML (b, i, br, ul, li, table) */
  html?: string;
  severity: "info" | "success" | "warning" | "alert";
}

/** GET /api/dev/sms -> SmsView[] (simulated SMS inbox, newest first). Page: GET /dev/sms */
export interface SmsView {
  id: string;
  to: string;
  body: string;
  sentAt: string;
}

/** Error shape for every 4xx/5xx */
export interface ApiError {
  error: string; // machine code, e.g. "patient-not-found"
  message: string; // human readable
}

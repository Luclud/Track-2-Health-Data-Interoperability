// CONTRACT FILE — the seams between the work areas. Only the coordinator may change this file.
//
// Every external system sits behind one of these interfaces, so each product can be replaced
// (challenge rule: "commercial products allowed if each one could be replaced by another").
//
// Ownership (who implements what):
//   FhirStore, AuditLog, RequestRepository, DocumentParser, LlmClient, RequestService -> Account A, Dev Core
//   ChatNotifier (Matrix + in-memory)                                                -> Account B, Dev Matrix
//   MessageSender (email + SMS), IdentityProvider (mock eID), PhysicianRegister       -> Account B, Dev Outside

import type {
  AuditActor,
  AuditEntry,
  ChatMessageView,
  CreateRequestBody,
  DocumentRequest,
  IdentityCheckOutcome,
  ParseResult,
  PatientSnapshot,
  RecipientWarning,
  RegisterResult,
  Requester,
  RequestDetailResponse,
  VerifiedIdentity,
  DocumentType,
} from "@brieftaube/shared";
import type { Bundle, FhirResource } from "fhir/r4.js";

// ---------------------------------------------------------------- outside world

export interface OutboundMessage {
  channel: "email" | "sms";
  to: string;
  /** email only */
  subject?: string;
  text: string;
  /** email only, optional */
  html?: string;
}

/** Sends the notification with the link. MUST be given text that passes assertNotificationIsClean(). */
export interface MessageSender {
  send(message: OutboundMessage): Promise<{ providerMessageId: string }>;
}

/** Posts status messages into the doctor's Matrix room (or into the in-memory timeline in standalone mode). */
export interface ChatNotifier {
  post(message: Omit<ChatMessageView, "id" | "sentAt" | "sender">): Promise<void>;
  /** Only the in-memory implementation returns messages; MatrixNotifier returns []. */
  list(roomId: string): Promise<ChatMessageView[]>;
}

/** OIDC-like eID (mock ID Austria). Real ID Austria would be a drop-in implementation. */
export interface IdentityProvider {
  /** URL to redirect the browser to. `state` is opaque and comes back on the callback. */
  authorizationUrl(params: { state: string; redirectUri: string; loginHint?: string }): string;
  /** Exchange the code from the callback for the verified identity. */
  exchangeCode(code: string, redirectUri: string): Promise<VerifiedIdentity>;
}

export interface PhysicianRegister {
  lookup(identity: VerifiedIdentity): Promise<RegisterResult>;
}

// ---------------------------------------------------------------- storage

export interface FhirStore {
  /** POST a transaction bundle, returns the transaction-response bundle */
  transaction(bundle: Bundle): Promise<Bundle>;
  read<T extends FhirResource>(type: T["resourceType"], id: string): Promise<T | undefined>;
  search<T extends FhirResource>(type: T["resourceType"], params: Record<string, string>): Promise<T[]>;
  /** PUT (create or replace with a client-assigned id) */
  upsert<T extends FhirResource>(resource: T & { id: string }): Promise<T>;
  create<T extends FhirResource>(resource: T): Promise<T>;
}

export interface AuditLog {
  record(entry: Omit<AuditEntry, "id" | "at"> & { at?: string }): Promise<AuditEntry>;
  forRequest(requestId: string): Promise<AuditEntry[]>;
  all(): Promise<AuditEntry[]>;
}

export interface RequestRepository {
  insert(request: DocumentRequest, tokenHash: string): Promise<void>;
  update(request: DocumentRequest): Promise<void>;
  byId(id: string): Promise<DocumentRequest | undefined>;
  byTokenHash(tokenHash: string): Promise<DocumentRequest | undefined>;
  listByRoom(roomId: string): Promise<DocumentRequest[]>;
  /** All still-open requests (sent | opened | identity-failed | verified | rejected) across all rooms; for the scheduler. */
  listOpen(): Promise<DocumentRequest[]>;
  /** Replaces the stored token hash (link rotation on reminder). Throws if the request does not exist. */
  rotateTokenHash(id: string, tokenHash: string): Promise<void>;
  /** Addresses this requester has used before (for the "unknown contact" warning) */
  knownAddresses(requesterMatrixId: string): Promise<string[]>;
}

// ---------------------------------------------------------------- reading documents

export interface DocumentParser {
  /** Deterministic parser. Never throws; returns ok:false with problems instead. */
  parse(markdown: string): ParseResult;
}

/** Provider-agnostic LLM client (anthropic | perplexity | openai-compatible | mock | none). */
export interface LlmClient {
  readonly enabled: boolean;
  /** Returns parsed JSON that matches the given JSON schema, or throws. */
  completeJson(params: { system: string; user: string; jsonSchema: Record<string, unknown>; schemaName: string }): Promise<unknown>;
}

// ---------------------------------------------------------------- the application service

/** What the portal shows BEFORE the identity check. Must not contain patient or document type. */
export interface PublicRequestView {
  reference: string;
  requesterDisplayName: string;
  requesterOrganization: string;
  /** Name of the person the request is for, so a wrong recipient notices. Allowed: it is not patient data. */
  recipientDisplayName: string;
  expiresAt: string;
  status: "open" | "answered" | "expired" | "cancelled";
}

/** What the portal shows AFTER a successful identity check. */
export interface AuthorizedRequestView extends PublicRequestView {
  patient: Pick<PatientSnapshot, "name" | "birthDate">;
  documentType: DocumentType;
  freeText?: boolean;
  note?: string;
}

export interface AnswerInput {
  /** Form fields the responder typed (challenge: the form MUST ask for patient name and birth date) */
  patientGiven: string;
  patientFamily: string;
  patientBirthDate: string; // YYYY-MM-DD
  /** Markdown text: uploaded file content or pasted text */
  content: string;
  fileName?: string;
  /** ASSIST-4: the sender used the KI-Hilfe and confirmed the suggested document. */
  senderAssist?: boolean;
}

export type AnswerOutcome =
  | { result: "filed"; filedResources: string[] }
  | { result: "held"; reason: NonNullable<DocumentRequest["heldReason"]> }
  | { result: "rejected"; reason: "wrong-patient" | "wrong-document-type" | "unreadable"; messageForResponder: string };

export interface RequestMeta {
  /** sha256 of the client IP — never store the raw IP */
  ipHash?: string;
  userAgent?: string;
}

export interface RequestService {
  checkRecipient(requester: Requester, body: { channel: "email" | "sms"; address: string; displayName: string }): Promise<RecipientWarning[]>;
  /** `link` is the recipient's link; the API returns it to the UI only in JURY_MODE. */
  createRequest(requester: Requester, body: CreateRequestBody): Promise<{ request: DocumentRequest; warnings: RecipientWarning[]; link?: string }>;
  listForRoom(roomId: string): Promise<DocumentRequest[]>;
  detail(id: string): Promise<RequestDetailResponse | undefined>;

  /** Portal step 1: link opened. Audits "link-opened". Returns undefined for unknown tokens. */
  openLink(token: string, meta: RequestMeta): Promise<{ requestId: string; view: PublicRequestView } | undefined>;
  /** Portal step 2: identity came back from the eID. Audits "identity-checked" and, on mismatch, "misdelivery-caught". */
  completeIdentityCheck(token: string, identity: VerifiedIdentity, meta: RequestMeta): Promise<IdentityCheckOutcome & { view?: AuthorizedRequestView }>;
  /** Portal step 3: answer submitted by a verified identity. Audits "answer-sent" then "answer-filed" or "misdelivery-caught". */
  submitAnswer(token: string, identity: VerifiedIdentity, answer: AnswerInput, meta: RequestMeta): Promise<AnswerOutcome>;

  /** P2: doctor decides on a held answer */
  release(requestId: string, by: Requester): Promise<DocumentRequest>;
  reject(requestId: string, by: Requester): Promise<DocumentRequest>;
}

export type { AuditActor };

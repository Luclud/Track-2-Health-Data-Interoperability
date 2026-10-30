// RequestService core (CORE-3): create request, open link, list, detail. Identity (CORE-4), answers (CORE-5)
// and held decisions (CORE-11) are added in their own modules.
import { randomUUID } from "node:crypto";
import type { CreateRequestBody, DocumentRequest, IdentityCheckOutcome, PatientSnapshot, RecipientWarning, Requester, RequestDetailResponse, VerifiedIdentity } from "@brieftaube/shared";
import type { Patient } from "fhir/r4.js";
import { buildRequestedTask, taskId } from "../fhir/build-task.ts";
import { assertNotificationIsClean, findPrivacyLeaks } from "../notify/privacy.ts";
import { parsePersonName } from "../parser/names.ts";
import type { AnswerInput, AnswerOutcome, AuthorizedRequestView, ChatNotifier, OutboundMessage, RequestMeta, RequestService } from "../ports.ts";
import { buildLabBundle } from "../fhir/build-lab.ts";
import { buildRehabBundle } from "../fhir/build-rehab.ts";
import { buildProblemTask } from "../fhir/build-task.ts";
import { createdReferences } from "../fhir/store.ts";
import type { FilingContext } from "../fhir/types.ts";
import type { ParsedDocument } from "@brieftaube/shared";
import { HELD_REASON_DE, RESPONDER_MESSAGES, chatFiled, chatHeld, chatUnreadable, chatWrongPatient, chatWrongType, checkPatient } from "./answers.ts";
import { registerApplies } from "./identity.ts";
import type { RequestServiceDeps } from "./index.ts";
import { DomainError } from "./errors.ts";
import { chatRequestSent, linkFor, notificationFor, requesterActor } from "./messages.ts";
import { newReference, newToken, sha256 } from "./tokens.ts";
import { toAuthorizedView, toPublicView, toView } from "./views.ts";
import { chatIdentityMismatch, decideIdentity, identityDisplay, lookupRegister, policyFor } from "./identity.ts";

export function patientSnapshot(p: Patient): PatientSnapshot {
  const n = p.name?.find((x) => x.use === "official") ?? p.name?.[0];
  if (!p.id || !n?.family || !p.birthDate) throw new DomainError("patient-incomplete", `Patient ${p.id ?? "?"} has no name or birth date`, 422);
  const snap: PatientSnapshot = { fhirId: p.id, name: { given: n.given ?? [], family: n.family }, birthDate: p.birthDate };
  if (n.prefix?.length) snap.name.prefix = n.prefix;
  if (p.gender) snap.gender = p.gender;
  return snap;
}

export class CoreRequestService implements Partial<RequestService> {
  constructor(protected readonly d: RequestServiceDeps) {}

  protected now(): Date {
    return this.d.now?.() ?? new Date();
  }

  async checkRecipient(_requester: Requester, _body: { channel: "email" | "sms"; address: string; displayName: string }): Promise<RecipientWarning[]> {
    return [];
  }

  async createRequest(requester: Requester, body: CreateRequestBody) {
    const patient = await this.d.fhir.read<Patient>("Patient", body.patientId);
    if (!patient) throw new DomainError("patient-not-found", `Patient ${body.patientId} not found`, 404);
    const warnings = await this.checkRecipient(requester, body.recipient);

    const now = this.now();
    const reference = newReference();
    const recipientName = parsePersonName(body.recipient.displayName);
    const request: DocumentRequest = {
      id: randomUUID(),
      reference,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.d.config.requestTtlHours * 3600_000).toISOString(),
      status: "sent",
      requester,
      roomId: body.roomId,
      patient: patientSnapshot(patient),
      documentType: body.documentType,
      recipient: { ...body.recipient, address: body.recipient.address.trim(), name: recipientName },
      filedResources: [],
      fhirTaskId: taskId(reference),
    };
    if (body.note?.trim()) request.note = body.note.trim();

    // A random token can, very rarely, contain a "forbidden" word or the birth year; draw a new one then.
    let token = "";
    let message: OutboundMessage | undefined;
    const ctx = { patient: request.patient, documentType: request.documentType, recipientAddress: request.recipient.address };
    for (let i = 0; i < 8; i++) {
      token = newToken();
      message = notificationFor(request, linkFor(this.d.config.publicBaseUrl, token));
      const leaks = [message.subject ?? "", message.text].flatMap((t) => findPrivacyLeaks(t.split(token).join(" "), ctx));
      if (leaks.length) break; // a real leak in the template: let the assert below report it
      if (![message.subject ?? "", message.text].some((t) => findPrivacyLeaks(t, ctx).length)) break;
    }
    for (const t of [message!.subject ?? "", message!.text]) assertNotificationIsClean(t, ctx);

    await this.d.fhir.upsert(buildRequestedTask(request));
    await this.d.repo.insert(request, sha256(token));
    const sender = request.recipient.channel === "email" ? this.d.email : this.d.sms;
    const sent = await sender.send(message!);

    await this.d.audit.record({
      requestId: request.id,
      requestReference: reference,
      step: "request-sent",
      at: now.toISOString(),
      actor: requesterActor(requester),
      what: `Request ${reference} for a ${request.documentType === "lab-result" ? "lab result" : "rehab discharge report"} sent by ${request.recipient.channel} to ${request.recipient.address}`,
      outcome: "success",
      details: { channel: request.recipient.channel, providerMessageId: sent.providerMessageId, warnings: warnings.length },
    });
    await this.post({ roomId: request.roomId, body: chatRequestSent(request), severity: "info" });
    return { request, warnings };
  }

  async listForRoom(roomId: string): Promise<DocumentRequest[]> {
    const list = await this.d.repo.listByRoom(roomId);
    return Promise.all(list.map((r) => this.expireIfDue(r)));
  }

  async detail(id: string): Promise<RequestDetailResponse | undefined> {
    const r = await this.d.repo.byId(id);
    if (!r) return undefined;
    const req = await this.expireIfDue(r);
    return { request: toView(req), audit: await this.d.audit.forRequest(id) };
  }

  async openLink(token: string, meta: RequestMeta) {
    const found = await this.byToken(token);
    if (!found) return undefined;
    const r = await this.expireIfDue(found);
    if (r.status === "sent") {
      r.status = "opened";
      await this.d.repo.update(r);
    }
    await this.d.audit.record({
      requestId: r.id,
      requestReference: r.reference,
      step: "link-opened",
      at: this.now().toISOString(),
      actor: { kind: "unverified-visitor", id: "anonymous", display: "Unverified visitor" },
      what: `Link of ${r.reference} opened`,
      outcome: "success",
      details: { ...(meta.ipHash ? { ipHash: meta.ipHash } : {}), ...(meta.userAgent ? { userAgent: meta.userAgent } : {}), status: r.status },
    });
    return { requestId: r.id, view: toPublicView(r) };
  }

  async completeIdentityCheck(token: string, identity: VerifiedIdentity, meta: RequestMeta): Promise<IdentityCheckOutcome & { view?: AuthorizedRequestView }> {
    const found = await this.byToken(token);
    if (!found) throw new DomainError("request-not-found", "Unknown or invalid link", 404);
    const r = await this.expireIfDue(found);
    if (r.status === "expired" || r.status === "cancelled") return { ok: false, reason: "expired", identity };
    if (r.status === "filed" || r.status === "held") return { ok: false, reason: "already-answered", identity };

    const at = this.now().toISOString();
    const actor = { kind: "outside-person" as const, id: identity.subject, display: identityDisplay(identity) };
    const base = { requestId: r.id, requestReference: r.reference, at };
    const metaDetails = { ...(meta.ipHash ? { ipHash: meta.ipHash } : {}), ...(meta.userAgent ? { userAgent: meta.userAgent } : {}) };
    const decision = decideIdentity(r, identity);

    if (!decision.ok) {
      const who = identityDisplay(identity);
      await this.d.audit.record({
        ...base,
        step: "identity-checked",
        actor: decision.reason === "name-mismatch" ? { ...actor, display: `${who} (not the recipient)` } : actor,
        what: decision.reason === "name-mismatch" ? `${who} is not ${r.recipient.displayName}` : `Level of assurance ${identity.levelOfAssurance} is too low (high required)`,
        outcome: "failure",
        details: { reason: decision.reason, provider: identity.provider, levelOfAssurance: identity.levelOfAssurance, ...metaDetails },
      });
      if (decision.reason === "name-mismatch") {
        if (r.status !== "verified" && r.status !== "rejected") r.status = "identity-failed";
        r.lastProblem = "identity-mismatch";
        await this.d.repo.update(r);
        await this.d.audit.record({
          ...base,
          step: "misdelivery-caught",
          actor: { ...actor, display: `${who} (not the recipient)` },
          what: `Identity mismatch: verified person '${who}' is not the named recipient '${r.recipient.displayName}'. Nothing was shown.`,
          outcome: "failure",
          details: { misdelivery: "identity-mismatch", ...metaDetails },
        });
        await this.post({ roomId: r.roomId, body: chatIdentityMismatch(r, identity), severity: "warning" });
      }
      return { ok: false, reason: decision.reason, identity };
    }

    const register = await lookupRegister(r, identity, this.d.register);
    const registerText = !register.checked ? "register: not applicable" : register.listed ? `register: listed (${register.registrationNumber ?? "?"})` : "register: not listed";
    r.status = "verified";
    await this.d.repo.update(r);
    await this.d.audit.record({
      ...base,
      step: "identity-checked",
      actor,
      what: `Identity of ${actor.display} confirmed via ID Austria (simulated), LoA ${identity.levelOfAssurance}; ${registerText}`,
      outcome: register.checked && !register.listed ? "warning" : "success",
      details: { policy: decision.policy, provider: identity.provider, register, ...metaDetails },
    });
    return { ok: true, identity, register, policy: decision.policy, view: toAuthorizedView(r) };
  }

  async submitAnswer(token: string, identity: VerifiedIdentity, answer: AnswerInput, meta: RequestMeta): Promise<AnswerOutcome> {
    const found = await this.byToken(token);
    if (!found) throw new DomainError("request-not-found", "Unknown or invalid link", 404);
    const r = await this.expireIfDue(found);
    if (r.status === "expired" || r.status === "cancelled") throw new DomainError("expired", "Die Anfrage ist abgelaufen.", 410);
    if (r.status === "filed" || r.status === "held") throw new DomainError("already-answered", "Die Anfrage wurde bereits beantwortet.", 409);
    if (!decideIdentity(r, identity).ok) throw new DomainError("identity-required", "Identität nicht bestätigt.", 403);

    const at = this.now().toISOString();
    const actor = { kind: "outside-person" as const, id: identity.subject, display: identityDisplay(identity) };
    const content = answer.content ?? "";
    const fileName = answer.fileName?.trim() || "antwort.md";
    const hash = sha256(content);
    const base = { requestId: r.id, requestReference: r.reference, at, actor };
    await this.d.audit.record({
      ...base,
      step: "answer-sent",
      what: `Answer received: ${fileName}, ${Buffer.byteLength(content, "utf8")} bytes, sha256 ${hash}`,
      outcome: "success",
      details: { fileName, size: Buffer.byteLength(content, "utf8"), sha256: hash, ...(meta.ipHash ? { ipHash: meta.ipHash } : {}) },
    });

    const parsed = this.d.parser.parse(content);
    const doc = parsed.ok ? parsed.document : undefined;
    if (!doc) return this.rejectAnswer(r, base, "unreadable", RESPONDER_MESSAGES.unreadable, chatUnreadable(r), `Document could not be read: ${parsed.problems.join("; ")}`, hash);
    if (doc.kind !== r.documentType)
      return this.rejectAnswer(r, base, "wrong-document-type", RESPONDER_MESSAGES["wrong-document-type"](r), chatWrongType(r, doc.kind), `Wrong document type: got ${doc.kind}, requested ${r.documentType}`, hash);
    const pc = checkPatient(r, answer, doc);
    if (!pc.ok) {
      const other = `${[...pc.name.given, pc.name.family].join(" ")} (${pc.birthDate})`;
      const req = `${[...r.patient.name.given, r.patient.name.family].join(" ")} (${r.patient.birthDate})`;
      return this.rejectAnswer(r, base, "wrong-patient", RESPONDER_MESSAGES["wrong-patient"], chatWrongPatient(r, pc), `Wrong patient: ${pc.source} is about ${other}, request is about ${req}`, hash);
    }

    const register = await lookupRegister(r, identity, this.d.register);
    const ctx: FilingContext = {
      request: r,
      identity,
      register,
      policy: policyFor(r),
      answer: { fileName, content, sha256: hash },
      identityCheckedAt: identity.authenticatedAt,
      answerSentAt: at,
      filedAt: at,
    };
    if (registerApplies(r) && !register.listed) {
      r.status = "held";
      r.heldReason = "not-in-register";
      await this.d.repo.update(r);
      await this.post({ roomId: r.roomId, body: chatHeld(r, HELD_REASON_DE["not-in-register"]), severity: "warning" });
      return { result: "held", reason: "not-in-register" };
    }
    const filedResources = await this.file(r, doc, ctx);
    return { result: "filed", filedResources };
  }

  /** Build the transaction, send it, mark the request filed, audit + Matrix ✅. */
  protected async file(r: DocumentRequest, doc: ParsedDocument, ctx: FilingContext): Promise<string[]> {
    const bundle = doc.kind === "lab-result" ? buildLabBundle(doc, ctx) : buildRehabBundle(doc, ctx);
    let response;
    try {
      response = await this.d.fhir.transaction(bundle);
    } catch (err) {
      throw new DomainError("fhir-unavailable", `Filing failed: ${(err as Error).message}`, 502);
    }
    const refs = createdReferences(bundle, response);
    const filed = Object.values(refs).filter((x) => !/^(Practitioner|Organization|Task)\//.test(x));
    r.status = "filed";
    r.filedResources = filed;
    delete r.heldReason;
    delete r.lastProblem;
    await this.d.repo.update(r);
    const count = (t: string) => filed.filter((x) => x.startsWith(`${t}/`));
    const main = count(doc.kind === "lab-result" ? "DiagnosticReport" : "DocumentReference")[0];
    const obs = count("Observation").length;
    await this.d.audit.record({
      requestId: r.id,
      requestReference: r.reference,
      at: ctx.filedAt,
      step: "answer-filed",
      actor: { kind: "system", id: "brieftaube", display: "Brieftaube" },
      what: `Filed ${main}${obs ? `, ${obs} Observations` : ""}, ${count("Provenance")[0]} for Patient/${r.patient.fhirId}`,
      outcome: "success",
      details: { filedResources: filed, policy: ctx.policy },
    });
    await this.post({ roomId: r.roomId, body: chatFiled(r, doc, ctx.register), severity: "success" });
    return filed;
  }

  protected async rejectAnswer(
    r: DocumentRequest,
    base: { requestId: string; requestReference: string; at: string; actor: { kind: "outside-person"; id: string; display: string } },
    reason: "wrong-patient" | "wrong-document-type" | "unreadable",
    messageForResponder: string,
    chat: string,
    what: string,
    hash: string,
  ): Promise<AnswerOutcome> {
    r.status = "rejected";
    if (reason !== "unreadable") r.lastProblem = reason;
    await this.d.repo.update(r);
    await this.d.audit.record({ ...base, step: "misdelivery-caught", what, outcome: "failure", details: { misdelivery: reason, sha256: hash } });
    if (reason !== "unreadable") {
      try {
        await this.d.fhir.upsert(buildProblemTask(r, reason, base.at));
      } catch {
        // best effort: the audit entry above is the record
      }
    }
    await this.post({ roomId: r.roomId, body: chat, severity: "alert" });
    return { result: "rejected", reason, messageForResponder };
  }

  protected async byToken(token: string): Promise<DocumentRequest | undefined> {
    if (!token) return undefined;
    return this.d.repo.byTokenHash(sha256(token));
  }

  /** Open requests past expiresAt become "expired" (lazily, on access). */
  protected async expireIfDue(r: DocumentRequest): Promise<DocumentRequest> {
    const open = !["filed", "expired", "cancelled"].includes(r.status);
    if (open && Date.parse(r.expiresAt) <= this.now().getTime()) {
      r.status = "expired";
      await this.d.repo.update(r);
    }
    return r;
  }

  /** A Matrix outage must never block sending requests or filing answers. */
  protected async post(msg: Parameters<ChatNotifier["post"]>[0]): Promise<void> {
    try {
      await this.d.chat.post(msg);
    } catch (err) {
      (this.d.log ?? console.warn)(`chat: posting to ${msg.roomId} failed: ${(err as Error).message}`);
    }
  }
}

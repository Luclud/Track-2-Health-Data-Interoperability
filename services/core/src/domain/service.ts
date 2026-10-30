// RequestService core (CORE-3): create request, open link, list, detail. Identity (CORE-4), answers (CORE-5)
// and held decisions (CORE-11) are added in their own modules.
import { randomUUID } from "node:crypto";
import type { CreateRequestBody, DocumentRequest, IdentityCheckOutcome, PatientSnapshot, RecipientWarning, Requester, RequestDetailResponse, VerifiedIdentity } from "@brieftaube/shared";
import type { Organization, Patient, Practitioner, PractitionerRole } from "fhir/r4.js";
import { checkRecipientAddress } from "./recipient.ts";
import { llmParse } from "../llm/index.ts";
import { rehabSummary } from "../llm/summary.ts";
import { addMedicationStatements } from "../fhir/build-medications.ts";
import { type HeldAnswerStore, isHeldAnswerStore, MemoryHeldAnswerStore } from "../db/index.ts";
import { buildRequestedTask, taskId } from "../fhir/build-task.ts";
import { assertNotificationIsClean, findPrivacyLeaks } from "../notify/privacy.ts";
import { parsePersonName } from "../parser/names.ts";
import type { AnswerInput, AnswerOutcome, AuthorizedRequestView, ChatNotifier, OutboundMessage, RequestMeta, RequestService } from "../ports.ts";
import { buildLabBundle } from "../fhir/build-lab.ts";
import { buildRehabBundle } from "../fhir/build-rehab.ts";
import { buildProblemTask } from "../fhir/build-task.ts";
import { createdReferences } from "../fhir/store.ts";
import type { FilingContext } from "../fhir/types.ts";
import type { ParsedDocument, ParseResult } from "@brieftaube/shared";
import { type CriticalLimits, criticalForParsed, loadCriticalLimits } from "./critical.ts";
import { HELD_REASON_DE, RESPONDER_MESSAGES, type LabRow, chatCritical, CHAT_SENDER_ASSIST, chatFiled, chatFiledHtml, chatHeld, chatHeldRejected, chatUnreadable, chatWrongPatient, chatWrongType, checkPatient } from "./answers.ts";
import { registerApplies } from "./identity.ts";
import type { RequestServiceDeps } from "./index.ts";
import { DomainError } from "./errors.ts";
import { chatRequestSent, linkFor, notificationFor, requesterActor } from "./messages.ts";
import { newReference, newToken, sha256 } from "./tokens.ts";
import { toAuthorizedView, toPublicView, toView } from "./views.ts";
import { filedSummary } from "./summary.ts";
import { heldReview } from "./review.ts";
import { chatIdentityMismatch, decideIdentity, identityDisplay, lookupRegister, policyFor } from "./identity.ts";

export function patientSnapshot(p: Patient): PatientSnapshot {
  const n = p.name?.find((x) => x.use === "official") ?? p.name?.[0];
  if (!p.id || !n?.family || !p.birthDate) throw new DomainError("patient-incomplete", `Patient ${p.id ?? "?"} has no name or birth date`, 422);
  const snap: PatientSnapshot = { fhirId: p.id, name: { given: n.given ?? [], family: n.family }, birthDate: p.birthDate };
  if (n.prefix?.length) snap.name.prefix = n.prefix;
  if (p.gender) snap.gender = p.gender;
  return snap;
}

const withCritical = <T>(c: T | undefined) => (c ? { critical: c } : {});

export class CoreRequestService implements Partial<RequestService> {
  protected readonly held: HeldAnswerStore;

  constructor(protected readonly d: RequestServiceDeps) {
    this.held = d.held ?? (isHeldAnswerStore(d.repo) ? d.repo : new MemoryHeldAnswerStore());
  }

  private limits?: CriticalLimits;
  protected criticalLimits(): CriticalLimits {
    return (this.limits ??= loadCriticalLimits(this.d.config.criticalValuesFile, this.d.log));
  }

  protected now(): Date {
    return this.d.now?.() ?? new Date();
  }

  async checkRecipient(requester: Requester, body: { channel: "email" | "sms"; address: string; displayName: string }): Promise<RecipientWarning[]> {
    const known = [...(await this.d.repo.knownAddresses(requester.matrixUserId)), ...(await this.directoryAddresses())];
    return checkRecipientAddress(body, known);
  }

  /** telecom values of Practitioners/Organizations/PractitionerRoles on the FHIR server (best effort). */
  protected async directoryAddresses(): Promise<string[]> {
    const out: string[] = [];
    for (const type of ["Practitioner", "PractitionerRole", "Organization"] as const) {
      try {
        const list = await this.d.fhir.search<Practitioner | PractitionerRole | Organization>(type, { _count: "200" });
        for (const r of list) for (const t of r.telecom ?? []) if (t.value) out.push(t.value);
      } catch {
        // directory unavailable: only previously used addresses count as known
      }
    }
    return out;
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
    return { request, warnings, link: linkFor(this.d.config.publicBaseUrl, token) };
  }

  async listForRoom(roomId: string): Promise<DocumentRequest[]> {
    const list = await this.d.repo.listByRoom(roomId);
    return Promise.all(list.map((r) => this.expireIfDue(r)));
  }

  async detail(id: string): Promise<RequestDetailResponse | undefined> {
    const r = await this.d.repo.byId(id);
    if (!r) return undefined;
    const req = await this.expireIfDue(r);
    const out: RequestDetailResponse = { request: toView(req), audit: await this.d.audit.forRequest(id) };
    try {
      const summary = await filedSummary(this.d.fhir, req, this.criticalLimits());
      if (summary) out.summary = summary;
    } catch {
      // Summary is display-only; an unreachable FHIR server must not break the detail view.
    }
    if (req.status === "held" && req.heldReason) {
      const held = await this.held.heldAnswer(req.id);
      if (held) out.review = heldReview(held.document, held.context.answer.content, req.heldReason, held.method ?? (req.heldReason === "ai-extracted" ? "llm" : "deterministic"));
    }
    return out;
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

    const parsed = await this.read(content);
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
      ...(answer.senderAssist ? { senderAssist: true } : {}),
      identity,
      register,
      policy: policyFor(r),
      answer: { fileName, content, sha256: hash },
      identityCheckedAt: identity.authenticatedAt,
      answerSentAt: at,
      filedAt: at,
    };
    if (parsed.method === "llm") return this.hold(r, "ai-extracted", doc, ctx, "llm");
    if (registerApplies(r) && !register.listed) return this.hold(r, "not-in-register", doc, ctx, "deterministic");
    const filedResources = await this.file(r, doc, ctx);
    return { result: "filed", filedResources };
  }

  /** Deterministic parser first; verified LLM fallback only if it fails and an LLM is configured (DESIGN §3). */
  protected async read(content: string): Promise<ParseResult> {
    const parsed = this.d.parser.parse(content);
    if (parsed.ok || !this.d.llm.enabled) return parsed;
    const ai = await llmParse(this.d.llm, content);
    return ai.ok ? ai : { ok: false, method: "llm", problems: [...parsed.problems, ...ai.problems] };
  }

  /** Not filed automatically; Dr. Hofer decides in the widget (CORE-11). */
  protected async hold(r: DocumentRequest, reason: "ai-extracted" | "not-in-register", doc: ParsedDocument, ctx: FilingContext, method: "deterministic" | "llm"): Promise<AnswerOutcome> {
    const { request: _r, newUuid: _u, ...context } = ctx;
    await this.held.saveHeld(r.id, { document: doc, context, method });
    r.status = "held";
    r.heldReason = reason;
    await this.d.repo.update(r);
    await this.post({ roomId: r.roomId, body: chatHeld(r, HELD_REASON_DE[reason]), severity: "warning" });
    return { result: "held", reason };
  }

  async release(requestId: string, by: Requester): Promise<DocumentRequest> {
    const { r, held } = await this.heldFor(requestId);
    const at = this.now().toISOString();
    await this.file(r, held.document, { ...held.context, request: r, filedAt: at, releasedBy: by.displayName }, by);
    await this.held.deleteHeld(r.id);
    return r;
  }

  async reject(requestId: string, by: Requester): Promise<DocumentRequest> {
    const { r } = await this.heldFor(requestId);
    const reason = r.heldReason;
    r.status = "rejected";
    delete r.heldReason;
    await this.d.repo.update(r);
    await this.held.deleteHeld(r.id);
    await this.d.audit.record({
      requestId: r.id,
      requestReference: r.reference,
      at: this.now().toISOString(),
      step: "answer-filed",
      actor: { kind: "internal-practitioner", id: by.matrixUserId, display: by.displayName },
      what: `Held answer rejected by ${by.displayName} – nothing filed`,
      outcome: "failure",
      details: { decision: "rejected", heldReason: reason },
    });
    await this.post({ roomId: r.roomId, body: chatHeldRejected(r, by), severity: "warning" });
    return r;
  }

  protected async heldFor(requestId: string) {
    const r = await this.d.repo.byId(requestId);
    if (!r) throw new DomainError("request-not-found", "Anfrage nicht gefunden.", 404);
    if (r.status !== "held") throw new DomainError("not-held", "Diese Anfrage wartet nicht auf eine Freigabe.", 409);
    const held = await this.held.heldAnswer(r.id);
    if (!held) throw new DomainError("held-answer-missing", "Die zurückgehaltene Antwort ist nicht mehr vorhanden.", 409);
    return { r, held };
  }

  /** Build the transaction, send it, mark the request filed, audit + Matrix ✅. */
  protected async file(r: DocumentRequest, doc: ParsedDocument, ctx: FilingContext, releasedBy?: Requester): Promise<string[]> {
    const bundle = doc.kind === "lab-result" ? buildLabBundle(doc, ctx) : buildRehabBundle(doc, ctx);
    if (doc.kind === "rehab-discharge-report") addMedicationStatements(bundle, doc, ctx);
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
    const heldReason = r.heldReason;
    delete r.heldReason;
    delete r.lastProblem;
    await this.d.repo.update(r);
    const rows: LabRow[] = doc.kind === "lab-result" ? doc.values.map((value) => ({ value, ...withCritical(criticalForParsed(this.criticalLimits(), value)) })) : [];
    const critical = rows.filter((x) => x.critical).map(({ value: v, critical: c }) => ({ loinc: v.loinc, testName: v.testName, value: v.value, unit: v.unitText, rule: c!.rule }));
    const count = (t: string) => filed.filter((x) => x.startsWith(`${t}/`));
    const main = count(doc.kind === "lab-result" ? "DiagnosticReport" : "DocumentReference")[0];
    const obs = count("Observation").length;
    await this.d.audit.record({
      requestId: r.id,
      requestReference: r.reference,
      at: ctx.filedAt,
      step: "answer-filed",
      actor: releasedBy
        ? { kind: "internal-practitioner", id: releasedBy.matrixUserId, display: releasedBy.displayName }
        : { kind: "system", id: "brieftaube", display: "Brieftaube" },
      what: `${releasedBy ? `Released by ${releasedBy.displayName}: filed` : "Filed"} ${main}${obs ? `, ${obs} Observations` : ""}, ${count("Provenance")[0]} for Patient/${r.patient.fhirId}`,
      outcome: "success",
      details: { filedResources: filed, policy: ctx.policy, ...(releasedBy ? { decision: "released", heldReason } : {}), ...(critical.length ? { criticalValues: critical } : {}), ...(ctx.senderAssist ? { senderAssist: true } : {}) },
    });
    const summary = doc.kind === "rehab-discharge-report" ? await rehabSummary(this.d.llm, doc.markdown) : undefined;
    const assisted = ctx.senderAssist ? `\n${CHAT_SENDER_ASSIST}` : "";
    const body = chatFiled(r, doc, ctx.register) + (summary ? `\nKI-Zusammenfassung (bitte im Original prüfen): ${summary}` : "") + assisted;
    if (critical.length) await this.post({ roomId: r.roomId, ...chatCritical(r, rows), severity: "alert" });
    await this.post({ roomId: r.roomId, body, ...(doc.kind === "lab-result" ? { html: chatFiledHtml(r, rows, ctx.register) + (assisted ? `<p>${CHAT_SENDER_ASSIST}</p>` : "") } : {}), severity: "success" });
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
    if (reason === "unreadable") {
      await this.d.audit.record({ ...base, step: "answer-filed", what, outcome: "failure", details: { problem: "unreadable", sha256: hash } });
    } else {
      await this.d.audit.record({ ...base, step: "misdelivery-caught", what, outcome: "failure", details: { misdelivery: reason, sha256: hash } });
    }
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
    // a held answer waits for the doctor's decision and never expires
    const open = !["filed", "held", "expired", "cancelled"].includes(r.status);
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

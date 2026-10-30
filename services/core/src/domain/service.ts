// RequestService core (CORE-3): create request, open link, list, detail. Identity (CORE-4), answers (CORE-5)
// and held decisions (CORE-11) are added in their own modules.
import { randomUUID } from "node:crypto";
import type { CreateRequestBody, DocumentRequest, PatientSnapshot, RecipientWarning, Requester, RequestDetailResponse } from "@brieftaube/shared";
import type { Patient } from "fhir/r4.js";
import { buildRequestedTask, taskId } from "../fhir/build-task.ts";
import { assertNotificationIsClean, findPrivacyLeaks } from "../notify/privacy.ts";
import { parsePersonName } from "../parser/names.ts";
import type { OutboundMessage, RequestMeta, RequestService } from "../ports.ts";
import type { RequestServiceDeps } from "./index.ts";
import { DomainError } from "./errors.ts";
import { chatRequestSent, linkFor, notificationFor, requesterActor } from "./messages.ts";
import { newReference, newToken, sha256 } from "./tokens.ts";
import { toPublicView, toView } from "./views.ts";

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
    await this.d.chat.post({ roomId: request.roomId, body: chatRequestSent(request), severity: "info" });
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
}

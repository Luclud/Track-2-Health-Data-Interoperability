import type { DocumentRequest, DocumentRequestView } from "@brieftaube/shared";
import type { AuthorizedRequestView, PublicRequestView } from "../ports.ts";

export function toView(r: DocumentRequest): DocumentRequestView {
  const v: DocumentRequestView = {
    id: r.id,
    reference: r.reference,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    status: r.status,
    documentType: r.documentType,
    patient: r.patient,
    recipient: r.recipient,
    filedResources: r.filedResources,
  };
  if (r.freeText) v.freeText = true;
  if (r.note) v.note = r.note;
  if (r.heldReason) v.heldReason = r.heldReason;
  if (r.lastProblem) v.lastProblem = r.lastProblem;
  if (r.reminderSentAt) v.reminderSentAt = r.reminderSentAt;
  return v;
}

export function publicStatus(r: DocumentRequest): PublicRequestView["status"] {
  if (r.status === "expired") return "expired";
  if (r.status === "cancelled") return "cancelled";
  if (r.status === "filed" || r.status === "held") return "answered";
  return "open";
}

/** Before the identity check: no patient data, no document type. */
export function toPublicView(r: DocumentRequest): PublicRequestView {
  return {
    reference: r.reference,
    requesterDisplayName: r.requester.displayName,
    requesterOrganization: r.requester.organization,
    recipientDisplayName: r.recipient.displayName,
    expiresAt: r.expiresAt,
    status: publicStatus(r),
  };
}

export function toAuthorizedView(r: DocumentRequest): AuthorizedRequestView {
  const v: AuthorizedRequestView = {
    ...toPublicView(r),
    patient: { name: r.patient.name, birthDate: r.patient.birthDate },
    documentType: r.documentType,
  };
  if (r.note) v.note = r.note;
  if (r.freeText) v.freeText = true;
  return v;
}

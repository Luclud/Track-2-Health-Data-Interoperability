// Rehab discharge report → transaction Bundle (fhir-examples/rehab-report-transaction.json).
import type { ParsedRehabReport } from "@brieftaube/shared";
import { DOCUMENT_TYPE_LABELS_DE, SYSTEMS } from "@brieftaube/shared";
import type { Bundle, BundleEntry, DocumentReference } from "fhir/r4.js";
import { buildCompletedTask } from "./build-task.ts";
import { buildProvenance } from "./build-provenance.ts";
import { documentAuthorEntry, identitySentence, organizationEntry, senderEntry } from "./build-common.ts";
import { documentLanguage } from "./build-lab.ts";
import type { FilingContext } from "./types.ts";
import { base64, displayName, uuidUrn, viennaInstant, viennaMinute } from "./util.ts";

export function buildRehabBundle(doc: ParsedRehabReport, ctx: FilingContext): Bundle {
  const { request: r } = ctx;
  const urn = () => uuidUrn(ctx.newUuid);
  const entries: BundleEntry[] = [];
  let authorUrn: string | undefined;
  if (doc.writtenBy) {
    authorUrn = urn();
    entries.push(documentAuthorEntry(authorUrn, doc.organization, doc.writtenBy));
  }
  const senderUrn = urn();
  entries.push(senderEntry(senderUrn, ctx));
  const orgUrn = urn();
  entries.push(organizationEntry(orgUrn, doc.organization));

  const docUrn = urn();
  const reason = doc.reason?.split(",")[0]?.trim();
  const ref: DocumentReference = {
    resourceType: "DocumentReference",
    identifier: [{ system: SYSTEMS.requestReference, value: r.reference }],
    status: "current",
    docStatus: "final",
    type: { coding: [{ system: SYSTEMS.loinc, code: "18842-5" }], text: DOCUMENT_TYPE_LABELS_DE["rehab-discharge-report"] },
    subject: { reference: `Patient/${r.patient.fhirId}`, display: displayName(r.patient.name, false) },
    date: viennaInstant(ctx.filedAt),
    author: [...(authorUrn ? [{ reference: authorUrn }] : []), { reference: orgUrn }],
    description: reason ? `${doc.title} — ${reason}` : doc.title,
    content: [
      { attachment: { contentType: "text/markdown", language: documentLanguage(doc.title), data: base64(ctx.answer.content), title: ctx.answer.fileName } },
    ],
  };
  if (doc.stay) ref.context = { period: { start: doc.stay.start, end: doc.stay.end } };
  entries.push({ fullUrl: docUrn, resource: ref, request: { method: "POST", url: "DocumentReference" } });

  const senderName = displayName({ ...ctx.identity.name, prefix: ctx.identity.name.prefix ?? r.recipient.name.prefix });
  const senderRole = doc.sentBy?.role ?? r.recipient.role;
  const written = doc.writtenBy ? `Written by ${displayName(doc.writtenBy.name)} (${doc.organization}); sent` : `Sent`;
  const provenance = buildProvenance({
    targets: [docUrn],
    authorUrn: authorUrn ?? orgUrn,
    informantUrn: senderUrn,
    organizationUrn: orgUrn,
    policy: ctx.policy,
    assembler: `Brieftaube (${r.requester.organization})`,
    fileName: ctx.answer.fileName,
    sha256: ctx.answer.sha256,
    occurredAt: ctx.answerSentAt,
    recordedAt: ctx.filedAt,
    signedAt: ctx.identityCheckedAt,
    narrativeText:
      `${written} by ${senderName}${senderRole ? `, ${senderRole}` : ""}, via Brieftaube request ${r.reference}. ` +
      `Sender identity checked with ${identitySentence(ctx.identity, viennaMinute(ctx.identityCheckedAt))}.` +
      `${ctx.releasedBy ? ` Released by ${ctx.releasedBy}.` : ""} Patient name and birth date in the document matched the request.`,
  });
  entries.push({ fullUrl: urn(), resource: provenance, request: { method: "POST", url: "Provenance" } });

  const task = buildCompletedTask(r, senderUrn, docUrn, ctx.filedAt);
  entries.push({ fullUrl: urn(), resource: task, request: { method: "PUT", url: `Task/${task.id}` } });
  return { resourceType: "Bundle", type: "transaction", entry: entries };
}

// Task = the request on the FHIR server (fhir-examples/task-requested.json).
import type { DocumentRequest } from "@brieftaube/shared";
import { DOCUMENT_TYPE_LABELS_DE, SYSTEMS } from "@brieftaube/shared";
import type { Task } from "fhir/r4.js";
import { displayName, viennaInstant } from "./util.ts";

export function taskId(reference: string): string {
  return reference.toLowerCase();
}

function baseTask(r: DocumentRequest, lastModified: string): Task & { id: string } {
  return {
    resourceType: "Task",
    id: r.fhirTaskId ?? taskId(r.reference),
    identifier: [{ system: SYSTEMS.requestReference, value: r.reference }],
    status: "requested",
    intent: "order",
    code: { coding: [{ system: SYSTEMS.taskCode, code: "fulfill" }] },
    description: `Dokumentanforderung: ${DOCUMENT_TYPE_LABELS_DE[r.documentType]}`,
    for: { reference: `Patient/${r.patient.fhirId}`, display: displayName(r.patient.name, false) },
    authoredOn: viennaInstant(r.createdAt),
    lastModified: viennaInstant(lastModified),
    requester: { reference: `Practitioner/${r.requester.practitionerId}`, display: r.requester.displayName },
    owner: { display: `${r.recipient.displayName}, ${r.recipient.organization}` },
  };
}

const input = (r: DocumentRequest): Task["input"] => [{ type: { text: "requested-document-type" }, valueString: r.documentType }];

/** Task as created when the request is sent. */
export function buildRequestedTask(r: DocumentRequest): Task & { id: string } {
  const t = baseTask(r, r.createdAt);
  if (r.note) t.note = [{ text: r.note }];
  t.input = input(r);
  return t;
}

/** Task marked with a misdelivery problem; status stays requested (FHIR-MAPPING.md "Wrong patient"). */
export function buildProblemTask(r: DocumentRequest, problem: string, at: string): Task & { id: string } {
  const t = buildRequestedTask(r);
  t.lastModified = viennaInstant(at);
  t.businessStatus = { text: `misdelivery: ${problem}` };
  return t;
}

/** Task PUT inside the filing transaction: completed, owner = verified sender, output = filed resource. */
export function buildCompletedTask(r: DocumentRequest, ownerUrn: string, outputUrn: string, filedAt: string): Task & { id: string } {
  const t = baseTask(r, filedAt);
  t.status = "completed";
  t.owner = { reference: ownerUrn, display: `${r.recipient.displayName}, ${r.recipient.organization}` };
  t.input = input(r);
  t.output = [{ type: { text: "filed-resource" }, valueReference: { reference: outputUrn } }];
  return t;
}

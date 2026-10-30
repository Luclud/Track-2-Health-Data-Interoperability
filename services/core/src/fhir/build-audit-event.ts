// AuditEntry → FHIR AuditEvent (fhir-examples/auditevent-*.json).
import type { AuditEntry } from "@brieftaube/shared";
import { SYSTEMS } from "@brieftaube/shared";
import type { AuditEvent } from "fhir/r4.js";
import { viennaInstant } from "./util.ts";

export interface AuditEventContext {
  taskId?: string;
  patientId?: string;
  site: string;
}

export function buildAuditEvent(e: AuditEntry, ctx: AuditEventContext): AuditEvent {
  const who: NonNullable<AuditEvent["agent"][number]["who"]> = { display: e.actor.display };
  if (e.actor.kind === "outside-person") who.identifier = { system: SYSTEMS.eidBpk, value: e.actor.id };
  else if (e.actor.kind === "internal-practitioner") who.identifier = { system: SYSTEMS.matrixUser, value: e.actor.id };
  const ev: AuditEvent = {
    resourceType: "AuditEvent",
    type: { system: SYSTEMS.dicom, code: "110100" },
    subtype: [{ system: SYSTEMS.auditStep, code: e.step }],
    action: "E",
    recorded: viennaInstant(e.at),
    outcome: e.outcome === "success" ? "0" : "4",
    outcomeDesc: e.what,
    agent: [{ who: { ...(who.identifier ? { identifier: who.identifier } : {}), display: who.display }, requestor: true }],
    source: {
      site: ctx.site,
      observer: { display: "Brieftaube" },
      type: [{ system: SYSTEMS.securitySourceType, code: "4" }],
    },
  };
  const entity: NonNullable<AuditEvent["entity"]> = [];
  if (ctx.taskId) entity.push({ what: { reference: `Task/${ctx.taskId}` } });
  if (ctx.patientId) entity.push({ what: { reference: `Patient/${ctx.patientId}` } });
  if (entity.length) ev.entity = entity;
  return ev;
}

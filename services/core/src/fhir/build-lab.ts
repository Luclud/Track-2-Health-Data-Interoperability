// Lab result → transaction Bundle (fhir-examples/lab-result-transaction.json).
import type { ParsedLabResult } from "@brieftaube/shared";
import { SYSTEMS } from "@brieftaube/shared";
import type { Bundle, BundleEntry, DiagnosticReport, Observation } from "fhir/r4.js";
import { samePerson } from "../parser/names.ts";
import { buildCompletedTask } from "./build-task.ts";
import { buildProvenance } from "./build-provenance.ts";
import { documentAuthorEntry, identitySentence, organizationEntry, senderEntry } from "./build-common.ts";
import type { FilingContext } from "./types.ts";
import { base64, displayName, interpretationCode, quantity, rangeText, uuidUrn, viennaMinute } from "./util.ts";

export function documentLanguage(title: string): string {
  return /(report|result)\b/i.test(title) ? "en" : "de";
}

export function buildLabBundle(doc: ParsedLabResult, ctx: FilingContext): Bundle {
  const { request: r } = ctx;
  const urn = () => uuidUrn(ctx.newUuid);
  const senderUrn = urn();
  const orgUrn = urn();
  const entries: BundleEntry[] = [senderEntry(senderUrn, ctx), organizationEntry(orgUrn, doc.organization)];

  // The validating physician is the author; if it is not the verified sender, record them separately.
  let authorUrn = senderUrn;
  if (doc.validatedBy && !samePerson(doc.validatedBy.name, ctx.identity.name)) {
    authorUrn = urn();
    entries.push(documentAuthorEntry(authorUrn, doc.organization, doc.validatedBy));
  }

  const subject = { reference: `Patient/${r.patient.fhirId}`, display: displayName(r.patient.name, false) };
  const performer = [{ reference: senderUrn }, { reference: orgUrn }];
  const obsUrns: string[] = [];
  doc.values.forEach((v, i) => {
    const fullUrl = urn();
    obsUrns.push(fullUrl);
    const q = quantity(v.value, v.unitText, v.loinc);
    const unitOf = ({ value: _v, ...rest }: typeof q) => rest;
    const obs: Observation = {
      resourceType: "Observation",
      identifier: [{ system: SYSTEMS.requestReference, value: `${r.reference}-${i + 1}` }],
      status: "final",
      category: [{ coding: [{ system: SYSTEMS.observationCategory, code: "laboratory" }] }],
      code: { coding: [{ system: SYSTEMS.loinc, code: v.loinc }], text: v.testName },
      subject,
      effectiveDateTime: doc.sampleTaken,
      issued: doc.reported,
      performer,
      valueQuantity: q,
    };
    const interp = interpretationCode(v.value, v.referenceLow, v.referenceHigh);
    if (interp) obs.interpretation = [{ coding: [{ system: SYSTEMS.interpretation, code: interp }] }];
    const text = rangeText(v.value, v.referenceLow, v.referenceHigh);
    if (text) {
      const range: NonNullable<Observation["referenceRange"]>[number] = {};
      if (v.referenceLow !== undefined) range.low = { value: v.referenceLow, ...unitOf(q) };
      if (v.referenceHigh !== undefined) range.high = { value: v.referenceHigh, ...unitOf(q) };
      range.text = text;
      obs.referenceRange = [range];
    }
    entries.push({ fullUrl, resource: obs, request: { method: "POST", url: "Observation" } });
  });

  const reportUrn = urn();
  const report: DiagnosticReport = {
    resourceType: "DiagnosticReport",
    identifier: [{ system: SYSTEMS.requestReference, value: r.reference }],
    status: "final",
    category: [{ coding: [{ system: SYSTEMS.v2_0074, code: "LAB" }] }],
    code: { coding: [{ system: SYSTEMS.loinc, code: "11502-2" }], text: doc.title },
    subject,
    effectiveDateTime: doc.sampleTaken,
    issued: doc.reported,
    performer,
    resultsInterpreter: [{ reference: authorUrn }],
    result: obsUrns.map((reference) => ({ reference })),
  };
  if (doc.conclusion) report.conclusion = doc.conclusion;
  report.presentedForm = [
    { contentType: "text/markdown", language: documentLanguage(doc.title), data: base64(ctx.answer.content), title: ctx.answer.fileName },
  ];
  entries.push({ fullUrl: reportUrn, resource: report, request: { method: "POST", url: "DiagnosticReport" } });

  const senderName = displayName({ ...ctx.identity.name, prefix: ctx.identity.name.prefix ?? r.recipient.name.prefix });
  const registerText = !ctx.register.checked
    ? "the physician register check did not apply (recipient is not a physician)"
    : ctx.register.listed
      ? `listed in the physician register (simulated) as ${ctx.register.registrationNumber ?? "?"}`
      : `not listed in the physician register (simulated)${ctx.releasedBy ? `; released by ${ctx.releasedBy}` : ""}`;
  const authorText = authorUrn === senderUrn || !doc.validatedBy ? "" : ` Validated by ${displayName(doc.validatedBy.name)} according to the document.`;
  const provUrn = urn();
  const provenance = buildProvenance({
    targets: [reportUrn, ...obsUrns],
    authorUrn,
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
      `Sent by ${senderName} (${doc.organization}) via Brieftaube request ${r.reference}. ` +
      `Identity checked with ${identitySentence(ctx.identity, viennaMinute(ctx.identityCheckedAt))}; ${registerText}.${authorText} ` +
      "Patient name and birth date in the document matched the request.",
  });
  entries.push({ fullUrl: provUrn, resource: provenance, request: { method: "POST", url: "Provenance" } });

  const task = buildCompletedTask(r, senderUrn, reportUrn, ctx.filedAt);
  entries.push({ fullUrl: urn(), resource: task, request: { method: "PUT", url: `Task/${task.id}` } });

  return { resourceType: "Bundle", type: "transaction", entry: entries };
}

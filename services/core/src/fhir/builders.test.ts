import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AuditEntry, DocumentRequest, ParsedLabResult, ParsedRehabReport, VerifiedIdentity } from "@brieftaube/shared";
import type { Bundle, Observation } from "fhir/r4.js";
import { createDocumentParser } from "../parser/index.ts";
import { buildAuditEvent, buildLabBundle, buildProblemTask, buildRehabBundle, buildRequestedTask, sha256Hex, type FilingContext } from "./index.ts";

const parser = createDocumentParser();
const golden = (f: string) => JSON.parse(readFileSync(`fhir-examples/${f}`, "utf8"));
const scenario = (f: string) => readFileSync(`scenario/documents/${f}`, "utf8");
const out = (name: string, r: unknown) => {
  mkdirSync("out/fhir", { recursive: true });
  writeFileSync(`out/fhir/${name}.json`, JSON.stringify(r, null, 2));
};

/** Replace every urn:uuid by its order of first appearance, so builder and golden ids compare. */
function normalizeUuids<T>(x: T): T {
  const map = new Map<string, string>();
  const s = JSON.stringify(x).replace(/urn:uuid:[0-9a-f-]{36}/g, (u) => {
    if (!map.has(u)) map.set(u, `urn:uuid:#${map.size + 1}`);
    return map.get(u)!;
  });
  return JSON.parse(s);
}

const maria = { fhirId: "maria-beispiel", name: { given: ["Maria"], family: "Beispiel" }, birthDate: "1961-03-12", gender: "female" };
const requester = { matrixUserId: "@lena.hofer:klinikum.example", displayName: "Dr. Lena Hofer", organization: "Klinikum Beispielstadt", practitionerId: "lena-hofer" };

export const labRequest: DocumentRequest = {
  id: "11111111-1111-4111-8111-111111111111",
  reference: "BT-7K2Q",
  createdAt: "2026-10-30T08:05:00.000Z",
  expiresAt: "2026-11-02T08:05:00.000Z",
  status: "verified",
  requester,
  roomId: "!room:klinikum.example",
  patient: maria,
  documentType: "lab-result",
  note: "Aktuelle Gerinnungswerte vor geplantem Eingriff",
  recipient: {
    displayName: "Dr. Eva Brandl",
    name: { prefix: ["Dr."], given: ["Eva"], family: "Brandl" },
    role: "Laborärztin",
    organization: "Labor Kanalstraße",
    isPhysician: true,
    channel: "email",
    address: "eva.brandl@labor-kanal.example",
  },
  filedResources: [],
};
const rehabRequest: DocumentRequest = {
  ...labRequest,
  id: "22222222-2222-4222-8222-222222222222",
  reference: "BT-3MX9",
  createdAt: "2026-10-30T09:15:00+01:00",
  documentType: "rehab-discharge-report",
  recipient: {
    displayName: "Stefan Kern",
    name: { given: ["Stefan"], family: "Kern" },
    role: "Entlassungsmanagement",
    organization: "Reha Waldblick",
    isPhysician: false,
    channel: "sms",
    address: "+43 660 000 0101",
  },
};
const eva: VerifiedIdentity = {
  provider: "mock-id-austria",
  subject: "GH:mock-bpk-eva-brandl",
  name: { given: ["Eva"], family: "Brandl", prefix: ["Dr."] },
  birthDate: "1979-05-14",
  levelOfAssurance: "high",
  authenticatedAt: "2026-10-30T09:11:05+01:00",
};
const stefan: VerifiedIdentity = { ...eva, subject: "GH:mock-bpk-stefan-kern", name: { given: ["Stefan"], family: "Kern" }, birthDate: "1988-04-30" };

function labCtx(content: string, fileName = "lab-result-maria-beispiel.md"): FilingContext {
  return {
    request: labRequest,
    identity: eva,
    register: { checked: true, listed: true, registerName: "Ärzteliste (simuliert)", registrationNumber: "AT-LAB-4711" },
    policy: "eid-high+register",
    answer: { fileName, content, sha256: sha256Hex(content) },
    identityCheckedAt: "2026-10-30T09:11:05+01:00",
    answerSentAt: "2026-10-30T08:12:41.123Z",
    filedAt: "2026-10-30T09:12:43+01:00",
  };
}

describe("FHIR builders match fhir-examples/", () => {
  it("lab result transaction", () => {
    const md = scenario("lab-result-maria-beispiel.md");
    const doc = parser.parse(md).document as ParsedLabResult;
    const bundle = buildLabBundle(doc, labCtx(md));
    out("built-lab-result-transaction", bundle);
    expect(normalizeUuids(bundle)).toEqual(normalizeUuids(golden("lab-result-transaction.json")));
  });

  it("rehab report transaction", () => {
    const md = scenario("rehab-report-maria-beispiel.md");
    const doc = parser.parse(md).document as ParsedRehabReport;
    const bundle = buildRehabBundle(doc, {
      request: rehabRequest,
      identity: stefan,
      register: { checked: false, listed: false, registerName: "Ärzteliste (simuliert)" },
      policy: "eid-high",
      answer: { fileName: "rehab-report-maria-beispiel.md", content: md, sha256: sha256Hex(md) },
      identityCheckedAt: "2026-10-30T09:19:02+01:00",
      answerSentAt: "2026-10-30T09:20:10+01:00",
      filedAt: "2026-10-30T09:20:11+01:00",
    });
    out("built-rehab-report-transaction", bundle);
    expect(normalizeUuids(bundle)).toEqual(normalizeUuids(golden("rehab-report-transaction.json")));
  });

  it("requested task", () => {
    const task = buildRequestedTask(labRequest);
    out("built-task-requested", task);
    expect(task).toEqual(golden("task-requested.json"));
    const problem = buildProblemTask(labRequest, "wrong-patient", "2026-10-30T09:30:00+01:00");
    out("built-task-wrong-patient", problem);
    expect(problem.status).toBe("requested");
    expect(problem.businessStatus?.text).toBe("misdelivery: wrong-patient");
  });

  it("audit events", () => {
    const base: Omit<AuditEntry, "step" | "at" | "actor" | "what" | "outcome"> = { id: "a", requestId: labRequest.id, requestReference: "BT-7K2Q" };
    const ok = buildAuditEvent(
      {
        ...base,
        step: "identity-checked",
        at: "2026-10-30T08:11:05.000Z",
        actor: { kind: "outside-person", id: "GH:mock-bpk-eva-brandl", display: "Dr. Eva Brandl" },
        what: "Identity of Dr. Eva Brandl confirmed via ID Austria (simulated), LoA high; register: listed",
        outcome: "success",
      },
      { taskId: "bt-7k2q", site: "Klinikum Beispielstadt" },
    );
    expect(ok).toEqual(golden("auditevent-identity-checked.json"));
    const fail = buildAuditEvent(
      {
        ...base,
        step: "misdelivery-caught",
        at: "2026-10-30T09:30:00+01:00",
        actor: { kind: "outside-person", id: "GH:mock-bpk-ines-fremd", display: "Ines Fremd (not the recipient)" },
        what: "Identity mismatch: verified person 'Ines Fremd' is not the named recipient 'Dr. Eva Brandl'. Nothing was shown.",
        outcome: "failure",
      },
      { taskId: "bt-7k2q", site: "Klinikum Beispielstadt" },
    );
    expect(fail).toEqual(golden("auditevent-misdelivery-identity.json"));
    const internal = buildAuditEvent(
      { ...base, step: "request-sent", at: "2026-10-30T09:05:00+01:00", actor: { kind: "internal-practitioner", id: requester.matrixUserId, display: "Dr. Lena Hofer" }, what: "Request BT-7K2Q sent", outcome: "success" },
      { taskId: "bt-7k2q", patientId: "maria-beispiel", site: "Klinikum Beispielstadt" },
    );
    out("built-auditevent-ok", ok);
    out("built-auditevent-request-sent", internal);
    expect(internal.entity).toHaveLength(2);
  });
});

describe("lab variants", () => {
  it("H/L interpretation, UCUM mapping, unknown unit, separate author", () => {
    const md = readFileSync("services/core/src/parser/__fixtures__/lab-other-lab-high-low.md", "utf8");
    const doc = parser.parse(md).document as ParsedLabResult;
    const bundle: Bundle = buildLabBundle(doc, labCtx(md, "other.md"));
    out("built-lab-variant-transaction", bundle);
    const obs = bundle.entry!.map((e) => e.resource).filter((r): r is Observation => r?.resourceType === "Observation");
    expect(obs.map((o) => o.interpretation?.[0]?.coding?.[0]?.code)).toEqual(["H", "L", "H", "L", "H"]);
    expect(obs[0]!.valueQuantity).toEqual({ value: 48, unit: "mg/L", system: "http://unitsofmeasure.org", code: "mg/L" });
    expect(obs[0]!.referenceRange).toEqual([{ high: { value: 5, unit: "mg/L", system: "http://unitsofmeasure.org", code: "mg/L" }, text: "< 5" }]);
    expect(obs[3]!.valueQuantity?.code).toBe("mL/min/{1.73_m2}");
    // Validated by Prof. Huber-Schmid, sent by Eva Brandl → separate author Practitioner
    const practitioners = bundle.entry!.filter((e) => e.resource?.resourceType === "Practitioner");
    expect(practitioners).toHaveLength(2);
    expect(JSON.stringify(bundle)).not.toContain('"display":"CRP"');

    const unk = readFileSync("services/core/src/parser/__fixtures__/lab-unknown-unit.md", "utf8");
    const b2 = buildLabBundle(parser.parse(unk).document as ParsedLabResult, labCtx(unk, "unk.md"));
    out("built-lab-unknown-unit-transaction", b2);
    const o = b2.entry!.find((e) => e.resource?.resourceType === "Observation")!.resource as Observation;
    expect(o.valueQuantity).toEqual({ value: 0.3, unit: "IU/mL Xa" });
  });

  it("no LOINC coding has a display", () => {
    const md = scenario("lab-result-maria-beispiel.md");
    const bundle = buildLabBundle(parser.parse(md).document as ParsedLabResult, labCtx(md));
    for (const e of bundle.entry!) {
      const s = JSON.stringify(e.resource);
      expect(s).not.toMatch(/"system":"http:\/\/loinc.org","code":"[^"]+","display"/);
    }
  });
});

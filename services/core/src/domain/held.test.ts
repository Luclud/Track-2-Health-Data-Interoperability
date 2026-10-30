import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MemoryFhirStore } from "../fhir/memory-store.ts";
import type { MemorySender } from "../notify/index.ts";
import { MockLlmClient } from "../llm/index.ts";
import { SqliteRequestRepository } from "../db/index.ts";
import { FakeRegister, identity, labBody, lena, testDeps } from "./testkit.ts";

const maria = { patientGiven: "Maria", patientFamily: "Beispiel", patientBirthDate: "1961-03-12" };
const labDoc = readFileSync("scenario/documents/lab-result-maria-beispiel.md", "utf8");

async function heldRequest(overrides = {}) {
  let now = new Date("2026-10-30T09:00:00+01:00");
  const t = testDeps({ register: new FakeRegister({}), now: () => now, ...overrides });
  const { request } = await t.service.createRequest(lena, labBody);
  const token = /\/r\/([A-Za-z0-9_-]+)/.exec((await (t.deps.email as MemorySender).inbox())[0]!.body)![1]!;
  const id = identity("eva-brandl");
  await t.service.completeIdentityCheck(token, id, {});
  const out = await t.service.submitAnswer(token, id, { ...maria, content: labDoc }, {});
  expect(out).toEqual({ result: "held", reason: "not-in-register" });
  return { ...t, request, fhir: t.deps.fhir as MemoryFhirStore, advance: (h: number) => (now = new Date(now.getTime() + h * 3600_000)) };
}

describe("held answers (CORE-11)", () => {
  it("release files exactly what was held, by the releasing doctor", async () => {
    const { service, request, fhir, deps } = await heldRequest();
    expect(fhir.transactions).toHaveLength(0);
    const r = await service.release(request.id, lena);
    expect(r).toMatchObject({ status: "filed" });
    expect(r.filedResources.filter((x) => x.startsWith("Observation/"))).toHaveLength(4);
    expect(fhir.transactions).toHaveLength(1);
    const prov = fhir.transactions[0]!.entry!.find((e) => e.resource?.resourceType === "Provenance")!.resource!;
    expect(JSON.stringify(prov)).toContain("released by Dr. Lena Hofer");
    const last = (await deps.audit.forRequest(request.id)).at(-1)!;
    expect(last).toMatchObject({ step: "answer-filed", outcome: "success", actor: { kind: "internal-practitioner", id: lena.matrixUserId }, details: { decision: "released", heldReason: "not-in-register" } });
    expect((await deps.chat.list(labBody.roomId)).at(-1)!.body).toContain("Ärzteliste ✗ (freigegeben)");
    expect((await deps.chat.list(labBody.roomId)).at(-1)!.body).not.toContain("KI-Hilfe");
    expect(last.details).not.toHaveProperty("senderAssist");
    await expect(service.release(request.id, lena)).rejects.toMatchObject({ code: "not-held", status: 409 });
  });

  it("ASSIST-4: a KI-Hilfe answer is audited as senderAssist and noted in the ✅ message, without titles", async () => {
    const t = testDeps({ register: new FakeRegister({}) });
    const { request } = await t.service.createRequest(lena, labBody);
    const token = /\/r\/([A-Za-z0-9_-]+)/.exec((await (t.deps.email as MemorySender).inbox())[0]!.body)![1]!;
    const id = identity("eva-brandl");
    await t.service.completeIdentityCheck(token, id, {});
    expect(await t.service.submitAnswer(token, id, { ...maria, content: labDoc, senderAssist: true }, {})).toEqual({ result: "held", reason: "not-in-register" });
    await t.service.release(request.id, lena);
    const last = (await t.deps.audit.forRequest(request.id)).at(-1)!;
    expect(last).toMatchObject({ step: "answer-filed", outcome: "success", details: { senderAssist: true } });
    expect(JSON.stringify(last.details)).not.toMatch(/labor-gerinnung|Laborbefund Gerinnung/);
    const msg = (await t.deps.chat.list(labBody.roomId)).at(-1)!;
    expect(msg.body).toMatch(/^✅[\s\S]*\nAbsender hat die KI-Hilfe genutzt; Auswahl vom Absender bestätigt\.$/);
    expect(msg.html).toContain("<p>Absender hat die KI-Hilfe genutzt; Auswahl vom Absender bestätigt.</p>");
  });

  it("reject files nothing", async () => {
    const { service, request, fhir, deps } = await heldRequest();
    const r = await service.reject(request.id, lena);
    expect(r.status).toBe("rejected");
    expect(fhir.transactions).toHaveLength(0);
    expect((await deps.audit.forRequest(request.id)).at(-1)).toMatchObject({ step: "answer-filed", outcome: "failure", details: { decision: "rejected" } });
    expect((await deps.chat.list(labBody.roomId)).at(-1)!.body).toContain("verworfen");
    await expect(service.release(request.id, lena)).rejects.toMatchObject({ code: "not-held" });
  });

  it("a held answer does not expire and can still be released later", async () => {
    const { service, request, advance } = await heldRequest();
    advance(24 * 30);
    expect((await service.detail(request.id))!.request.status).toBe("held");
    expect((await service.release(request.id, lena)).status).toBe("filed");
  });

  it("held answer survives a restart (SQLite)", async () => {
    const repo = new SqliteRequestRepository({ dataDir: ":memory:" });
    const { request, service } = await heldRequest({ repo });
    expect(await repo.heldAnswer(request.id)).toMatchObject({ document: { kind: "lab-result" } });
    await service.release(request.id, lena);
    expect(await repo.heldAnswer(request.id)).toBeUndefined();
  });

  it("unknown / not held → 404 / 409", async () => {
    const { service } = testDeps();
    await expect(service.release("nope", lena)).rejects.toMatchObject({ status: 404 });
    const t = testDeps();
    const { request } = await t.service.createRequest(lena, labBody);
    await expect(t.service.reject(request.id, lena)).rejects.toMatchObject({ status: 409, code: "not-held" });
  });

  it("AI-extracted answers are released with the verified values", async () => {
    const prose = labDoc.replace("# Labor Kanalstraße: lab report", "Labor Kanalstraße Befund").replace(/\| Test.*\n\|---.*\n/, "");
    const raw = new MockLlmClient({
      kind: "lab-result", title: "Labor Kanalstraße Befund", organization: "Labor Kanalstraße",
      patient: { name: { given: ["Maria"], family: "Beispiel" }, birthDate: "1961-03-12" },
      sampleTaken: "2026-10-22T08:10:00+02:00", reported: "2026-10-22T11:40:00+02:00",
      values: [{ testName: "INR (prothrombin time)", value: 1.0, unitText: "", referenceLow: 0.8, referenceHigh: 1.2, loinc: "6301-6" }],
    });
    const t = testDeps({ llm: raw });
    const { request } = await t.service.createRequest(lena, labBody);
    const token = /\/r\/([A-Za-z0-9_-]+)/.exec((await (t.deps.email as MemorySender).inbox())[0]!.body)![1]!;
    const id = identity("eva-brandl");
    await t.service.completeIdentityCheck(token, id, {});
    expect(await t.service.submitAnswer(token, id, { ...maria, content: prose }, {})).toEqual({ result: "held", reason: "ai-extracted" });
    const r = await t.service.release(request.id, lena);
    expect(r.filedResources.filter((x) => x.startsWith("Observation/"))).toHaveLength(1);
  });
});

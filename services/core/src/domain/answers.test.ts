import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Task } from "fhir/r4.js";
import type { MemoryFhirStore } from "../fhir/memory-store.ts";
import type { MemorySender } from "../notify/index.ts";
import { FakeRegister, identity, labBody, lena, rehabBody, testDeps } from "./testkit.ts";

const doc = (f: string) => readFileSync(`scenario/documents/${f}`, "utf8");
const tokenFrom = (text: string) => /\/r\/([A-Za-z0-9_-]+)/.exec(text)![1]!;
const maria = { patientGiven: "Maria", patientFamily: "Beispiel", patientBirthDate: "1961-03-12" };

async function verified(body = labBody, persona = "eva-brandl", overrides = {}) {
  const t = testDeps(overrides);
  const { request } = await t.service.createRequest(lena, body);
  const inbox = await ((body.recipient.channel === "email" ? t.deps.email : t.deps.sms) as MemorySender).inbox();
  const token = tokenFrom(inbox[0]!.body);
  await t.service.openLink(token, {});
  const id = identity(persona);
  expect((await t.service.completeIdentityCheck(token, id, {})).ok).toBe(true);
  return { ...t, request, token, id, fhir: t.deps.fhir as MemoryFhirStore };
}

describe("submitAnswer happy path (both scenario requests)", () => {
  it("lab result from Eva Brandl is filed", async () => {
    const { service, deps, request, token, id, fhir } = await verified();
    const out = await service.submitAnswer(token, id, { ...maria, content: doc("lab-result-maria-beispiel.md"), fileName: "lab-result-maria-beispiel.md" }, {});
    expect(out.result).toBe("filed");
    if (out.result !== "filed") return;
    expect(out.filedResources.filter((x) => x.startsWith("Observation/"))).toHaveLength(4);
    expect(out.filedResources.some((x) => x.startsWith("DiagnosticReport/"))).toBe(true);
    expect(out.filedResources.some((x) => x.startsWith("Provenance/"))).toBe(true);
    expect(fhir.transactions).toHaveLength(1);
    expect((await fhir.read<Task>("Task", request.fhirTaskId!))!.status).toBe("completed");
    const r = (await deps.repo.byId(request.id))!;
    expect(r.status).toBe("filed");
    expect(r.filedResources).toEqual(out.filedResources);
    expect((await deps.audit.forRequest(request.id)).map((a) => a.step)).toEqual(["request-sent", "link-opened", "identity-checked", "answer-sent", "answer-filed"]);
    const chat = await deps.chat.list(labBody.roomId);
    expect(chat.at(-1)!.body).toBe(
      `✅ ${request.reference}: Laborbefund von Dr. Eva Brandl abgelegt. INR 1.0 (0.8–1.2) · aPTT 31 s · Thrombozyten 245 · Fibrinogen 3.1 g/L – alle im Referenzbereich. Identität: ID Austria (simuliert), Ärzteliste ✓`,
    );
    await expect(service.submitAnswer(token, id, { ...maria, content: "x" }, {})).rejects.toMatchObject({ code: "already-answered" });
  });

  it("rehab report from Stefan Kern is filed", async () => {
    const { service, deps, request, token, id } = await verified(rehabBody, "stefan-kern");
    const out = await service.submitAnswer(token, id, { ...maria, content: doc("rehab-report-maria-beispiel.md") }, {});
    expect(out.result).toBe("filed");
    const r = (await deps.repo.byId(request.id))!;
    expect(r.filedResources.some((x) => x.startsWith("DocumentReference/"))).toBe(true);
    expect((await deps.chat.list(rehabBody.roomId)).at(-1)!.body).toBe(
      `✅ ${request.reference}: Reha-Entlassungsbericht von Stefan Kern abgelegt (Aufenthalt 02.09.2026–23.09.2026). Identität: ID Austria (simuliert)`,
    );
  });
});

describe("submitAnswer misdelivery (M3) and rejects", () => {
  it.each([
    ["form says Max", { patientGiven: "Max", patientFamily: "Beispiel", patientBirthDate: "1960-01-01" }],
    ["form says Maria, document is Max", maria],
  ])("%s → rejected, nothing sent to FHIR", async (_label, form) => {
    const { service, deps, request, token, id, fhir } = await verified();
    const out = await service.submitAnswer(token, id, { ...form, content: doc("lab-result-max-beispiel.md") }, {});
    expect(out).toMatchObject({ result: "rejected", reason: "wrong-patient" });
    if (out.result === "rejected") expect(out.messageForResponder).toMatch(/nicht die angefragte Person/);
    expect(fhir.transactions).toHaveLength(0);
    const r = (await deps.repo.byId(request.id))!;
    expect(r).toMatchObject({ status: "rejected", lastProblem: "wrong-patient", filedResources: [] });
    expect((await fhir.read<Task>("Task", request.fhirTaskId!))!.businessStatus?.text).toBe("misdelivery: wrong-patient");
    const last = (await deps.audit.forRequest(request.id)).at(-1)!;
    expect(last).toMatchObject({ step: "misdelivery-caught", details: { misdelivery: "wrong-patient" } });
    const chat = (await deps.chat.list(labBody.roomId)).at(-1)!;
    expect(chat.severity).toBe("alert");
    expect(chat.body).toBe(`🛑 ${request.reference}: Antwort betrifft eine andere Person (Max Beispiel, geb. 01.01.1960) – NICHT abgelegt. Dr. Eva Brandl wurde gebeten, das richtige Dokument zu senden.`);

    // corrected answer is accepted afterwards
    const ok = await service.submitAnswer(token, id, { ...maria, content: doc("lab-result-maria-beispiel.md") }, {});
    expect(ok.result).toBe("filed");
  });

  it("form birth date wrong → rejected", async () => {
    const { service, token, id } = await verified();
    const out = await service.submitAnswer(token, id, { ...maria, patientBirthDate: "1961-03-13", content: doc("lab-result-maria-beispiel.md") }, {});
    expect(out).toMatchObject({ result: "rejected", reason: "wrong-patient" });
  });

  it("wrong document type → rejected", async () => {
    const { service, token, id, fhir } = await verified();
    const out = await service.submitAnswer(token, id, { ...maria, content: doc("rehab-report-maria-beispiel.md") }, {});
    expect(out).toMatchObject({ result: "rejected", reason: "wrong-document-type" });
    expect(fhir.transactions).toHaveLength(0);
  });

  it("unreadable (no LLM) → rejected with friendly message", async () => {
    const { service, token, id } = await verified();
    const out = await service.submitAnswer(token, id, { ...maria, content: "hello, here are the values: all fine" }, {});
    expect(out).toMatchObject({ result: "rejected", reason: "unreadable" });
    if (out.result === "rejected") expect(out.messageForResponder).toContain("Standardformat");
  });

  it("not in register → held, nothing filed", async () => {
    const { service, deps, request, token, id, fhir } = await verified(labBody, "eva-brandl", { register: new FakeRegister({}) });
    const out = await service.submitAnswer(token, id, { ...maria, content: doc("lab-result-maria-beispiel.md") }, {});
    expect(out).toEqual({ result: "held", reason: "not-in-register" });
    expect(fhir.transactions).toHaveLength(0);
    expect((await deps.repo.byId(request.id))!).toMatchObject({ status: "held", heldReason: "not-in-register" });
    expect((await deps.chat.list(labBody.roomId)).at(-1)!.body).toContain("wartet auf Ihre Freigabe");
  });

  it("a different verified person cannot answer", async () => {
    const { service, token } = await verified();
    await expect(service.submitAnswer(token, identity("ines-fremd"), { ...maria, content: "x" }, {})).rejects.toMatchObject({ code: "identity-required" });
  });
});

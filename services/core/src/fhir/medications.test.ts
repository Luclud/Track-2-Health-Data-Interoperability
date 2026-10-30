import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MedicationStatement } from "fhir/r4.js";
import type { MemoryFhirStore } from "./memory-store.ts";
import type { MemorySender } from "../notify/index.ts";
import { MockLlmClient } from "../llm/index.ts";
import { rehabSummary } from "../llm/summary.ts";
import { identity, lena, rehabBody, testDeps } from "../domain/testkit.ts";
import { dischargeMedications } from "./build-medications.ts";

const md = readFileSync("scenario/documents/rehab-report-maria-beispiel.md", "utf8");
const maria = { patientGiven: "Maria", patientFamily: "Beispiel", patientBirthDate: "1961-03-12" };

async function fileRehab(llm?: MockLlmClient) {
  const t = testDeps(llm ? { llm } : {});
  await t.service.createRequest(lena, rehabBody);
  const token = /\/r\/([A-Za-z0-9_-]+)/.exec((await (t.deps.sms as MemorySender).inbox())[0]!.body)![1]!;
  const id = identity("stefan-kern");
  await t.service.completeIdentityCheck(token, id, {});
  const out = await t.service.submitAnswer(token, id, { ...maria, content: md, fileName: "rehab.md" }, {});
  return { ...t, out, fhir: t.deps.fhir as MemoryFhirStore };
}

describe("CORE-12 MedicationStatements", () => {
  it("parses the discharge medication section", () => {
    expect(dischargeMedications(md)).toEqual([
      { medication: "Rivaroxaban 10 mg", dosage: "once a day until 29 September 2026, to prevent thrombosis for six weeks after the operation" },
      { medication: "Paracetamol 500 mg", dosage: "up to three times a day if needed" },
      { medication: "Pantoprazole 20 mg", dosage: "once a day" },
    ]);
    expect(dischargeMedications("# x\n\n- not a med list")).toEqual([]);
  });

  it("rehab filing adds 3 MedicationStatements derived from the DocumentReference", async () => {
    const { out, fhir } = await fileRehab();
    expect(out.result).toBe("filed");
    const bundle = fhir.transactions[0]!;
    const docUrl = bundle.entry!.find((e) => e.resource?.resourceType === "DocumentReference")!.fullUrl;
    const meds = bundle.entry!.filter((e) => e.resource?.resourceType === "MedicationStatement").map((e) => e.resource as MedicationStatement);
    expect(meds.map((m) => m.medicationCodeableConcept?.text)).toEqual(["Rivaroxaban 10 mg", "Paracetamol 500 mg", "Pantoprazole 20 mg"]);
    expect(meds.every((m) => m.derivedFrom?.[0]?.reference === docUrl && m.subject.reference === "Patient/maria-beispiel")).toBe(true);
    if (out.result === "filed") expect(out.filedResources.filter((x) => x.startsWith("MedicationStatement/"))).toHaveLength(3);
    mkdirSync("out/fhir", { recursive: true });
    writeFileSync("out/fhir/built-rehab-with-medications.json", JSON.stringify(bundle, null, 2));
  });
});

describe("CORE-12 AI summary", () => {
  it("is appended to the ✅ message when an LLM is configured", async () => {
    const llm = new MockLlmClient({ lines: ["Nach Hüft-TEP links gehfähig ohne Hilfsmittel (500 m).", "Rivaroxaban bis 29.09.2026, Kontroll-Röntgen 11/2026."] });
    const { deps } = await fileRehab(llm);
    const last = (await deps.chat.list(rehabBody.roomId)).at(-1)!.body;
    expect(last).toContain("✅");
    expect(last).toContain("KI-Zusammenfassung");
    expect(last).toContain("Rivaroxaban bis 29.09.2026");
  });
  it("absent without LLM and on LLM errors", async () => {
    const { deps } = await fileRehab();
    expect((await deps.chat.list(rehabBody.roomId)).at(-1)!.body).not.toContain("KI-Zusammenfassung");
    expect(await rehabSummary(new MockLlmClient(() => { throw new Error("x"); }), md)).toBeUndefined();
  });
});

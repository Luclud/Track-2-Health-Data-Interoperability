import { describe, expect, it } from "vitest";
import type { LlmClient } from "../ports.ts";
import { MockLlmClient } from "../llm/index.ts";
import { archiveDocument, assistLlm, belongsToPatient, patientArchive, rankArchive } from "./assist.ts";

const maria = { patient: { name: { given: ["Maria"], family: "Beispiel" }, birthDate: "1961-03-12" }, documentType: "lab-result" as const, note: "Unterschenkelfraktur links, OP geplant – bitte aktuelle Gerinnung" };
const jury = { ...maria, patient: { name: { given: ["Anna", "Lena"], family: "Gruber" }, birthDate: "1985-07-04" } };
const fakeLlm = (respond: () => unknown): LlmClient => ({ enabled: true, completeJson: async () => respond() });

describe("rankArchive (ASSIST-1)", () => {
  it("mock ranking for a lab request puts the current clotting panel first", async () => {
    const r = await rankArchive(maria);
    expect(r.source).toBe("mock");
    expect(r.items[0]!.id).toBe("labor-gerinnung-2026-10-22");
    expect(r.items[0]!.importance).toBe("hoch");
    expect(r.items.at(-1)!.id).toBe("rechnung-2026-10");
    expect(r.items.every((i) => i.verified && i.evidence && i.evidence.line > 0)).toBe(true);
  });

  it("mock ranking for a rehab request puts the discharge report first", async () => {
    const r = await rankArchive({ ...maria, documentType: "rehab-discharge-report" });
    expect(r.items[0]!.id).toBe("rehab-entlassungsbericht");
  });

  it("never shows the other patient or the namesake born 1990", async () => {
    const r = await rankArchive(maria);
    expect(r.hiddenOtherPatients).toBe(2);
    expect(r.items.map((i) => i.id)).not.toContain("labor-andere-patientin");
    expect(r.items.map((i) => i.id)).not.toContain("labor-namensgleich");
    expect(archiveDocument(maria, "labor-namensgleich")).toBeUndefined();
    expect(archiveDocument(maria, "labor-andere-patientin")).toBeUndefined();
  });

  it("works for any patient (jury patient)", async () => {
    const r = await rankArchive(jury);
    expect(r.items).toHaveLength(5);
    expect(r.hiddenOtherPatients).toBe(2);
    expect(r.items[0]!.id).toBe("labor-gerinnung-2026-10-22");
    expect(archiveDocument(jury, "labor-gerinnung-2026-10-22")!.content).toContain("Patient: Anna Lena Gruber, born 4 July 1985");
    const { docs } = patientArchive(jury);
    expect(docs.every((d) => belongsToPatient(d.content, jury))).toBe(true);
  });

  it("uses a configured LLM and checks the evidence literally", async () => {
    const llm = fakeLlm(() => ({
      items: [
        { id: "labor-gerinnung-2024-03-05", importance: "hoch", reason: "Test.", evidence: "aPTT | 33" },
        { id: "labor-gerinnung-2026-10-22", importance: "mittel", reason: "Test.", evidence: "INR 0.7 (made up)" },
        { id: "labor-andere-patientin", importance: "hoch", reason: "must be ignored", evidence: "INR" },
      ],
    }));
    const r = await rankArchive(maria, llm, { model: "test-model" });
    expect(r).toMatchObject({ source: "llm", model: "test-model" });
    expect(r.items[0]).toMatchObject({ id: "labor-gerinnung-2024-03-05", verified: true, evidence: { text: "aPTT | 33" } });
    expect(r.items[1]).toMatchObject({ id: "labor-gerinnung-2026-10-22", verified: false });
    expect(r.items[1]!.evidence).toBeUndefined();
    expect(r.items).toHaveLength(5);
    expect(r.items.map((i) => i.id)).not.toContain("labor-andere-patientin");
  });

  it("only sends the request patient's documents to the LLM", async () => {
    let user = "";
    const llm: LlmClient = { enabled: true, completeJson: async (p) => { user = p.user; return { items: [] }; } };
    await rankArchive(maria, llm);
    expect(user).not.toContain("Erika Musterfrau");
    expect(user).not.toContain("born 1 January 1990");
    expect(user).toContain("Unterschenkelfraktur");
  });

  it("falls back to the mock when the LLM throws, times out or answers nonsense", async () => {
    expect((await rankArchive(maria, fakeLlm(() => { throw new Error("boom"); }))).source).toBe("mock");
    expect((await rankArchive(maria, fakeLlm(() => ({ items: "x" })))).source).toBe("mock");
    const slow: LlmClient = { enabled: true, completeJson: () => new Promise(() => {}) };
    const r = await rankArchive(maria, slow, { timeoutMs: 20 });
    expect(r.source).toBe("mock");
    expect(r.items[0]!.id).toBe("labor-gerinnung-2026-10-22");
  });

  it("MockLlmClient does not count as a configured LLM", async () => {
    const mock = new MockLlmClient({ items: [] });
    expect((await rankArchive(maria, mock)).source).toBe("mock");
    expect(mock.calls).toHaveLength(0);
    expect(assistLlm("mock", mock)).toBeUndefined();
    expect(assistLlm("none", fakeLlm(() => ({})))).toBeUndefined();
    expect(assistLlm("anthropic", fakeLlm(() => ({})))).toBeDefined();
  });

  it("caches per request", async () => {
    let n = 0;
    const llm = fakeLlm(() => { n++; return { items: [{ id: "rechnung-2026-10", importance: "hoch", reason: "Test.", evidence: "Total" }] }; });
    const a = await rankArchive(maria, llm, { cacheKey: "req-cache" });
    const b = await rankArchive(maria, llm, { cacheKey: "req-cache" });
    expect(n).toBe(1);
    expect(b).toBe(a);
  });
});

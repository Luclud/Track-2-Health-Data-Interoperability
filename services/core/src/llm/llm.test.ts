import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MemoryFhirStore } from "../fhir/memory-store.ts";
import type { MemorySender } from "../notify/index.ts";
import { identity, labBody, lena, testDeps } from "../domain/testkit.ts";
import { AnthropicLlmClient, MockLlmClient, OpenAiCompatibleLlmClient, createLlmClient, llmParse } from "./index.ts";
import { verifyLlmDocument } from "./verify.ts";

const PROSE = `Laborpraxis Kanalstraße – Befund

Für Frau Maria Beispiel (geb. 12.03.1961), Probe vom 22. Oktober 2026 um 08:10.
Die INR lag bei 1,0 (Norm 0,8–1,2; LOINC 6301-6), die aPTT bei 31 Sekunden (25–37; LOINC 14979-9).
Gez. Dr. Eva Brandl`;

const good = () => ({
  kind: "lab-result",
  title: "Laborpraxis Kanalstraße – Befund",
  organization: "Laborpraxis Kanalstraße",
  patient: { name: { given: ["Maria"], family: "Beispiel" }, birthDate: "1961-03-12" },
  sampleTaken: "2026-10-22T08:10:00+02:00",
  reported: "2026-10-22T08:10:00+02:00",
  values: [
    { testName: "INR", value: 1.0, unitText: "", referenceLow: 0.8, referenceHigh: 1.2, loinc: "6301-6" },
    { testName: "aPTT", value: 31, unitText: "s", referenceLow: 25, referenceHigh: 37, loinc: "14979-9" },
  ],
  validatedBy: { name: { given: ["Eva"], family: "Brandl", prefix: ["Dr."] } },
});

describe("verifyLlmDocument", () => {
  it("accepts a faithful extraction", () => {
    const r = verifyLlmDocument(PROSE, good());
    expect(r).toMatchObject({ ok: true, method: "llm" });
    expect(r.document?.kind === "lab-result" && r.document.values).toHaveLength(2);
  });
  it.each([
    ["hallucinated value", (d: ReturnType<typeof good>) => void (d.values[0]!.value = 1.1), "value 1 1.1 not in source"],
    ["hallucinated range", (d: ReturnType<typeof good>) => void (d.values[1]!.referenceHigh = 40), "reference high 2 40"],
    ["LOINC not in text", (d: ReturnType<typeof good>) => void (d.values[1]!.loinc = "777-3"), "LOINC 777-3 not in source"],
    ["bad check digit", (d: ReturnType<typeof good>) => void (d.values[1]!.loinc = "14979-9".replace("9-9", "9-1")), "LOINC"],
    ["other patient", (d: ReturnType<typeof good>) => void (d.patient.name.given = ["Max"]), "given name Max"],
    ["wrong birth date", (d: ReturnType<typeof good>) => void (d.patient.birthDate = "1960-01-01"), "birth date 1960-01-01 not in source"],
    ["date does not parse", (d: ReturnType<typeof good>) => void (d.sampleTaken = "gestern"), "sample time"],
  ])("rejects %s", (_n, mutate, problem) => {
    const d = good();
    mutate(d);
    const r = verifyLlmDocument(PROSE, d);
    expect(r.ok).toBe(false);
    expect(r.problems.join("; ")).toContain(problem);
  });
  it("rehab: keeps the original markdown", () => {
    const src = "Reha Waldblick Entlassungsbericht für Maria Beispiel, geboren am 12. März 1961.";
    const r = verifyLlmDocument(src, { kind: "rehab-discharge-report", title: "x", organization: "Reha Waldblick", patient: { name: { given: ["Maria"], family: "Beispiel" }, birthDate: "1961-03-12" }, markdown: "fake" });
    expect(r.ok && r.document?.kind === "rehab-discharge-report" && r.document.markdown).toBe(src);
  });
  it("llmParse never throws", async () => {
    const r = await llmParse(new MockLlmClient(() => { throw new Error("boom"); }), PROSE);
    expect(r).toMatchObject({ ok: false, problems: ["LLM failed: boom"] });
  });
});

describe("providers", () => {
  const capture = (response: unknown) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(response));
    }) as unknown as typeof fetch;
    return { calls, f };
  };
  const p = { system: "sys", user: "doc", jsonSchema: { type: "object" }, schemaName: "parsed_document" };

  it("anthropic: forced tool call", async () => {
    const { calls, f } = capture({ content: [{ type: "tool_use", input: { a: 1 } }] });
    expect(await new AnthropicLlmClient("k", "m", undefined, f).completeJson(p)).toEqual({ a: 1 });
    expect(calls[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).toMatchObject({ model: "m", system: "sys", tool_choice: { type: "tool", name: "parsed_document" } });
    expect((calls[0]!.init.headers as Record<string, string>)["x-api-key"]).toBe("k");
  });
  it("openai-compatible / perplexity: json_schema response format", async () => {
    const { calls, f } = capture({ choices: [{ message: { content: '```json\n{"a":2}\n```' } }] });
    expect(await new OpenAiCompatibleLlmClient("https://api.perplexity.ai/", "k", "sonar-pro", f).completeJson(p)).toEqual({ a: 2 });
    expect(calls[0]!.url).toBe("https://api.perplexity.ai/chat/completions");
    expect(JSON.parse(calls[0]!.init.body as string).response_format).toEqual({ type: "json_schema", json_schema: { name: "parsed_document", schema: { type: "object" } } });
  });
  it("createLlmClient", () => {
    const base = testDeps().deps.config;
    expect(createLlmClient({ ...base, llmProvider: "none" }).enabled).toBe(false);
    expect(createLlmClient({ ...base, llmProvider: "mock" }).enabled).toBe(true);
    expect(() => createLlmClient({ ...base, llmProvider: "anthropic", llmApiKey: "" })).toThrow(/LLM_API_KEY/);
  });
});

describe("submitAnswer with LLM fallback (mock)", () => {
  async function answer(llmJson: unknown, content = PROSE) {
    const llm = new MockLlmClient(llmJson);
    const t = testDeps({ llm });
    const { request } = await t.service.createRequest(lena, labBody);
    const token = /\/r\/([A-Za-z0-9_-]+)/.exec((await (t.deps.email as MemorySender).inbox())[0]!.body)![1]!;
    const id = identity("eva-brandl");
    await t.service.completeIdentityCheck(token, id, {});
    const out = await t.service.submitAnswer(token, id, { patientGiven: "Maria", patientFamily: "Beispiel", patientBirthDate: "1961-03-12", content }, {});
    return { ...t, out, request, llm };
  }
  it("correct extraction → held (ai-extracted), nothing filed", async () => {
    const { out, deps, request, llm } = await answer(good());
    expect(out).toEqual({ result: "held", reason: "ai-extracted" });
    expect(llm.calls).toHaveLength(1);
    expect((deps.fhir as MemoryFhirStore).transactions).toHaveLength(0);
    expect(await deps.repo.byId(request.id)).toMatchObject({ status: "held", heldReason: "ai-extracted" });
    expect((await deps.chat.list(labBody.roomId)).at(-1)!.body).toContain("KI-gelesen – bitte Werte prüfen");
  });
  it("hallucinated value → unreadable, nothing filed", async () => {
    const bad = good();
    bad.values[0]!.value = 1.4;
    const { out, deps } = await answer(bad);
    expect(out).toMatchObject({ result: "rejected", reason: "unreadable" });
    expect((deps.fhir as MemoryFhirStore).transactions).toHaveLength(0);
  });
  it("scenario documents never reach the LLM", async () => {
    const { out, llm } = await answer(good(), readFileSync("scenario/documents/lab-result-maria-beispiel.md", "utf8"));
    expect(out.result).toBe("filed");
    expect(llm.calls).toHaveLength(0);
  });
});

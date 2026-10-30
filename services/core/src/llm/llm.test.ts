import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MemoryFhirStore } from "../fhir/memory-store.ts";
import type { MemorySender } from "../notify/index.ts";
import { identity, labBody, lena, testDeps } from "../domain/testkit.ts";
import { AnthropicLlmClient, DEFAULT_ANTHROPIC_MODEL, MockLlmClient, OpenAiCompatibleLlmClient, createLlmClient, llmParse } from "./index.ts";
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
    ["invented report date", (d: ReturnType<typeof good>) => void (d.reported = "2031-05-05T10:00:00+02:00"), "report date 2031-05-05 not in source"],
    ["missing report time", (d: ReturnType<typeof good>) => void ((d as { reported?: string }).reported = undefined), "report time"],
  ])("rejects %s", (_n, mutate, problem) => {
    const d = good();
    mutate(d);
    const r = verifyLlmDocument(PROSE, d);
    expect(r.ok).toBe(false);
    expect(r.problems.join("; ")).toContain(problem);
  });
  it("rehab: a stay written as one range phrase is backed by the source (V2-AI-3 finding)", () => {
    const src = readFileSync("scenario/documents/rehab-report-maria-beispiel.md", "utf8");
    const doc = { kind: "rehab-discharge-report", title: "x", organization: "x", patient: { name: { given: ["Maria"], family: "Beispiel" }, birthDate: "1961-03-12" } };
    expect(verifyLlmDocument(src, { ...doc, stay: { start: "2026-09-02", end: "2026-09-23" } }).ok).toBe(true);
    expect(verifyLlmDocument(src, { ...doc, stay: { start: "2026-09-03", end: "2026-09-23" } }).ok).toBe(false);
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
  const sequence = (...steps: (number | "timeout" | "network")[]) => {
    const calls: string[] = [];
    const f = (async (url: string) => {
      calls.push(url);
      const step = steps.shift() ?? 200;
      if (step === "timeout") throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
      if (step === "network") throw new TypeError("fetch failed");
      return step === 200 ? new Response(JSON.stringify({ content: [{ type: "tool_use", input: { ok: 1 } }], choices: [{ message: { content: '{"ok":1}' } }] })) : new Response("busy", { status: step });
    }) as unknown as typeof fetch;
    return { calls, f };
  };
  const fast = { retryDelayMs: 0 };

  it("anthropic: default model claude-sonnet-5-5, LLM_MODEL overrides (V2-AI-2)", async () => {
    expect(DEFAULT_ANTHROPIC_MODEL).toBe("claude-sonnet-5-5");
    const { calls, f } = capture({ content: [{ type: "tool_use", input: {} }] });
    await new AnthropicLlmClient("k", undefined, undefined, f).completeJson(p);
    expect(JSON.parse(calls[0]!.init.body as string).model).toBe("claude-sonnet-5-5");
    const base = testDeps().deps.config;
    const { calls: c2, f: f2 } = capture({ content: [{ type: "tool_use", input: {} }] });
    await createLlmClient({ ...base, llmProvider: "anthropic", llmApiKey: "k", llmModel: "claude-x" }, f2).completeJson(p);
    expect(JSON.parse(c2[0]!.init.body as string).model).toBe("claude-x");
  });
  it("20 s timeout signal on every request", async () => {
    const { calls, f } = capture({ content: [{ type: "tool_use", input: {} }] });
    await new AnthropicLlmClient("k", undefined, undefined, f).completeJson(p);
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });
  for (const [label, make] of [
    ["anthropic", (f: typeof fetch) => new AnthropicLlmClient("k", undefined, undefined, f, fast)],
    ["openai-compatible", (f: typeof fetch) => new OpenAiCompatibleLlmClient("http://llm.local", "k", "m", f, fast)],
  ] as const) {
    it(`${label}: one retry on 429, 5xx and timeout, then success`, async () => {
      for (const first of [429, 503, "timeout"] as const) {
        const { calls, f } = sequence(first, 200);
        expect(await make(f).completeJson(p)).toEqual({ ok: 1 });
        expect(calls).toHaveLength(2);
      }
    });
    it(`${label}: gives up after the second failure; no retry on 400 or network errors`, async () => {
      const twice = sequence(500, "timeout");
      await expect(make(twice.f).completeJson(p)).rejects.toThrow(/timeout/);
      expect(twice.calls).toHaveLength(2);
      const bad = sequence(400);
      await expect(make(bad.f).completeJson(p)).rejects.toThrow(/HTTP 400/);
      expect(bad.calls).toHaveLength(1);
      const net = sequence("network");
      await expect(make(net.f).completeJson(p)).rejects.toThrow(/fetch failed/);
      expect(net.calls).toHaveLength(1);
    });
  }
  it("provider failure → friendly not-readable result, nothing thrown", async () => {
    const { f } = sequence(503, 503);
    const r = await llmParse(new AnthropicLlmClient("k", undefined, undefined, f, fast), PROSE);
    expect(r).toMatchObject({ ok: false, method: "llm" });
  });
  it("createLlmClient", () => {
    const base = testDeps().deps.config;
    expect(createLlmClient({ ...base, llmProvider: "none" }).enabled).toBe(false);
    expect(createLlmClient({ ...base, llmProvider: "mock" }).enabled).toBe(true);
    expect(() => createLlmClient({ ...base, llmProvider: "anthropic", llmApiKey: "" })).toThrow(/LLM_API_KEY/);
    expect(() => createLlmClient({ ...base, llmProvider: "openai-compatible", llmApiKey: "", llmBaseUrl: "http://x", llmModel: "m" })).toThrow(/LLM_API_KEY/);
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
  it("provider down (5xx twice) → friendly unreadable answer, nothing filed, no crash (V2-AI-2)", async () => {
    const f = (async () => new Response("overloaded", { status: 529 })) as unknown as typeof fetch;
    const t = testDeps({ llm: new AnthropicLlmClient("k", undefined, undefined, f, { retryDelayMs: 0 }) });
    const { request } = await t.service.createRequest(lena, labBody);
    const token = /\/r\/([A-Za-z0-9_-]+)/.exec((await (t.deps.email as MemorySender).inbox())[0]!.body)![1]!;
    const id = identity("eva-brandl");
    await t.service.completeIdentityCheck(token, id, {});
    const out = await t.service.submitAnswer(token, id, { patientGiven: "Maria", patientFamily: "Beispiel", patientBirthDate: "1961-03-12", content: PROSE }, {});
    expect(out).toMatchObject({ result: "rejected", reason: "unreadable" });
    expect((t.deps.fhir as MemoryFhirStore).transactions).toHaveLength(0);
    expect(await t.deps.repo.byId(request.id)).not.toMatchObject({ status: "filed" });
  });
  it("scenario documents never reach the LLM", async () => {
    const { out, llm } = await answer(good(), readFileSync("scenario/documents/lab-result-maria-beispiel.md", "utf8"));
    expect(out.result).toBe("filed");
    expect(llm.calls).toHaveLength(0);
  });
});

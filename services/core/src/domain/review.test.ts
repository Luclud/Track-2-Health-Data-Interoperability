import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MemorySender } from "../notify/index.ts";
import { MockLlmClient } from "../llm/index.ts";
import { numbersIn } from "../llm/verify.ts";
import { fixture } from "../../../../tests/fixtures/documents/index.ts";
import { FakeRegister, identity, labBody, lena, testDeps } from "./testkit.ts";

const maria = { patientGiven: "Maria", patientFamily: "Beispiel", patientBirthDate: "1961-03-12" };

async function held(content: string, overrides = {}, body = labBody, persona = "eva-brandl") {
  const t = testDeps(overrides);
  const { request } = await t.service.createRequest(lena, body);
  const inbox = await ((body.recipient.channel === "email" ? t.deps.email : t.deps.sms) as MemorySender).inbox();
  const token = /\/r\/([A-Za-z0-9_-]+)/.exec(inbox[0]!.body)![1]!;
  const id = identity(persona);
  await t.service.completeIdentityCheck(token, id, {});
  const out = await t.service.submitAnswer(token, id, { ...maria, content }, {});
  expect(out.result).toBe("held");
  return { ...t, request, detail: (await t.service.detail(request.id))! };
}

describe("held review with evidence (V2-AI-1)", () => {
  it("free-text letter via mock LLM: every value has an evidence line that contains it", async () => {
    const f = fixture("free-text-letter-not-in-format");
    if (f.expected.ok) throw new Error("fixture should not parse");
    const { detail } = await held(f.content, { llm: new MockLlmClient(f.expected.llmDocument) });
    const review = detail.review!;
    expect(review).toMatchObject({ method: "llm", reason: "ai-extracted", sourceText: f.content });
    const lines = review.sourceText.split(/\r?\n/);
    expect(review.values).toHaveLength(4);
    for (const v of review.values!) {
      expect(v.evidence.line).toBeGreaterThan(0);
      expect(lines[v.evidence.line - 1]).toBe(v.evidence.text);
      expect(numbersIn(v.evidence.text)).toContain(v.value);
    }
    expect(review.values!.find((v) => v.loinc === "777-3")!.evidence.text).toContain("Thrombozyten 245");
    expect(review.patient).toMatchObject({ given: ["Maria"], family: "Beispiel", birthDate: "1961-03-12" });
    expect(review.patient.evidence!.text).toContain("geb. 12.03.1961");
    expect(lines[review.patient.evidence!.line - 1]).toBe(review.patient.evidence!.text);
  });

  it("deterministic parse held for the register: evidence is the table row", async () => {
    const doc = readFileSync("scenario/documents/lab-result-maria-beispiel.md", "utf8");
    const { detail } = await held(doc, { register: new FakeRegister({}) });
    const review = detail.review!;
    expect(review).toMatchObject({ method: "deterministic", reason: "not-in-register" });
    const inr = review.values!.find((v) => v.loinc === "6301-6")!;
    expect(inr).toMatchObject({ value: 1, low: 0.8, high: 1.2, unit: "" });
    expect(inr.evidence.text).toBe("| INR (prothrombin time) | 1.0 | | 0.8 to 1.2 | 6301-6 |");
    expect(review.values!.find((v) => v.loinc === "14979-9")!.evidence.text).toContain("| aPTT | 31 |");
    expect(review.patient.evidence!.text).toBe("Patient: Maria Beispiel, born 12 March 1961");
  });

  it("no review once the answer is released or for requests that were never held", async () => {
    const doc = readFileSync("scenario/documents/lab-result-maria-beispiel.md", "utf8");
    const { service, request } = await held(doc, { register: new FakeRegister({}) });
    await service.release(request.id, lena);
    expect((await service.detail(request.id))!.review).toBeUndefined();
  });

  it("CRLF documents: evidence text has no line break", async () => {
    const f = fixture("free-text-letter-not-in-format");
    if (f.expected.ok) throw new Error("fixture should not parse");
    const { detail } = await held(f.content.replace(/\n/g, "\r\n"), { llm: new MockLlmClient(f.expected.llmDocument) });
    for (const v of detail.review!.values!) expect(v.evidence.text).not.toMatch(/[\r\n]/);
  });
});

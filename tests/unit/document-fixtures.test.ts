// Self-consistency of the TEST-2 fixtures: expectations are plausible and literally grounded in the source text.
import { describe, expect, it } from "vitest";
import type { ParsedDocument } from "@brieftaube/shared";
import { loadDocumentFixtures } from "../fixtures/documents/index.ts";

function loincCheckDigitOk(code: string): boolean {
  const m = /^(\d+)-(\d)$/.exec(code);
  if (!m) return false;
  const digits = [...m[1]!].map(Number).reverse();
  let sum = 0;
  digits.forEach((d, i) => {
    if (i % 2 === 0) {
      const x = d * 2;
      sum += Math.floor(x / 10) + (x % 10);
    } else sum += d;
  });
  return (10 - (sum % 10)) % 10 === Number(m[2]);
}

const numberForms = (n: number) => [String(n), n.toFixed(1), n.toFixed(2)];
const appears = (text: string, n: number) => numberForms(n).some((s) => text.includes(s));

function checkGrounded(doc: ParsedDocument, text: string) {
  expect(text).toContain(doc.patient.name.family);
  expect(text).toContain(doc.patient.name.given[0]!);
  expect(doc.patient.birthDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  if (doc.kind === "lab-result") {
    expect(doc.values.length).toBeGreaterThan(0);
    for (const v of doc.values) {
      expect(loincCheckDigitOk(v.loinc), v.loinc).toBe(true);
      expect(text).toContain(v.loinc);
      expect(appears(text, v.value), `${v.testName} ${v.value}`).toBe(true);
      if (v.referenceLow !== undefined) expect(appears(text, v.referenceLow)).toBe(true);
      if (v.referenceHigh !== undefined) expect(appears(text, v.referenceHigh)).toBe(true);
    }
    for (const t of [doc.sampleTaken, doc.reported]) expect(t).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+0[12]:00$/);
  } else {
    expect(doc.markdown).toBe(text);
    if (doc.stay) expect(doc.stay.start < doc.stay.end).toBe(true);
  }
}

const fixtures = loadDocumentFixtures({ includeScenario: true });

describe("document fixtures (TEST-2)", () => {
  it("has at least 8 variants plus the 3 scenario documents", () => {
    expect(fixtures.filter((f) => !f.name.startsWith("scenario/")).length).toBeGreaterThanOrEqual(8);
    expect(fixtures.filter((f) => f.name.startsWith("scenario/"))).toHaveLength(3);
  });

  it("keeps CRLF line endings in the CRLF fixture", () => {
    const f = fixtures.find((x) => x.name === "lab-crlf-line-endings")!;
    expect(f.content.split("\n").every((l, i, a) => i === a.length - 1 || l.endsWith("\r"))).toBe(true);
  });

  for (const f of fixtures) {
    it(`${f.name}: expectation is grounded in the text`, () => {
      const doc = f.expected.ok ? f.expected.document : f.expected.llmDocument;
      if (doc) checkGrounded(doc, f.content);
      if (f.expected.ok && f.expected.document.kind === "lab-result" && f.expected.expectedInterpretation) {
        const computed = f.expected.document.values.map((v) =>
          v.referenceHigh !== undefined && v.value > v.referenceHigh ? "H" : v.referenceLow !== undefined && v.value < v.referenceLow ? "L" : "N",
        );
        expect(computed).toEqual(f.expected.expectedInterpretation);
      }
      expect(f.content).not.toContain("\r\r");
    });
  }
});

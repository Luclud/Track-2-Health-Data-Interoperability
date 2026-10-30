// Self-consistency of the TEST-2 fixtures: expectations are plausible and literally grounded in the source text.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ParsedDocument } from "@brieftaube/shared";
import { loadDocumentFixtures } from "../fixtures/documents/index.ts";
import { createDocumentParser } from "../../services/core/src/parser/index.ts";
import { verifyLlmDocument } from "../../services/core/src/llm/verify.ts";

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

const numberForms = (n: number) => [String(n), n.toFixed(1), n.toFixed(2)].flatMap((x) => [x, x.replace(".", ",")]);
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

  for (const f of fixtures) {
    it(`${f.name}: deterministic parser agrees with ok/document`, () => {
      const r = createDocumentParser().parse(f.content);
      expect(r.ok, r.problems.join("; ")).toBe(f.expected.ok);
      if (f.expected.ok && r.ok) expect(r.document).toEqual(f.expected.document);
    });
  }

  for (const f of fixtures.filter((x) => !x.expected.ok && x.expected.llmDocument)) {
    it(`${f.name}: llmDocument passes the DESIGN.md §3 verification unchanged`, () => {
      const r = verifyLlmDocument(f.content, f.expected.ok ? undefined : f.expected.llmDocument);
      expect(r.problems).toEqual([]);
      expect(r.ok && r.document).toEqual(f.expected.ok ? undefined : f.expected.llmDocument);
    });
  }
});

// Demo panic limits from docs/TASKS-V2.md (V2-CRIT-1), for fixtures whose units match the table.
const PANIC: Record<string, { low?: number; high?: number }> = {
  "6301-6": { high: 4.5 },
  "14979-9": { high: 100 },
  "777-3": { low: 50, high: 1000 },
  "3255-7": { low: 1.0 },
  "2823-3": { low: 2.8, high: 6.2 },
};
const critical = (loinc: string, value: number, limits = PANIC) => {
  const l = limits[loinc];
  return !!l && ((l.low !== undefined && value < l.low) || (l.high !== undefined && value > l.high));
};

describe("v2 fixtures (V2-TEST-1)", () => {
  const byName = (n: string) => fixtures.find((x) => x.name === n);

  it("has the four v2 fixtures", () => {
    for (const n of ["lab-critical-platelets-inr", "lab-prose-letter-de", "lab-bullet-list-de", "rehab-other-headings"]) expect(byName(n), n).toBeDefined();
  });

  it("v2 fixtures use the scenario patient", () => {
    for (const n of ["lab-critical-platelets-inr", "lab-prose-letter-de", "lab-bullet-list-de", "rehab-other-headings"]) {
      const e = byName(n)!.expected;
      const doc = e.ok ? e.document : e.llmDocument!;
      expect(doc.patient).toEqual({ name: { given: ["Maria"], family: "Beispiel" }, birthDate: "1961-03-12" });
    }
  });

  it("the prose letter and the bullet list use decimal commas and are not in the standard format", () => {
    for (const n of ["lab-prose-letter-de", "lab-bullet-list-de"]) {
      const f = byName(n)!;
      expect(f.expected.ok).toBe(false);
      expect(f.content).toContain("1,0");
      expect(f.content).toContain("3,1");
      expect(f.content).not.toMatch(/^\|/m);
    }
    expect(byName("lab-prose-letter-de")!.content).toContain("Die Thrombozyten lagen bei 245 G/l");
  });

  it("expectedCritical lists exactly the values beyond the demo panic limits", () => {
    for (const f of fixtures) {
      if (!f.expected.ok || f.expected.document.kind !== "lab-result") continue;
      const computed = f.expected.document.values.filter((v) => critical(v.loinc, v.value)).map((v) => v.loinc);
      expect(computed, f.name).toEqual(f.expected.expectedCritical ?? []);
    }
    const e = byName("lab-critical-platelets-inr")!.expected;
    expect(e.ok && e.expectedCritical).toEqual(["6301-6", "777-3"]);
  });

  it.skipIf(!existsSync("infra/critical-values.json"))("infra/critical-values.json agrees with the critical fixture (V2-CRIT-1)", () => {
    const table = JSON.parse(readFileSync("infra/critical-values.json", "utf8")) as Record<string, { low?: number; high?: number } | string>;
    const limits = Object.fromEntries(Object.entries(table).filter((x): x is [string, { low?: number; high?: number }] => typeof x[1] === "object"));
    const e = byName("lab-critical-platelets-inr")!.expected;
    if (!e.ok || e.document.kind !== "lab-result") throw new Error("critical fixture must parse");
    expect(e.document.values.filter((v) => critical(v.loinc, v.value, limits)).map((v) => v.loinc)).toEqual(e.expectedCritical);
  });
});

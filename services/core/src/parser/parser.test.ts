import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ParsedLabResult, ParsedRehabReport } from "@brieftaube/shared";
import { createDocumentParser, isValidLoinc, parseDate, parseDateRange, parseDateTime, parsePersonName, parseRange, samePerson } from "./index.ts";

const parser = createDocumentParser();
const scenario = (f: string) => readFileSync(join("scenario/documents", f), "utf8");
const fixture = (f: string) => readFileSync(join("services/core/src/parser/__fixtures__", f), "utf8");

function lab(md: string): ParsedLabResult {
  const r = parser.parse(md);
  expect(r.problems).toEqual([]);
  expect(r.ok).toBe(true);
  expect(r.document?.kind).toBe("lab-result");
  return r.document as ParsedLabResult;
}
function rehab(md: string): ParsedRehabReport {
  const r = parser.parse(md);
  expect(r.problems).toEqual([]);
  expect(r.ok).toBe(true);
  expect(r.document?.kind).toBe("rehab-discharge-report");
  return r.document as ParsedRehabReport;
}

describe("scenario documents", () => {
  it("lab result Maria", () => {
    expect(lab(scenario("lab-result-maria-beispiel.md"))).toEqual({
      kind: "lab-result",
      title: "Labor Kanalstraße: lab report",
      organization: "Labor Kanalstraße",
      patient: { name: { given: ["Maria"], family: "Beispiel" }, birthDate: "1961-03-12" },
      requestedBy: "Dr. Lena Hofer, Klinikum Beispielstadt",
      sampleTaken: "2026-10-22T08:10:00+02:00",
      reported: "2026-10-22T11:40:00+02:00",
      values: [
        { testName: "INR (prothrombin time)", value: 1.0, unitText: "", referenceLow: 0.8, referenceHigh: 1.2, loinc: "6301-6" },
        { testName: "aPTT", value: 31, unitText: "s", referenceLow: 25, referenceHigh: 37, loinc: "14979-9" },
        { testName: "Platelets", value: 245, unitText: "10^9/L", referenceLow: 150, referenceHigh: 400, loinc: "777-3" },
        { testName: "Fibrinogen", value: 3.1, unitText: "g/L", referenceLow: 2.0, referenceHigh: 4.0, loinc: "3255-7" },
      ],
      conclusion: "All values are within the reference range.",
      validatedBy: { name: { prefix: ["Dr."], given: ["Eva"], family: "Brandl" }, role: "lab physician" },
    });
  });

  it("lab result Max (wrong patient for M3)", () => {
    const d = lab(scenario("lab-result-max-beispiel.md"));
    expect(d.patient).toEqual({ name: { given: ["Max"], family: "Beispiel" }, birthDate: "1960-01-01" });
    expect(d.sampleTaken).toBe("2026-10-22T08:25:00+02:00");
    expect(d.values.map((v) => v.value)).toEqual([2.6, 44, 198, 3.4]);
    expect(d.conclusion).toBe("INR and aPTT are raised, as expected under anticoagulation with phenprocoumon.");
  });

  it("rehab report Maria", () => {
    const md = scenario("rehab-report-maria-beispiel.md");
    expect(rehab(md)).toEqual({
      kind: "rehab-discharge-report",
      title: "Reha Waldblick: discharge report",
      organization: "Reha Waldblick",
      patient: { name: { given: ["Maria"], family: "Beispiel" }, birthDate: "1961-03-12" },
      stay: { start: "2026-09-02", end: "2026-09-23" },
      reason: "rehabilitation after a total hip replacement on the left, on 18 August 2026 at Klinikum Beispielstadt",
      writtenBy: { name: { prefix: ["Dr."], given: ["Johanna"], family: "Leitner" }, role: "medical director" },
      sentBy: { name: { given: ["Stefan"], family: "Kern" }, role: "discharge management" },
      markdown: md,
    });
  });
});

describe("variant fixtures", () => {
  it("German month names, decimal commas and CRLF", () => {
    const d = lab(fixture("lab-german-months-crlf.md"));
    expect(d.patient.birthDate).toBe("1961-03-12");
    expect(d.sampleTaken).toBe("2027-01-05T07:45:00+01:00"); // CET in winter
    expect(d.values[0]).toMatchObject({ value: 1.1, referenceLow: 0.8, referenceHigh: 1.2 });
    expect(d.validatedBy?.name.family).toBe("Brandl");
  });

  it("other lab, other LOINC codes, one-sided ranges, en dash", () => {
    const d = lab(fixture("lab-other-lab-high-low.md"));
    expect(d.organization).toBe("Zentrallabor Nordwest");
    expect(d.patient.name).toEqual({ given: ["Johann", "Peter"], family: "Muster" });
    expect(d.values.map((v) => v.loinc)).toEqual(["1988-5", "718-7", "2160-0", "33914-3", "6690-2"]);
    expect(d.values[0]).toEqual({ testName: "CRP", value: 48, unitText: "mg/L", referenceHigh: 5, loinc: "1988-5" });
    expect(d.values[1]).toMatchObject({ referenceLow: 13.5, referenceHigh: 17.5 });
    expect(d.values[3]).toMatchObject({ referenceLow: 60, unitText: "mL/min/1.73m2" });
    expect(d.values[3]?.referenceHigh).toBeUndefined();
    expect(d.validatedBy?.name).toEqual({ prefix: ["Prof.", "Dr."], given: ["Karin"], family: "Huber-Schmid" });
  });

  it("missing Requested by, extra blank lines, columns in another order", () => {
    const d = lab(fixture("lab-no-requested-by-blank-lines-reordered.md"));
    expect(d.requestedBy).toBeUndefined();
    expect(d.patient).toEqual({ name: { given: ["Anna"], family: "Müller" }, birthDate: "1972-11-30" });
    expect(d.values).toEqual([
      { testName: "Glucose", value: 105, unitText: "mg/dL", referenceLow: 70, referenceHigh: 99, loinc: "2345-7" },
      { testName: "Potassium", value: 4.2, unitText: "mmol/L", referenceLow: 3.5, referenceHigh: 5.1, loinc: "2823-3" },
    ]);
    expect(d.conclusion).toBe("Glucose slightly raised.");
  });

  it("unknown unit is kept as written", () => {
    expect(lab(fixture("lab-unknown-unit.md")).values[0]?.unitText).toBe("IU/mL Xa");
  });

  it("rehab report with a cross-month stay", () => {
    const d = rehab(fixture("rehab-cross-month.md"));
    expect(d.stay).toEqual({ start: "2026-09-20", end: "2026-10-11" });
    expect(d.sentBy).toEqual({ name: { given: ["Petra"], family: "Lang" }, role: "discharge management" });
  });

  it("rehab report with a cross-year stay and titles", () => {
    const d = rehab(fixture("rehab-cross-year-german.md"));
    expect(d.patient).toEqual({ name: { given: ["Franz", "Xaver"], family: "Obermayr" }, birthDate: "1949-05-01" });
    expect(d.stay).toEqual({ start: "2026-12-28", end: "2027-01-18" });
    expect(d.writtenBy?.name).toEqual({ prefix: ["Prim.", "Dr."], given: ["Sabine"], family: "Koller" });
    expect(d.sentBy?.name).toEqual({ prefix: ["Mag."], given: ["Lukas"], family: "Fink" });
  });

  it("document not in the format → ok:false (LLM path)", () => {
    const r = parser.parse(fixture("not-in-format.md"));
    expect(r.ok).toBe(false);
    expect(r.problems.length).toBeGreaterThan(0);
  });

  it("invalid LOINC check digit → ok:false", () => {
    const r = parser.parse(fixture("lab-bad-loinc.md"));
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toMatch(/LOINC/);
  });

  it("every fixture in tests/fixtures/documents parses without throwing", () => {
    const dir = "tests/fixtures/documents";
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) {
      expect(() => parser.parse(readFileSync(join(dir, f), "utf8"))).not.toThrow();
    }
  });
});

describe("malformed input never throws", () => {
  const inputs: unknown[] = ["", "   ", "#", "# :", "# X: lab report", "# X: lab report\nPatient: Maria", "|||\n|", "# X: discharge report\nPatient: A B, born 31 February 2020", null, undefined, 42, "# X: lab report\nPatient: A B, born 1 May 2000\n| Test |\n|---|\n| a |"];
  for (const input of inputs) {
    it(JSON.stringify(input) ?? "undefined", () => {
      const r = parser.parse(input as string);
      expect(r.ok).toBe(false);
      expect(r.method).toBe("parser");
    });
  }
});

describe("helpers", () => {
  it("LOINC check digit", () => {
    for (const c of ["6301-6", "14979-9", "777-3", "3255-7", "11502-2", "18842-5", "1988-5", "718-7", "2160-0"]) expect(isValidLoinc(c)).toBe(true);
    for (const c of ["6301-5", "777", "abc-1", ""]) expect(isValidLoinc(c)).toBe(false);
  });
  it("dates", () => {
    expect(parseDate("March 12, 1961")).toEqual({ year: 1961, month: 3, day: 12 });
    expect(parseDate("12.03.1961")).toEqual({ year: 1961, month: 3, day: 12 });
    expect(parseDate("12. Feber 1961")).toEqual({ year: 1961, month: 2, day: 12 });
    expect(parseDate("30 February 2020")).toBeUndefined();
    expect(parseDateTime("29 March 2026, 03:30")).toBe("2026-03-29T03:30:00+02:00");
    expect(parseDateTime("22.10.2026 08:10")).toBe("2026-10-22T08:10:00+02:00");
    expect(parseDateRange("2. bis 23. September 2026")).toEqual({ start: "2026-09-02", end: "2026-09-23" });
    expect(parseDateRange("02.09.2026 - 23.09.2026")).toEqual({ start: "2026-09-02", end: "2026-09-23" });
    expect(parseDateRange("23 to 2 September 2026")).toBeUndefined();
  });
  it("ranges", () => {
    expect(parseRange("0.8 to 1.2")).toEqual({ low: 0.8, high: 1.2 });
    expect(parseRange("0.8–1.2")).toEqual({ low: 0.8, high: 1.2 });
    expect(parseRange("<5")).toEqual({ high: 5 });
    expect(parseRange(">60")).toEqual({ low: 60 });
    expect(parseRange("")).toEqual({});
    expect(parseRange("normal")).toBeUndefined();
  });
  it("names", () => {
    expect(parsePersonName("Dr. Eva Brandl")).toEqual({ prefix: ["Dr."], given: ["Eva"], family: "Brandl" });
    expect(parsePersonName("Univ.-Prof. Dr. Eva Maria Brandl")).toEqual({ prefix: ["Univ.-Prof.", "Dr."], given: ["Eva", "Maria"], family: "Brandl" });
    expect(samePerson(parsePersonName("Dr. Eva Brandl"), { given: ["Eva"], family: "Brandl" })).toBe(true);
    expect(samePerson(parsePersonName("eva brändl"), { given: ["Eva"], family: "Brandl" })).toBe(true);
    expect(samePerson(parsePersonName("Dr. Thomas Gruber"), { given: ["Eva"], family: "Brandl" })).toBe(false);
  });
});

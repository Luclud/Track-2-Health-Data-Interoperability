import { describe, expect, it } from "vitest";
import { outcomesFromReport, summarise } from "../../scripts/validate-fhir.ts";

const FILE_EXT = "http://hl7.org/fhir/StructureDefinition/operationoutcome-file";

function oo(file: string, severities: string[]) {
  return {
    resourceType: "OperationOutcome",
    extension: [{ url: FILE_EXT, valueString: file }],
    issue: severities.map((severity) => ({ severity, code: "processing", details: { text: `${severity} here` }, expression: ["X.y"] })),
  };
}

describe("validate-fhir report parsing", () => {
  it("reads a single OperationOutcome (one file)", () => {
    const out = outcomesFromReport(oo("a.json", ["warning"]));
    expect(out).toHaveLength(1);
    expect(summarise(out[0]!)).toMatchObject({ file: "a.json", errors: 0, warnings: 1 });
  });

  it("reads a Bundle of OperationOutcomes and counts fatal as error", () => {
    const bundle = { resourceType: "Bundle", type: "collection", entry: [{ resource: oo("a.json", ["error", "warning"]) }, { resource: oo("b.json", ["fatal", "information"]) }] };
    const results = outcomesFromReport(bundle).map(summarise);
    expect(results.map((r) => [r.file, r.errors, r.warnings, r.information])).toEqual([
      ["a.json", 1, 1, 0],
      ["b.json", 1, 0, 1],
    ]);
    expect(results[0]!.issues[0]).toEqual({ severity: "error", where: "X.y", message: "error here" });
  });

  it("returns nothing for unexpected input", () => {
    expect(outcomesFromReport({ resourceType: "Patient" })).toEqual([]);
    expect(outcomesFromReport(null)).toEqual([]);
  });
});

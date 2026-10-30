// JSON schema for LLM extraction: the same shape as ParsedDocument (packages/shared/src/domain.ts).
const name = {
  type: "object",
  properties: {
    given: { type: "array", items: { type: "string" } },
    family: { type: "string" },
    prefix: { type: "array", items: { type: "string" } },
  },
  required: ["given", "family"],
  additionalProperties: false,
};
const person = { type: "object", properties: { name, role: { type: "string" } }, required: ["name"], additionalProperties: false };

export const PARSED_DOCUMENT_SCHEMA_NAME = "parsed_document";

export const PARSED_DOCUMENT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["lab-result", "rehab-discharge-report"] },
    title: { type: "string" },
    organization: { type: "string" },
    patient: {
      type: "object",
      properties: { name, birthDate: { type: "string", description: "YYYY-MM-DD" } },
      required: ["name", "birthDate"],
      additionalProperties: false,
    },
    requestedBy: { type: "string" },
    sampleTaken: { type: "string", description: "ISO 8601 with offset, Europe/Vienna (lab only)" },
    reported: { type: "string", description: "ISO 8601 with offset, Europe/Vienna (lab only)" },
    values: {
      type: "array",
      description: "lab only",
      items: {
        type: "object",
        properties: {
          testName: { type: "string" },
          value: { type: "number" },
          unitText: { type: "string", description: 'unit exactly as written, "" if none' },
          referenceLow: { type: "number" },
          referenceHigh: { type: "number" },
          loinc: { type: "string" },
        },
        required: ["testName", "value", "unitText", "loinc"],
        additionalProperties: false,
      },
    },
    conclusion: { type: "string" },
    validatedBy: person,
    stay: {
      type: "object",
      description: "rehab only, YYYY-MM-DD",
      properties: { start: { type: "string" }, end: { type: "string" } },
      required: ["start", "end"],
      additionalProperties: false,
    },
    reason: { type: "string" },
    writtenBy: person,
    sentBy: person,
  },
  required: ["kind", "title", "organization", "patient"],
  additionalProperties: false,
};

export const EXTRACTION_SYSTEM_PROMPT = [
  "You extract structured data from a medical document (synthetic test data).",
  "Return only JSON matching the schema. Copy every number, reference-range bound and LOINC code exactly as written.",
  "Never guess, compute or add values that are not literally in the document; omit fields you cannot find.",
  'kind: "lab-result" for lab reports, "rehab-discharge-report" for rehabilitation discharge reports.',
  "Dates of birth and stays as YYYY-MM-DD; sample/report times as ISO 8601 with the Europe/Vienna offset.",
].join("\n");

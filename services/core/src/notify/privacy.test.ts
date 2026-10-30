import { describe, expect, it } from "vitest";
import { findPrivacyLeaks } from "./privacy.ts";

const patient = { name: { given: ["Maria"], family: "Beispiel" }, birthDate: "1961-03-12" };

describe("notification privacy guard", () => {
  it("accepts a neutral email that names only requester and recipient", () => {
    const text =
      "Guten Tag Dr. Eva Brandl,\n\nDr. Lena Hofer (Klinikum Beispielstadt) hat Ihnen eine sichere Anfrage gesendet.\n" +
      "Referenz: BT-7K2Q\nÖffnen: http://localhost:3000/r/abc123\nGültig bis 02.11.2026 03:00.";
    expect(findPrivacyLeaks(text, { patient, documentType: "lab-result", recipientAddress: "eva.brandl@labor-kanal.example" })).toEqual([]);
  });

  it("ignores words inside the recipient address", () => {
    const text = "An: eva.brandl@labor-kanal.example — sichere Anfrage BT-7K2Q";
    expect(findPrivacyLeaks(text, { patient, documentType: "lab-result", recipientAddress: "eva.brandl@labor-kanal.example" })).toEqual([]);
  });

  it.each([
    ["patient-name", "Anfrage zu Maria"],
    ["patient-name", "Anfrage zu Frau BEISPIEL"],
    ["birth-date", "geb. 12.03.1961"],
    ["birth-date", "born 12 March 1961"],
    ["birth-date", "1961-03-12"],
    ["document-type", "Bitte senden Sie den Laborbefund"],
    ["document-type", "Reha-Entlassungsbericht angefordert"],
  ])("flags %s in %j", (kind, text) => {
    const docType = text.includes("Reha") ? "rehab-discharge-report" : "lab-result";
    const findings = findPrivacyLeaks(text, { patient, documentType: docType });
    expect(findings.map((f) => f.kind)).toContain(kind);
  });
});

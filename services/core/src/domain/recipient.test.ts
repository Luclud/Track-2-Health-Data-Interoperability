import { describe, expect, it } from "vitest";
import { checkRecipientAddress } from "./recipient.ts";
import { labBody, lena, testDeps } from "./testkit.ts";

const codes = (w: { code: string }[]) => w.map((x) => x.code).sort();
const eva = (address: string, known: string[] = []) => checkRecipientAddress({ channel: "email", address, displayName: "Dr. Eva Brandl" }, known);

describe("checkRecipientAddress", () => {
  it("labor-kanaI.example (M1) warns", () => {
    const w = eva("eva.brandl@labor-kanaI.example");
    expect(codes(w)).toEqual(["confusable-characters", "unknown-contact", "uppercase-in-address"]);
    expect(w.find((x) => x.code === "confusable-characters")!.message).toContain("„I“ (großes i) und „l“ (kleines L)");
  });
  it("correct known address: no warnings", () => {
    expect(eva("eva.brandl@labor-kanal.example", ["Eva.Brandl@labor-kanal.example"])).toEqual([]);
  });
  it("Cyrillic look-alike", () => {
    const w = eva("eva.brandl@l\u0430bor-kanal.example", ["eva.brandl@labor-kanal.example"]);
    expect(codes(w)).toEqual(["confusable-characters", "unknown-contact"]);
    expect(w[0]!.message).toContain("anderen Schriftsystem");
  });
  it("name not in address", () => {
    expect(codes(eva("office@labor-kanal.example", ["office@labor-kanal.example"]))).toEqual(["name-not-in-address"]);
    expect(eva("brändl.eva@labor-kanal.example", ["brändl.eva@labor-kanal.example"]).map((x) => x.code)).toEqual(["confusable-characters"]);
  });
  it("invalid formats and SMS", () => {
    expect(codes(eva("eva.brandl(at)labor"))).toEqual(["invalid-format"]);
    expect(codes(checkRecipientAddress({ channel: "sms", address: "hallo", displayName: "Stefan Kern" }, []))).toEqual(["invalid-format"]);
    expect(checkRecipientAddress({ channel: "sms", address: "+43 660 000 0101", displayName: "Stefan Kern" }, ["+436600000101"])).toEqual([]);
  });
});

describe("RequestService.checkRecipient", () => {
  it("knows previously used addresses and FHIR directory telecoms", async () => {
    const { deps, service } = testDeps();
    const body = { channel: "email" as const, address: "eva.brandl@labor-kanal.example", displayName: "Dr. Eva Brandl" };
    expect(codes(await service.checkRecipient(lena, body))).toEqual(["unknown-contact"]);
    await deps.fhir.upsert({ resourceType: "Practitioner", id: "p1", telecom: [{ system: "email", value: "stefan.kern@reha-waldblick.example" }] });
    expect(await service.checkRecipient(lena, { channel: "email", address: "stefan.kern@reha-waldblick.example", displayName: "Stefan Kern" })).toEqual([]);
    await service.createRequest(lena, labBody);
    expect(await service.checkRecipient(lena, body)).toEqual([]);
  });
});

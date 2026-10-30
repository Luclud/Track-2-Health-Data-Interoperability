import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MemorySender } from "../notify/index.ts";
import { guessDocumentType } from "./interpret.ts";
import { identity, labBody, lena, testDeps } from "./testkit.ts";

const doc = (f: string) => readFileSync(`scenario/documents/${f}`, "utf8");
const tokenFrom = (text: string) => /\/r\/([A-Za-z0-9_-]+)/.exec(text)![1]!;
const maria = { patientGiven: "Maria", patientFamily: "Beispiel", patientBirthDate: "1961-03-12" };
const { documentType: _t, ...freeBody } = labBody;

describe("free-text requests (no document type picked by the doctor)", () => {
  it("guesses a first type from the text", () => {
    expect(guessDocumentType("Unterschenkelfraktur links – Gerinnung vor OP")).toBe("lab-result");
    expect(guessDocumentType("Entlassungsbrief nach der Reha bitte")).toBe("rehab-discharge-report");
  });

  it("the sender chooses: a different document type than guessed is filed, not rejected", async () => {
    const t = testDeps();
    const { request } = await t.service.createRequest(lena, { ...freeBody, note: "Unterschenkelfraktur links – Gerinnung vor OP" });
    expect(request).toMatchObject({ freeText: true, documentType: "lab-result" });
    const mail = (await (t.deps.email as MemorySender).inbox())[0]!;
    expect(mail.body).not.toContain("Gerinnung");
    const token = tokenFrom(mail.body);
    await t.service.openLink(token, {});
    const id = identity("eva-brandl");
    const check = await t.service.completeIdentityCheck(token, id, {});
    expect(check.view).toMatchObject({ freeText: true, note: "Unterschenkelfraktur links – Gerinnung vor OP" });
    const out = await t.service.submitAnswer(token, id, { ...maria, content: doc("rehab-report-maria-beispiel.md") }, {});
    expect(out.result).toBe("filed");
    const r = (await t.deps.repo.byId(request.id))!;
    expect(r.documentType).toBe("rehab-discharge-report");
    expect(r.filedResources.some((x) => x.startsWith("DocumentReference/"))).toBe(true);
  });

  it("an explicit documentType (API) still rejects the wrong type", async () => {
    const t = testDeps();
    const { request } = await t.service.createRequest(lena, labBody);
    const token = tokenFrom((await (t.deps.email as MemorySender).inbox())[0]!.body);
    await t.service.openLink(token, {});
    const id = identity("eva-brandl");
    await t.service.completeIdentityCheck(token, id, {});
    const out = await t.service.submitAnswer(token, id, { ...maria, content: doc("rehab-report-maria-beispiel.md") }, {});
    expect(out).toMatchObject({ result: "rejected", reason: "wrong-document-type" });
    expect((await t.deps.repo.byId(request.id))!.documentType).toBe("lab-result");
  });
});

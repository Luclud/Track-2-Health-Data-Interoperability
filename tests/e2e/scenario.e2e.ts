// TEST-3: the challenge scenario end-to-end against the RUNNING stack (scenario/README.md + scenario/misdelivery.md).
//   npm run stack:up && npm run seed && npm run dev   then   npm run e2e
// Skipped automatically when the core is not reachable at PUBLIC_BASE_URL/health.
// Writes out/e2e-results.json (read by scripts/metrics.ts, TEST-5).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import type { AuditEntry, DocumentRequestView } from "@brieftaube/shared";
import { AUDIT_STEPS } from "@brieftaube/shared";
import { assertNotificationIsClean } from "../../services/core/src/notify/privacy.ts";
import {
  chatMessageMatching,
  coreApi,
  fhirRead,
  fhirSearch,
  isCoreUp,
  labRequest,
  linkIn,
  mailFor,
  PATIENT_ID,
  poll,
  rehabRequest,
  smsFor,
} from "./lib/stack.ts";
import { OutsidePerson, text } from "./lib/portal.ts";

const up = await isCoreUp();
if (!up) console.warn("[e2e] core not reachable at /health — scenario e2e skipped");

const doc = (f: string) => readFileSync(`scenario/documents/${f}`, "utf8");
const LAB_MARIA = doc("lab-result-maria-beispiel.md");
const LAB_MAX = doc("lab-result-max-beispiel.md");
const REHAB_MARIA = doc("rehab-report-maria-beispiel.md");
const MARIA = { name: { given: ["Maria"], family: "Beispiel" }, birthDate: "1961-03-12" };
const EVA = "eva.brandl@labor-kanal.example";
const EVA_TYPO = "eva.brandl@labor-kanaI.example";

/** Nothing about the patient or the document type may be visible. */
function expectNoPatientData(pageText: string) {
  expect(pageText).not.toMatch(/\bMaria\b/);
  expect(pageText).not.toMatch(/\bBeispiel\b/);
  expect(pageText).not.toMatch(/1961|12\.0?3\.|12 (March|März)/);
  expect(pageText).not.toMatch(/Laborbefund|Gerinnung|Entlassungsbericht|Reha-Entlassung/i);
}

function expectAuditEntryComplete(e: AuditEntry) {
  expect(Number.isNaN(Date.parse(e.at)), `audit ${e.step} has a valid 'at'`).toBe(false);
  expect(e.actor.id, `audit ${e.step} has who`).toBeTruthy();
  expect(e.actor.display, `audit ${e.step} has who (display)`).toBeTruthy();
  expect(e.what, `audit ${e.step} has what`).toBeTruthy();
}

const misdelivery = (audit: AuditEntry[], kind: string) =>
  audit.filter((e) => e.step === "misdelivery-caught" && (e.details?.misdelivery === kind || JSON.stringify(e.details ?? {}).includes(kind) || e.what.toLowerCase().includes(kind.replace("-", " "))));

async function waitForStatus(id: string, pred: (r: DocumentRequestView) => boolean, what: string) {
  return poll(what, async () => {
    const d = await coreApi.detail(id);
    return pred(d.request) ? d : undefined;
  });
}

const results: Record<string, unknown> = { at: new Date().toISOString(), core: process.env.PUBLIC_BASE_URL ?? "http://localhost:3000" };
afterAll(() => {
  if (!up) return;
  mkdirSync("out", { recursive: true });
  writeFileSync("out/e2e-results.json", JSON.stringify(results, null, 2));
});

describe.skipIf(!up)("scenario request 1 (email) with M2 and M3 on the same request", () => {
  let id = "";
  let reference = "";
  let link = "";
  let eva: OutsidePerson;
  let startedAt = 0;

  it("R1: Dr. Hofer sends the request by email; the email has no patient data", async () => {
    const { request } = await coreApi.createRequest(labRequest(EVA));
    id = request.id;
    reference = request.reference;
    expect(reference).toMatch(/^BT-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(request.status).toBe("sent");

    const mail = await mailFor(reference);
    expect(mail.to).toContain(EVA);
    for (const part of [mail.subject, mail.text, mail.html]) {
      assertNotificationIsClean(part, { patient: MARIA, documentType: "lab-result", recipientAddress: EVA });
    }
    link = linkIn(mail.text).url;
    await chatMessageMatching(`request-sent message for ${reference}`, (b) => b.includes(reference));
    results.R1 = { reference, emailClean: true };
  });

  it("M2: the forwarded link is opened by the colleague (Dr. Thomas Gruber) and blocked", async () => {
    const colleague = new OutsidePerson(link);
    expectNoPatientData(text(await colleague.open()));
    const after = await colleague.loginWithEid({ persona: "thomas-gruber" });
    expectNoPatientData(text(after));
    expect(await colleague.answerForm()).toBeUndefined();
    const forced = await colleague.forceAnswer(LAB_MARIA);
    expect(forced.status === 200 && /gesendet|abgelegt/i.test(text(forced)) && !/nicht/i.test(text(forced))).toBe(false);

    const d = await coreApi.detail(id);
    expect(d.request.status).not.toBe("filed");
    expect(d.request.filedResources).toEqual([]);
    const failed = d.audit.filter((e) => e.step === "identity-checked" && e.outcome === "failure");
    expect(failed.length, "failed identity check in audit").toBeGreaterThanOrEqual(1);
    expect(misdelivery(d.audit, "identity-mismatch").length).toBeGreaterThanOrEqual(1);
    await chatMessageMatching(`⚠ for ${reference} naming Gruber`, (b) => b.includes(reference) && /Gruber|jemand anderer/i.test(b));
    results.M2 = { caught: true, reference };
  });

  it("M3: Dr. Brandl sends Max Beispiel's result; it is rejected and not filed for Maria", async () => {
    eva = new OutsidePerson(link);
    startedAt = Date.now();
    await eva.open();
    const after = await eva.loginWithEid({ persona: "eva-brandl" });
    expect(text(after)).not.toMatch(/nicht bestätigen/i);

    // 1) honest form (Max) + Max document
    await eva.submitAnswer({ given: "Max", family: "Beispiel", birthDate: "1960-01-01", content: LAB_MAX, fileName: "lab-result-max-beispiel.md" });
    let d = await waitForStatus(id, (r) => r.status === "rejected", "request rejected after the Max document");
    expect(d.request.lastProblem).toBe("wrong-patient");
    expect(d.request.filedResources).toEqual([]);

    // 2) form says Maria, but the document is about Max
    await eva.submitAnswer({ given: "Maria", family: "Beispiel", birthDate: "1961-03-12", content: LAB_MAX, fileName: "lab-result-max-beispiel.md" });
    d = await poll("second wrong-patient audit entry", async () => {
      const x = await coreApi.detail(id);
      return misdelivery(x.audit, "wrong-patient").length >= 2 ? x : undefined;
    });
    expect(d.request.status).not.toBe("filed");
    expect(d.request.filedResources).toEqual([]);

    await chatMessageMatching(`🛑 for ${reference} naming Max Beispiel`, (b) => b.includes(reference) && b.includes("Max Beispiel"));
    const inr = await fhirSearch<{ valueQuantity?: { value?: number } }>("Observation", { subject: `Patient/${PATIENT_ID}`, code: "http://loinc.org|6301-6" });
    expect(inr.some((o) => o.valueQuantity?.value === 2.6), "Max's INR 2.6 must not be in Maria's record").toBe(false);
    // Max Beispiel is a real (seeded) patient of the hospital; nothing from this request may land in his record either.
    const maxObs = await fhirSearch<{ valueQuantity?: { value?: number } }>("Observation", { subject: "Patient/max-beispiel", code: "http://loinc.org|6301-6" });
    expect(maxObs.some((o) => o.valueQuantity?.value === 2.6), "nothing is filed for Max").toBe(false);
    results.M3 = { caught: true, reference };
  });

  it("R1: Dr. Brandl answers with Maria's lab result; it is filed as FHIR with Provenance", async () => {
    await eva.submitAnswer({ given: "Maria", family: "Beispiel", birthDate: "1961-03-12", content: LAB_MARIA, fileName: "lab-result-maria-beispiel.md" });
    const d = await waitForStatus(id, (r) => r.status === "filed", "request filed");
    const secondsToFile = (Date.now() - startedAt) / 1000;
    const refs = d.request.filedResources;

    const obsRefs = refs.filter((r) => r.startsWith("Observation/"));
    expect(obsRefs).toHaveLength(4);
    const obs = await Promise.all(obsRefs.map((r) => fhirRead<{ code: { coding: { system: string; code: string }[] }; subject: { reference: string } }>(r)));
    expect(obs.map((o) => o.code.coding.find((c) => c.system === "http://loinc.org")?.code).sort()).toEqual(["14979-9", "3255-7", "6301-6", "777-3"]);
    for (const o of obs) expect(o.subject.reference).toBe(`Patient/${PATIENT_ID}`);

    const drRef = refs.find((r) => r.startsWith("DiagnosticReport/"));
    expect(drRef).toBeDefined();
    const dr = await fhirRead<{ subject: { reference: string }; result?: unknown[] }>(drRef!);
    expect(dr.subject.reference).toBe(`Patient/${PATIENT_ID}`);
    expect(dr.result).toHaveLength(4);

    const provRef = refs.find((r) => r.startsWith("Provenance/"));
    const prov = provRef
      ? [await fhirRead<{ target: { reference: string }[] }>(provRef)]
      : await fhirSearch<{ target: { reference: string }[] }>("Provenance", { target: drRef! });
    expect(prov.length).toBeGreaterThanOrEqual(1);
    expect(prov[0]!.target.map((t) => t.reference)).toContain(drRef);

    await chatMessageMatching(`✅ for ${reference}`, (b) => b.includes(reference) && /abgelegt/i.test(b) && !/nicht abgelegt/i.test(b));

    const steps = new Set(d.audit.map((e) => e.step));
    for (const s of AUDIT_STEPS) expect(steps.has(s), `audit step ${s}`).toBe(true);
    d.audit.forEach(expectAuditEntryComplete);
    results.R1 = { ...(results.R1 as object), filed: true, filedResources: refs, auditSteps: [...steps], secondsFromLoginToFiled: secondsToFile };
  });
});

describe.skipIf(!up)("M1: wrong address (capital I instead of l)", () => {
  it("warns before sending, blocks the stranger and audits the failed identity check", async () => {
    const check = await coreApi.recipientCheck({ channel: "email", address: EVA_TYPO, displayName: "Dr. Eva Brandl" });
    expect(check.warnings.map((w) => w.code)).toEqual(expect.arrayContaining([expect.stringMatching(/uppercase-in-address|confusable-characters/)]));

    const { request } = await coreApi.createRequest(labRequest(EVA_TYPO));
    const mail = await mailFor(request.reference);
    expect(mail.to.map((a) => a.toLowerCase())).toContain(EVA_TYPO.toLowerCase());
    assertNotificationIsClean(`${mail.subject}\n${mail.text}`, { patient: MARIA, documentType: "lab-result", recipientAddress: EVA_TYPO });

    const stranger = new OutsidePerson(linkIn(mail.text).url);
    expectNoPatientData(text(await stranger.open()));
    expectNoPatientData(text(await stranger.loginWithEid({ persona: "ines-fremd" })));
    expect(await stranger.answerForm()).toBeUndefined();
    await stranger.forceAnswer(LAB_MARIA);

    const d = await coreApi.detail(request.id);
    expect(d.request.status).not.toBe("filed");
    expect(d.request.filedResources).toEqual([]);
    const failed = d.audit.filter((e) => e.step === "identity-checked" && e.outcome === "failure");
    expect(failed.length).toBeGreaterThanOrEqual(1);
    failed.forEach(expectAuditEntryComplete);
    expect(misdelivery(d.audit, "identity-mismatch").length).toBeGreaterThanOrEqual(1);
    await chatMessageMatching(`⚠ for ${request.reference}`, (b) => b.includes(request.reference) && /Ines Fremd|jemand anderer/i.test(b));
    results.M1 = { caught: true, reference: request.reference, warnings: check.warnings.map((w) => w.code) };
  });
});

describe.skipIf(!up)("request 2: rehab discharge report by SMS", () => {
  it("SMS has no patient data; Stefan Kern answers; DocumentReference + Provenance are filed", async () => {
    const { request } = await coreApi.createRequest(rehabRequest());
    const sms = await smsFor(request.reference);
    assertNotificationIsClean(sms.body, { patient: MARIA, documentType: "rehab-discharge-report", recipientAddress: sms.to });

    const kern = new OutsidePerson(linkIn(sms.body).url);
    expectNoPatientData(text(await kern.open()));
    const startedAt = Date.now();
    const after = await kern.loginWithEid({ persona: "stefan-kern" });
    expect(text(after)).toMatch(/Maria/);
    await kern.submitAnswer({ given: "Maria", family: "Beispiel", birthDate: "1961-03-12", content: REHAB_MARIA, fileName: "rehab-report-maria-beispiel.md" });
    const d = await waitForStatus(request.id, (r) => r.status === "filed", "rehab request filed");

    const docRef = d.request.filedResources.find((r) => r.startsWith("DocumentReference/"));
    expect(docRef).toBeDefined();
    const dr = await fhirRead<{ subject: { reference: string }; content: { attachment: { data?: string } }[] }>(docRef!);
    expect(dr.subject.reference).toBe(`Patient/${PATIENT_ID}`);
    expect(Buffer.from(dr.content[0]?.attachment.data ?? "", "base64").toString("utf8")).toContain("Reha Waldblick");

    const provRef = d.request.filedResources.find((r) => r.startsWith("Provenance/"));
    const prov = provRef ? [await fhirRead(provRef)] : await fhirSearch("Provenance", { target: docRef! });
    expect(prov.length).toBeGreaterThanOrEqual(1);

    const steps = new Set(d.audit.map((e) => e.step));
    for (const s of ["request-sent", "link-opened", "identity-checked", "answer-sent", "answer-filed"] as const) expect(steps.has(s), `audit step ${s}`).toBe(true);
    d.audit.forEach(expectAuditEntryComplete);
    await chatMessageMatching(`✅ for ${request.reference}`, (b) => b.includes(request.reference) && /abgelegt/i.test(b) && !/nicht abgelegt/i.test(b));
    results.R2 = { reference: request.reference, smsClean: true, filed: true, filedResources: d.request.filedResources, secondsFromLoginToFiled: (Date.now() - startedAt) / 1000 };
  });
});

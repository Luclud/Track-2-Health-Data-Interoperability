// TEST-7: jury robustness against the RUNNING stack. The jury uses OTHER outside people and other
// documents in the same Markdown format (tests/fixtures/documents), some for the wrong patient.
//   npm run stack:up && npm run seed && npm run dev   then   npm run e2e
// Filed resources are exported to out/fhir/jury/ for `npm run validate:fhir`.
import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import type { CreateRequestBody, DocumentRequestView, ParsedDocument, PersonName } from "@brieftaube/shared";
import { loadDocumentFixtures, fixture, type DocumentFixture } from "../fixtures/documents/index.ts";
import { chatMessageMatching, coreApi, fhirRead, isCoreUp, linkIn, mailFor, PATIENT_ID, poll, ROOM_ID } from "./lib/stack.ts";
import { OutsidePerson, text, type Person } from "./lib/portal.ts";

const up = await isCoreUp();
if (!up) console.warn("[e2e] core not reachable at /health — jury e2e skipped");

const MARIA = { given: "Maria", family: "Beispiel", birthDate: "1961-03-12" };
const FREE_BIRTH_DATE = "1978-06-21";
const filed = new Set<string>();

afterAll(async () => {
  if (!up || !filed.size) return;
  mkdirSync("out/fhir/jury", { recursive: true });
  for (const ref of filed) {
    const res = await fhirRead(ref);
    writeFileSync(`out/fhir/jury/${ref.replace("/", "-")}.json`, JSON.stringify(res, null, 2));
  }
});

const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "");
const fullName = (n: PersonName) => [...(n.prefix ?? []), ...n.given, n.family].join(" ");

function expectNoPatientData(pageText: string) {
  expect(pageText).not.toMatch(/\bMaria\b|\bMartina\b|\bBeispiel\b/);
  expect(pageText).not.toMatch(/1961/);
  expect(pageText).not.toMatch(/Laborbefund|Entlassungsbericht|Reha-Entlassung/i);
}

/** The person who sends the document back: the lab's validating physician or the rehab report's author. */
function senderOf(doc: ParsedDocument): PersonName {
  const who = doc.kind === "lab-result" ? doc.validatedBy : doc.writtenBy;
  if (!who) throw new Error(`fixture document has no sender: ${doc.title}`);
  return who.name;
}

function requestFor(doc: ParsedDocument, sender: PersonName, n: number): CreateRequestBody {
  return {
    patientId: PATIENT_ID,
    documentType: doc.kind,
    note: "Bitte um Übermittlung des Dokuments.",
    roomId: ROOM_ID,
    recipient: {
      displayName: fullName(sender),
      role: doc.kind === "lab-result" ? "Laborärztin/Laborarzt" : "Ärztliche Leitung",
      organization: doc.organization,
      isPhysician: doc.kind === "lab-result",
      channel: "email",
      address: `${slug(sender.given[0]!)}.${slug(sender.family)}@jury-${n}.example`,
    },
    acknowledgeWarnings: true,
  };
}

/** The mock eID login for this sender: the seeded persona for Eva Brandl, otherwise "Andere Person" with the same name. */
function eidFor(sender: PersonName, addToRegister: boolean): Person {
  if (sender.given[0] === "Eva" && sender.family === "Brandl") return { persona: "eva-brandl" };
  return { given: sender.given.join(" "), family: sender.family, birthDate: FREE_BIRTH_DATE, ...(addToRegister ? { addToRegister: "1" as const } : {}) };
}

let counter = 0;
const runTag = Array.from({ length: 5 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
async function send(body: CreateRequestBody): Promise<{ id: string; reference: string; person: OutsidePerson }> {
  const { request } = await coreApi.createRequest(body);
  const mail = await mailFor(request.reference);
  return { id: request.id, reference: request.reference, person: new OutsidePerson(linkIn(mail.text).url) };
}

async function waitFor(id: string, pred: (r: DocumentRequestView) => boolean, what: string) {
  return poll(what, async () => {
    const d = await coreApi.detail(id);
    return pred(d.request) ? d : undefined;
  });
}

async function answer(f: DocumentFixture, eid: Person, recipient?: PersonName) {
  const doc = f.expected.ok ? f.expected.document : f.expected.llmDocument;
  if (!doc) throw new Error(`${f.name}: no document in expectation`);
  const sender = recipient ?? senderOf(doc);
  const r = await send(requestFor(doc, sender, ++counter));
  await r.person.open();
  const after = await r.person.loginWithEid(eid);
  expect(text(after), `${f.name}: identity accepted`).not.toMatch(/nicht die angefragte Person|stimmt nicht überein/i);
  const result = await r.person.submitAnswer({ ...MARIA, content: f.content, fileName: `${f.name}.md` });
  expect(result.status, `${f.name}: submit -> ${result.status}`).toBeLessThan(500);
  return { ...r, doc, sender, result };
}

async function expectFiled(f: DocumentFixture, id: string, doc: ParsedDocument) {
  const d = await waitFor(id, (r) => r.status === "filed", `${f.name} filed`);
  const refs = d.request.filedResources;
  refs.forEach((x) => filed.add(x));
  if (doc.kind === "lab-result") {
    expect(refs.filter((x) => x.startsWith("DiagnosticReport/")), `${f.name}: DiagnosticReport`).toHaveLength(1);
    const obs = refs.filter((x) => x.startsWith("Observation/"));
    expect(obs, `${f.name}: one Observation per value`).toHaveLength(doc.values.length);
    const codes = await Promise.all(obs.map(async (o) => (await fhirRead<{ code: { coding: { code: string }[] } }>(o)).code.coding[0]!.code));
    expect(codes.sort()).toEqual(doc.values.map((v) => v.loinc).sort());
  } else {
    expect(refs.filter((x) => x.startsWith("DocumentReference/")), `${f.name}: DocumentReference`).toHaveLength(1);
  }
  expect(refs.some((x) => x.startsWith("Provenance/")), `${f.name}: Provenance`).toBe(true);
  return d;
}

describe.skipIf(!up)("jury 1: new lab physician not in the physician register", () => {
  const f = fixture("lab-without-requested-by"); // Dr. Sophie Aigner, not in infra/mock-register.json
  let id = "";
  let reference = "";
  const UNREGISTERED: PersonName = { prefix: ["Dr."], given: ["Sophie"], family: `Aigner-${runTag}` };

  it("answer is held (not-in-register), nothing is filed, Dr. Hofer gets a chat message", async () => {
    // Unique family name per run: "Andere Person" + addToRegister (jury 3) adds people to the in-memory register for the core's lifetime.
    const r = await answer(f, eidFor(UNREGISTERED, false), UNREGISTERED);
    id = r.id;
    reference = r.reference;
    const d = await waitFor(id, (x) => x.status === "held", "held");
    expect(d.request.heldReason).toBe("not-in-register");
    expect(d.request.filedResources).toEqual([]);
    await chatMessageMatching("held message", (b) => b.includes(reference));
  });

  it("release via API files it", async () => {
    const { request } = await coreApi.release(id);
    expect(request.status).toBe("filed");
    const doc = f.expected.ok ? f.expected.document : undefined;
    const d = await expectFiled(f, id, doc!);
    expect(d.audit.some((e) => e.details?.decision === "released")).toBe(true);
  });
});

describe.skipIf(!up)("jury 2: new rehab sender from another clinic", () => {
  it("rehab report is filed as DocumentReference with the document's author", async () => {
    const f = fixture("rehab-seeblick-cross-month"); // Dr. Klaus Wimmer, Reha Seeblick
    const r = await answer(f, eidFor(senderOf(f.expected.ok ? f.expected.document : (undefined as never)), false));
    const d = await expectFiled(f, r.id, r.doc);
    const docRef = await fhirRead<{ author?: { reference?: string }[]; contained?: unknown[] }>(d.request.filedResources.find((x) => x.startsWith("DocumentReference/"))!);
    const authors = await Promise.all(
      (docRef.author ?? []).filter((a) => a.reference?.startsWith("Practitioner/")).map((a) => fhirRead<{ name?: { family?: string; given?: string[] }[] }>(a.reference!)),
    );
    expect(authors.map((p) => p.name?.[0]?.family)).toContain("Wimmer");
  });
});

describe.skipIf(!up)("jury 3: every fixture document", () => {
  for (const f of loadDocumentFixtures()) {
    it(f.name, async () => {
      const doc = f.expected.ok ? f.expected.document : f.expected.llmDocument!;
      const r = await answer(f, eidFor(senderOf(doc), true));
      if (!f.expected.ok) {
        // Not in the standard format: rejected as unreadable (LLM_PROVIDER=none) or held for review (LLM fallback).
        const d = await waitFor(r.id, (x) => x.status === "rejected" || x.status === "held", "rejected or held");
        expect(d.request.filedResources).toEqual([]);
        if (d.request.status === "held") expect(["ai-extracted", "unreadable"]).toContain(d.request.heldReason);
        else expect(d.audit.some((e) => e.details?.problem === "unreadable")).toBe(true);
        return;
      }
      if (f.expected.document.patient.name.given[0] !== "Maria") {
        const d = await waitFor(r.id, (x) => x.status === "rejected", "rejected as wrong patient");
        expect(d.request.lastProblem).toBe("wrong-patient");
        expect(d.request.filedResources).toEqual([]);
        expect(d.audit.some((e) => e.step === "misdelivery-caught")).toBe(true);
        await chatMessageMatching("wrong-patient message", (b) => b.includes(r.reference));
        return;
      }
      await expectFiled(f, r.id, f.expected.document);
    });
  }
});

describe.skipIf(!up)("jury 4: wrong identity with new people", () => {
  const f = fixture("lab-columns-reordered"); // addressed to Dr. Martin Huber
  for (const intruder of [
    { given: "Paul", family: "Neumann", birthDate: "1990-01-15" },
    { given: "Martina", family: "Huber", birthDate: "1985-09-30" },
  ]) {
    it(`${intruder.given} ${intruder.family} opens Dr. Huber's link: blocked, nothing shown, nothing filed`, async () => {
      const doc = f.expected.ok ? f.expected.document : (undefined as never);
      const r = await send(requestFor(doc, senderOf(doc), ++counter));
      const landing = await r.person.open();
      expectNoPatientData(text(landing));
      const after = await r.person.loginWithEid(intruder);
      expectNoPatientData(text(after));
      expect(await r.person.answerForm(), "no answer form for the wrong person").toBeUndefined();
      const forced = await r.person.forceAnswer(f.content);
      expectNoPatientData(text(forced));
      expect(text(forced)).not.toMatch(/Vielen Dank|wurde (gesendet|übermittelt)/i);
      const d = await waitFor(r.id, (x) => x.status === "identity-failed", "identity-failed");
      expect(d.request.lastProblem).toBe("identity-mismatch");
      expect(d.request.filedResources).toEqual([]);
      await chatMessageMatching("identity mismatch message", (b) => b.includes(r.reference));
    });
  }
});

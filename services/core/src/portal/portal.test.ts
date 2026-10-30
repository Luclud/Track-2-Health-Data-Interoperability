import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import multipart from "@fastify/multipart";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import type { Deps } from "../container.ts";
import { config } from "../config.ts";
import { MockIdAustria } from "../eid/index.ts";
import { registerEidRoutes } from "../eid/routes.ts";
import { MockPhysicianRegister } from "../register/index.ts";
import { FakeRequestService, makeFakeRequest } from "./__fakes__/fake-request-service.ts";
import { registerPortalRoutes } from "./routes.ts";
import { validateAnswer } from "./views.ts";
import { createDocumentParser } from "../parser/index.ts";
import type { ParsedDocument } from "@brieftaube/shared";

const base = "http://localhost:3000";
const labDoc = readFileSync(new URL("../../../../scenario/documents/lab-result-maria-beispiel.md", import.meta.url), "utf8");

let app: FastifyInstance;
let svc: FakeRequestService;

async function build(juryMode = false, senderAssist = false) {
  svc = new FakeRequestService(
    makeFakeRequest(),
    makeFakeRequest({ id: "req-2", token: "tok-old" }, { status: "expired" }),
    makeFakeRequest({ id: "req-3", token: "tok-done" }, { status: "answered" }),
  );
  const deps = {
    config: { ...config, publicBaseUrl: base, eidIssuerUrl: `${base}/mock-eid`, juryMode, senderAssist },
    eid: new MockIdAustria({ eidIssuerUrl: `${base}/mock-eid` }),
    register: new MockPhysicianRegister(),
    requests: svc,
  } as unknown as Deps;
  app = Fastify();
  await app.register(cookie, { secret: "test-secret-0123456789abcdef0123456789" });
  await app.register(formbody);
  await app.register(multipart);
  await registerPortalRoutes(app, deps);
  await registerEidRoutes(app, deps);
}

/** Cookie jar: keeps name=value pairs from Set-Cookie headers. */
class Jar {
  private c = new Map<string, string>();
  take(res: { headers: Record<string, unknown> }) {
    const raw = res.headers["set-cookie"];
    for (const line of ([] as string[]).concat((raw as string[] | string | undefined) ?? [])) {
      const [pair] = line.split(";");
      const i = pair!.indexOf("=");
      const v = pair!.slice(i + 1);
      if (v === "") this.c.delete(pair!.slice(0, i));
      else this.c.set(pair!.slice(0, i), v);
    }
  }
  header() {
    return [...this.c].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

function path(u: string) {
  const x = new URL(u, base);
  return x.pathname + x.search;
}

/** Runs landing -> login -> mock eID persona -> callback. Returns the callback response. */
async function loginAs(persona: string, jar = new Jar(), token = "tok-eva") {
  const login = await app.inject({ url: `/r/${token}/login`, headers: { cookie: jar.header() } });
  jar.take(login);
  expect(login.statusCode).toBe(303);
  const auth = new URL(login.headers.location as string);
  const eid = await app.inject({
    method: "POST", url: "/mock-eid/login",
    payload: new URLSearchParams({ state: auth.searchParams.get("state")!, redirect_uri: auth.searchParams.get("redirect_uri")!, persona }).toString(),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  const cb = await app.inject({ url: path(eid.headers.location as string), headers: { cookie: jar.header() } });
  jar.take(cb);
  return { cb, jar };
}

function multipartBody(fields: Record<string, string>, file?: { name: string; content: string }) {
  const boundary = "----bt" + Math.random().toString(16).slice(2);
  let body = "";
  for (const [k, v] of Object.entries(fields)) body += `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
  body += `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file?.name ?? ""}"\r\nContent-Type: text/markdown\r\n\r\n${file?.content ?? ""}\r\n`;
  body += `--${boundary}--\r\n`;
  return { payload: body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

const maria = { patientGiven: "Maria", patientFamily: "Beispiel", patientBirthDate: "1961-03-12" };

beforeEach(() => build());

describe("portal landing", () => {
  it("shows requester, recipient, reference and expiry — nothing about the patient or document type", async () => {
    const res = await app.inject({ url: "/r/tok-eva", headers: { "user-agent": "vitest" } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Dr. Lena Hofer");
    expect(res.body).toContain("Dr. Eva Brandl");
    expect(res.body).toContain("BT-7K2Q");
    expect(res.body).toContain("02.11.2026");
    expect(res.body).toContain("Mit e-ID anmelden (simuliert)");
    for (const leak of ["Maria", "1961", "Labor", "Gerinnung", "Befund"]) expect(res.body).not.toContain(leak);
    expect(res.body).not.toMatch(/Beispiel(?!stadt)/);
    const meta = svc.calls[0]!.args[1] as { ipHash: string; userAgent: string };
    expect(meta.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(meta.userAgent).toBe("vitest");
  });

  it("unknown, expired and answered links", async () => {
    expect((await app.inject({ url: "/r/nope" })).statusCode).toBe(404);
    const old = await app.inject({ url: "/r/tok-old" });
    expect(old.statusCode).toBe(410);
    expect(old.body).toContain("abgelaufen");
    expect((await app.inject({ url: "/r/tok-done" })).body).toContain("bereits beantwortet");
  });

  it("serves the CSS", async () => {
    const res = await app.inject({ url: "/r/static/portal.css" });
    expect(res.headers["content-type"]).toContain("text/css");
  });
});

describe("identity check", () => {
  it("landing then login audits link-opened only once", async () => {
    const jar = new Jar();
    const landing = await app.inject({ url: "/r/tok-eva" });
    jar.take(landing);
    const login = await app.inject({ url: "/r/tok-eva/login", headers: { cookie: jar.header() } });
    expect(login.statusCode).toBe(303);
    expect(new URL(login.headers.location as string).pathname).toBe("/mock-eid/authorize");
    expect(svc.calls.filter((c) => c.method === "openLink")).toHaveLength(1);
  });

  it("redirects to the mock eID with state and callback", async () => {
    const res = await app.inject({ url: "/r/tok-eva/login" });
    const u = new URL(res.headers.location as string);
    expect(u.pathname).toBe("/mock-eid/authorize");
    expect(u.searchParams.get("redirect_uri")).toBe(`${base}/r/tok-eva/callback`);
    expect(String(res.headers["set-cookie"])).toMatch(/bt_state=.*HttpOnly/);
  });

  it("wrong person (M2 Thomas Gruber) sees nothing and cannot open the form", async () => {
    const { cb, jar } = await loginAs("thomas-gruber");
    expect(cb.statusCode).toBe(403);
    expect(cb.body).toContain("Wir konnten nicht bestätigen, dass Sie Dr. Eva Brandl sind");
    expect(cb.body).toContain("Dr. Lena Hofer wurde informiert");
    expect(cb.body).toContain('href="/r/tok-eva/login"'); // the right person can still log in
    for (const leak of ["Maria", "1961", "Laborbefund"]) expect(cb.body).not.toContain(leak);
    expect(cb.body).not.toMatch(/Beispiel(?!stadt)/);
    const form = await app.inject({ url: "/r/tok-eva/answer", headers: { cookie: jar.header() } });
    expect(form.statusCode).toBe(303);
    expect(form.headers.location).toBe("/r/tok-eva");
  });

  it("rejects a callback without the matching state cookie", async () => {
    const login = await app.inject({ url: "/r/tok-eva/login" });
    const auth = new URL(login.headers.location as string);
    const cb = await app.inject({ url: `/r/tok-eva/callback?code=x&state=${auth.searchParams.get("state")}` });
    expect(cb.statusCode).toBe(400);
    expect(svc.calls.some((c) => c.method === "completeIdentityCheck")).toBe(false);
  });

  it("right person gets a signed session and sees patient + document type", async () => {
    const { cb, jar } = await loginAs("eva-brandl");
    expect(cb.statusCode).toBe(303);
    expect(String(cb.headers["set-cookie"])).toMatch(/bt_session=[^;]+\.[^;]+;.*HttpOnly/);
    const form = await app.inject({ url: "/r/tok-eva/answer", headers: { cookie: jar.header() } });
    expect(form.statusCode).toBe(200);
    expect(form.body).toContain("Maria Beispiel, geb. 12.03.1961");
    expect(form.body).toContain("Laborbefund");
    expect(form.body).toContain("Bitte Gerinnung vor dem Eingriff.");
    expect(form.body).toContain('type="date"');
    expect(form.body).toContain('type="file"');
    expect(form.body).not.toContain('value="Maria"'); // the responder types the patient, it is not prefilled
  });

  it("a session cookie for one token does not open another", async () => {
    const { jar } = await loginAs("eva-brandl");
    const other = await app.inject({ url: "/r/tok-old/answer", headers: { cookie: jar.header() } });
    expect(other.statusCode).toBe(303);
  });
});

describe("answer", () => {
  it("file upload -> filed", async () => {
    const { jar } = await loginAs("eva-brandl");
    const res = await app.inject({ method: "POST", url: "/r/tok-eva/answer", ...withCookie(multipartBody(maria, { name: "lab-result-maria-beispiel.md", content: labDoc }), jar) });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Vielen Dank – gesendet!");
    const call = svc.calls.find((c) => c.method === "submitAnswer")!;
    expect(call.args[2]).toMatchObject({ ...maria, fileName: "lab-result-maria-beispiel.md" });
    expect((call.args[2] as { content: string }).content).toContain("Maria Beispiel");
    expect((call.args[1] as { name: { family: string } }).name.family).toBe("Brandl");
    // session ends after sending
    const again = await app.inject({ url: "/r/tok-eva/answer", headers: { cookie: jar.header() } });
    expect(again.statusCode).toBe(303);
  });

  it("pasted text -> held page", async () => {
    const { jar } = await loginAs("eva-brandl");
    svc.nextOutcome = { result: "held", reason: "not-in-register" };
    const res = await app.inject({ method: "POST", url: "/r/tok-eva/answer", ...withCookie(multipartBody({ ...maria, content: labDoc }), jar) });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("noch kurz geprüft");
  });

  describe("receipt (V2-RCPT-1)", () => {
    const receiptOf = (body: string) => body.match(/<section class="receipt"[\s\S]*?<\/section>/)?.[0] ?? "";
    const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

    it("filed: reference, Vienna time, verified sender, SHA-256 of the uploaded text, print button", async () => {
      const { jar } = await loginAs("eva-brandl");
      const res = await app.inject({ method: "POST", url: "/r/tok-eva/answer", ...withCookie(multipartBody(maria, { name: "lab.md", content: labDoc }), jar) });
      const r = receiptOf(res.body);
      expect(r).toContain("Eingangsbestätigung");
      expect(r).toContain(makeFakeRequest().view.reference);
      expect(r).toMatch(/\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2} Uhr/);
      expect(r).toContain("Brandl");
      const full = sha(labDoc);
      expect(r).toContain(`<code>${full.slice(0, 16)}</code>`);
      expect(r).toMatch(new RegExp(`<details>[\\s\\S]*${full}[\\s\\S]*</details>`));
      expect(r).toContain('onclick="window.print()"');
      expect(r).toContain("Bestätigung drucken / als PDF speichern");
    });

    it("held: hash of pasted text (BOM stripped, as submitted); no medical or patient content", async () => {
      const { jar } = await loginAs("eva-brandl");
      svc.nextOutcome = { result: "held", reason: "not-in-register" };
      const res = await app.inject({ method: "POST", url: "/r/tok-eva/answer", ...withCookie(multipartBody({ ...maria, content: labDoc }), jar) });
      const r = receiptOf(res.body);
      const submitted = (svc.calls.find((c) => c.method === "submitAnswer")!.args[2] as { content: string }).content;
      expect(r).toContain(sha(submitted).slice(0, 16));
      for (const word of ["Maria", "1961", "12.03.", "Laborbefund", "Befund", "Rehab", "Hämoglobin", "mg/dl"]) expect(r).not.toContain(word);
    });

    it("print stylesheet shows only the receipt", async () => {
      const css = (await app.inject({ url: "/r/static/portal.css" })).body;
      expect(css).toMatch(/@media print\{.*body \*\{visibility:hidden\}/);
      expect(css).toContain(".receipt,.receipt *{visibility:visible}");
    });
  });

  it("wrong patient (M3) -> friendly rejection, form again, session kept", async () => {
    const { jar } = await loginAs("eva-brandl");
    const res = await app.inject({ method: "POST", url: "/r/tok-eva/answer", ...withCookie(multipartBody({ patientGiven: "Max", patientFamily: "Beispiel", patientBirthDate: "1960-01-01", content: "# x" }), jar) });
    expect(res.statusCode).toBe(422);
    expect(res.body).toContain("nicht übernommen");
    expect(res.body).toContain("andere Person");
    expect(res.body).toContain('value="Max"');
    const retry = await app.inject({ method: "POST", url: "/r/tok-eva/answer", ...withCookie(multipartBody(maria, { name: "a.md", content: labDoc }), jar) });
    expect(retry.body).toContain("Vielen Dank");
  });

  it("validation errors re-render the form without calling the service", async () => {
    const { jar } = await loginAs("eva-brandl");
    const res = await app.inject({ method: "POST", url: "/r/tok-eva/answer", ...withCookie(multipartBody({ patientGiven: "<script>", patientFamily: "", patientBirthDate: "" }), jar) });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("Bitte geben Sie den Nachnamen ein.");
    expect(res.body).toContain('<a href="#patientFamily">');
    expect(res.body).toContain('aria-describedby="patientFamily-error"');
    expect(res.body).toContain("Bitte laden Sie eine Datei hoch");
    expect(res.body).toContain('value="&lt;script&gt;"');
    expect(svc.calls.some((c) => c.method === "submitAnswer")).toBe(false);
  });

  it("POST without a session goes back to the landing page", async () => {
    const res = await app.inject({ method: "POST", url: "/r/tok-eva/answer", ...multipartBody(maria) });
    expect(res.statusCode).toBe(303);
    expect(svc.calls.some((c) => c.method === "submitAnswer")).toBe(false);
  });

  it("a service error shows a German error page", async () => {
    const { jar } = await loginAs("eva-brandl");
    svc.submitAnswer = async () => { throw new Error("boom"); };
    const res = await app.inject({ method: "POST", url: "/r/tok-eva/answer", ...withCookie(multipartBody({ ...maria, content: "# x" }), jar) });
    expect(res.statusCode).toBe(500);
    expect(res.body).toContain("Etwas ist schiefgelaufen");
  });
});

describe("jury demo buttons (V2-JURY-2)", () => {
  const SAMPLE = "Beispielbefund einsetzen (Demo)";
  const WRONG = "Beispiel: falsche Patientin (Demo)";
  const textarea = (body: string) => {
    const m = /<textarea[^>]*>([\s\S]*?)<\/textarea>/.exec(body);
    return (m?.[1] ?? "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  };
  const parsedPatient = (md: string) => {
    const r = createDocumentParser().parse(md);
    expect(r.ok).toBe(true);
    return (r.document as ParsedDocument).patient;
  };

  it("are absent by default, also when ?demo= is forced", async () => {
    const { jar } = await loginAs("eva-brandl");
    const form = await app.inject({ url: "/r/tok-eva/answer", headers: { cookie: jar.header() } });
    expect(form.body).not.toContain(SAMPLE);
    expect(form.body).not.toContain(WRONG);
    expect(form.body).not.toContain("demo=");
    const forced = await app.inject({ url: "/r/tok-eva/answer?demo=beispiel", headers: { cookie: jar.header() } });
    expect(textarea(forced.body)).toBe("");
    expect(forced.body).not.toContain('value="Maria"');
  });

  it("are present in jury mode and clearly labelled Demo", async () => {
    await build(true);
    const { jar } = await loginAs("eva-brandl");
    const form = await app.inject({ url: "/r/tok-eva/answer", headers: { cookie: jar.header() } });
    expect(form.body).toContain(SAMPLE);
    expect(form.body).toContain(WRONG);
    expect(form.body).toContain('href="/r/tok-eva/answer?demo=beispiel#content"');
    expect(form.body).not.toContain('value="Maria"'); // nothing prefilled until a demo button is used
  });

  it("the sample parses to the requested patient and is filed", async () => {
    await build(true);
    const { jar } = await loginAs("eva-brandl");
    const res = await app.inject({ url: "/r/tok-eva/answer?demo=beispiel", headers: { cookie: jar.header() } });
    const md = textarea(res.body);
    expect(parsedPatient(md)).toEqual({ name: { given: ["Maria"], family: "Beispiel" }, birthDate: "1961-03-12" });
    expect(md).toBe(labDoc);
    expect(res.body).toContain('value="Maria"');
    expect(res.body).toContain('value="1961-03-12"');
    const sent = await app.inject({ method: "POST", url: "/r/tok-eva/answer", ...withCookie(multipartBody({ ...maria, content: md }), jar) });
    expect(sent.body).toContain("Vielen Dank");
  });

  it("the wrong-patient sample is the Max Beispiel document (M3)", async () => {
    await build(true);
    const { jar } = await loginAs("eva-brandl");
    const res = await app.inject({ url: "/r/tok-eva/answer?demo=falsche-patientin", headers: { cookie: jar.header() } });
    const md = textarea(res.body);
    expect(parsedPatient(md)).toEqual({ name: { given: ["Max"], family: "Beispiel" }, birthDate: "1960-01-01" });
    expect(res.body).toContain('value="Maria"'); // the sender thinks it is Maria's
  });

  it("follows the requested patient and document type", async () => {
    svc = new FakeRequestService();
    const { demoDocument } = await import("./demo.ts");
    const johann = { patient: { name: { given: ["Johann"], family: "Muster" }, birthDate: "1955-07-01" }, documentType: "rehab-discharge-report" as const };
    const r = createDocumentParser().parse(demoDocument("beispiel", johann));
    expect(r.document).toMatchObject({ kind: "rehab-discharge-report", patient: { name: { given: ["Johann"], family: "Muster" }, birthDate: "1955-07-01" } });
    expect(parsedPatient(demoDocument("falsche-patientin", johann)).name.given).toEqual(["Max"]);
    const max = { patient: { name: { given: ["Max"], family: "Beispiel" }, birthDate: "1960-01-01" }, documentType: "lab-result" as const };
    expect(parsedPatient(demoDocument("falsche-patientin", max)).name.given).toEqual(["Maria"]);
  });
});

describe("sender assist (ASSIST-2)", () => {
  const BOX = "KI-Hilfe: passende Dokumente aus meiner Ablage vorschlagen";
  const ids = (body: string) => [...body.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]);
  const textarea = (body: string) =>
    (/<textarea[^>]*>([\s\S]*?)<\/textarea>/.exec(body)?.[1] ?? "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

  it("is off by default: no checkbox, and ?assist=1&pick= changes nothing", async () => {
    const { jar } = await loginAs("eva-brandl");
    const plain = await app.inject({ url: "/r/tok-eva/answer", headers: { cookie: jar.header() } });
    expect(plain.body).not.toContain(BOX);
    expect(plain.body).not.toContain("assist");
    const forced = await app.inject({ url: "/r/tok-eva/answer?assist=1&pick=labor-gerinnung-2026-10-22", headers: { cookie: jar.header() } });
    expect(forced.body).toBe(plain.body);
  });

  it("enabled: checkbox with hint and noscript link above the file input; no list until ticked", async () => {
    await build(false, true);
    const { jar } = await loginAs("eva-brandl");
    const res = await app.inject({ url: "/r/tok-eva/answer", headers: { cookie: jar.header() } });
    expect(res.body).toContain(BOX);
    expect(res.body).toContain("Dokumente verlassen die Praxis erst mit „Sicher senden“.");
    expect(res.body).toContain('data-on="/r/tok-eva/answer?assist=1#assist"');
    expect(res.body).toContain('<noscript><p><a href="/r/tok-eva/answer?assist=1#assist">');
    expect(res.body.indexOf(BOX)).toBeLessThan(res.body.indexOf('id="file"'));
    expect(res.body).not.toContain('id="assist"');
    expect(textarea(res.body)).toBe("");
  });

  it("?assist=1 without a session shows nothing about the patient", async () => {
    await build(false, true);
    const res = await app.inject({ url: "/r/tok-eva/answer?assist=1&pick=labor-gerinnung-2026-10-22" });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("/r/tok-eva");
    expect(res.body).not.toContain("Maria");
    expect(res.body).not.toContain("Gerinnung");
  });

  it("ticked: ranked list, current clotting panel first, other patients hidden, MOCK badge", async () => {
    await build(false, true);
    const { jar } = await loginAs("eva-brandl");
    const res = await app.inject({ url: "/r/tok-eva/answer?assist=1", headers: { cookie: jar.header() } });
    expect(res.statusCode).toBe(200);
    expect(ids(res.body)[0]).toBe("labor-gerinnung-2026-10-22");
    expect(ids(res.body)).toHaveLength(5);
    expect(res.body).not.toContain("labor-andere-patientin");
    expect(res.body).not.toContain("labor-namensgleich");
    expect(res.body).toContain("2 Dokumente anderer Personen wurden ausgeblendet");
    expect(res.body).toContain("KI-Vorschlag (Demo, MOCK)");
    expect(res.body).toContain("<b>Gesucht für:</b> Bitte Gerinnung vor dem Eingriff.");
    expect(res.body).toContain("Beleg (Zeile ");
    expect(res.body).toContain('href="/r/tok-eva/answer?assist=1&amp;pick=labor-gerinnung-2026-10-22#content"');
    expect(res.body).toMatch(/id="assist-toggle" checked/);
    expect(textarea(res.body)).toBe("");
    expect(svc.calls.some((c) => c.method === "submitAnswer")).toBe(false);
  });

  it("„Übernehmen“ fills patient and document, does not send; „Sicher senden“ files it", async () => {
    await build(false, true);
    const { jar } = await loginAs("eva-brandl");
    const res = await app.inject({ url: "/r/tok-eva/answer?assist=1&pick=labor-gerinnung-2026-10-22", headers: { cookie: jar.header() } });
    const md = textarea(res.body);
    expect(md).toBe(labDoc);
    expect(res.body).toContain("Vorschlag übernommen: Laborbefund Gerinnung. Bitte prüfen Sie das Dokument und senden Sie es dann.");
    expect(res.body).toContain('value="Maria"');
    expect(res.body).toContain('value="1961-03-12"');
    expect(svc.calls.some((c) => c.method === "submitAnswer")).toBe(false);
    const sent = await app.inject({ method: "POST", url: "/r/tok-eva/answer", ...withCookie(multipartBody({ ...maria, content: md }), jar) });
    expect(sent.body).toContain("Vielen Dank – gesendet!");
    const call = svc.calls.find((c) => c.method === "submitAnswer")!;
    expect((call.args[2] as { content: string }).content).toBe(labDoc);
  });

  it("an unknown or hidden id shows an error and fills nothing", async () => {
    await build(false, true);
    const { jar } = await loginAs("eva-brandl");
    for (const id of ["gibt-es-nicht", "labor-andere-patientin", "labor-namensgleich"]) {
      const res = await app.inject({ url: `/r/tok-eva/answer?assist=1&pick=${id}`, headers: { cookie: jar.header() } });
      expect(res.body).toContain("nicht gefunden. Es wurde nichts übernommen.");
      expect(textarea(res.body)).toBe("");
      expect(res.body).not.toContain('value="Maria"');
    }
  });
});

describe("validateAnswer", () => {
  const ok = { ...maria, content: "# doc" };
  it("accepts a complete answer", () => expect(validateAnswer(ok)).toEqual({}));
  it("rejects bad dates and file types", () => {
    expect(validateAnswer({ ...ok, patientBirthDate: "1961-02-30" }).patientBirthDate).toBeDefined();
    expect(validateAnswer({ ...ok, patientBirthDate: "2999-01-01" }).patientBirthDate).toBeDefined();
    expect(validateAnswer({ ...ok, content: "", fileName: "x.pdf", fileContent: "abc" }).document).toBeDefined();
  });
});

function withCookie(req: { payload: string; headers: Record<string, string> }, jar: Jar) {
  return { payload: req.payload, headers: { ...req.headers, cookie: jar.header() } };
}

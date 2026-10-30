import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import multipart from "@fastify/multipart";
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

const base = "http://localhost:3000";
const labDoc = readFileSync(new URL("../../../../scenario/documents/lab-result-maria-beispiel.md", import.meta.url), "utf8");

let app: FastifyInstance;
let svc: FakeRequestService;

async function build() {
  svc = new FakeRequestService(
    makeFakeRequest(),
    makeFakeRequest({ id: "req-2", token: "tok-old" }, { status: "expired" }),
    makeFakeRequest({ id: "req-3", token: "tok-done" }, { status: "answered" }),
  );
  const deps = {
    config: { ...config, publicBaseUrl: base, eidIssuerUrl: `${base}/mock-eid` },
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

beforeEach(build);

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

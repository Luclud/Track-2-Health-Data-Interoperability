import { readFileSync } from "node:fs";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { Deps } from "../container.ts";
import type { MemorySender } from "../notify/index.ts";
import { labBody, testDeps } from "../domain/testkit.ts";
import { registerApiRoutes } from "./routes.ts";

const LENA = { "x-dev-user": "@lena.hofer:klinikum.example" };

async function setup(configOverrides: Partial<Deps["config"]> = {}, fetchImpl?: typeof fetch) {
  const t = testDeps();
  await t.deps.fhir.upsert({
    resourceType: "Practitioner",
    id: "lena-hofer",
    identifier: [{ system: "urn:brieftaube:matrix-user", value: "@lena.hofer:klinikum.example" }],
    name: [{ family: "Hofer", given: ["Lena"], prefix: ["Dr."] }],
  });
  await t.deps.fhir.upsert({ resourceType: "Patient", id: "max-beispiel", name: [{ family: "Beispiel", given: ["Max"] }], birthDate: "1960-01-01" });
  await t.deps.fhir.upsert({ resourceType: "Patient", id: "anna-huber", name: [{ family: "Huber", given: ["Anna"] }], birthDate: "1975-06-01" });
  const deps = { ...t.deps, config: { ...t.deps.config, ...configOverrides }, requests: t.service } as unknown as Deps;
  if (fetchImpl) globalThis.fetch = fetchImpl;
  const app = Fastify();
  await registerApiRoutes(app, deps);
  return { app, deps, t };
}

describe("REST API", () => {
  it("requires auth (dev mode) and rejects other homeservers", async () => {
    const { app } = await setup();
    expect((await app.inject({ url: "/api/me" })).statusCode).toBe(401);
    const other = await app.inject({ url: "/api/me", headers: { "x-dev-user": "@eve:evil.example" } });
    expect(other.statusCode).toBe(403);
    expect(other.json().error).toBe("forbidden");
  });

  it("GET /api/me uses the Practitioner", async () => {
    const { app } = await setup();
    const res = await app.inject({ url: "/api/me", headers: LENA });
    expect(res.json()).toEqual({ matrixUserId: "@lena.hofer:klinikum.example", displayName: "Dr. Lena Hofer", organization: "Klinikum Beispielstadt" });
  });

  it("matrix mode verifies the OpenID token at Synapse", async () => {
    const calls: string[] = [];
    const orig = globalThis.fetch;
    const f = (async (url: string) => {
      calls.push(url);
      if (url.includes("openid/userinfo?access_token=good")) return new Response(JSON.stringify({ sub: "@lena.hofer:klinikum.example" }));
      return new Response("{}", { status: 401 });
    }) as unknown as typeof fetch;
    try {
      const { app } = await setup({ authMode: "matrix", synapseUrl: "http://synapse:8008" }, f);
      expect((await app.inject({ url: "/api/me", headers: { authorization: "Bearer bad" } })).statusCode).toBe(401);
      const ok = await app.inject({ url: "/api/me", headers: { authorization: "Bearer good" } });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().displayName).toBe("Dr. Lena Hofer");
      await app.inject({ url: "/api/me", headers: { authorization: "Bearer good" } });
      expect(calls.filter((c) => c.includes("access_token=good"))).toHaveLength(1); // cached
      expect(calls[0]).toBe("http://synapse:8008/_matrix/federation/v1/openid/userinfo?access_token=bad");
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("GET /api/patients filters by name", async () => {
    const { app } = await setup();
    const all = (await app.inject({ url: "/api/patients", headers: LENA })).json();
    expect(all.map((p: { fhirId: string }) => p.fhirId)).toEqual(["maria-beispiel", "max-beispiel", "anna-huber"]);
    const hits = (await app.inject({ url: "/api/patients?q=maria%20beisp", headers: LENA })).json();
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ fhirId: "maria-beispiel", birthDate: "1961-03-12" });
  });

  it("recipient check validates the body", async () => {
    const { app } = await setup();
    expect((await app.inject({ method: "POST", url: "/api/recipient-check", headers: LENA, payload: { channel: "fax" } })).statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: "/api/recipient-check", headers: LENA, payload: { channel: "email", address: "a@b.example", displayName: "A B" } });
    expect(ok.json()).toEqual({ warnings: expect.any(Array) });
  });

  it("create → list → detail; held decisions; errors", async () => {
    const { app, t } = await setup();
    expect((await app.inject({ method: "POST", url: "/api/requests", headers: LENA, payload: { ...labBody, documentType: "x" } })).statusCode).toBe(400);
    const missing = await app.inject({ method: "POST", url: "/api/requests", headers: LENA, payload: { ...labBody, patientId: "nobody", acknowledgeWarnings: true } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: "patient-not-found" });

    const created = await app.inject({ method: "POST", url: "/api/requests", headers: LENA, payload: { ...labBody, acknowledgeWarnings: true } });
    expect(created.statusCode).toBe(201);
    const { request } = created.json();
    expect(request).toMatchObject({ status: "sent", documentType: "lab-result", patient: { fhirId: "maria-beispiel" } });
    expect(request).not.toHaveProperty("requester");
    expect(await (t.deps.email as MemorySender).inbox()).toHaveLength(1);

    const list = (await app.inject({ url: `/api/requests?roomId=${encodeURIComponent(labBody.roomId)}`, headers: LENA })).json();
    expect(list.map((r: { id: string }) => r.id)).toEqual([request.id]);
    const detail = (await app.inject({ url: `/api/requests/${request.id}`, headers: LENA })).json();
    expect(detail.audit.map((a: { step: string }) => a.step)).toEqual(["request-sent"]);
    expect((await app.inject({ url: "/api/requests/nope", headers: LENA })).statusCode).toBe(404);

    const rel = await app.inject({ method: "POST", url: `/api/requests/${request.id}/release`, headers: LENA, payload: {} });
    expect([200, 409, 501]).toContain(rel.statusCode);
  });
  it("GET /api/ui-config needs no auth and reports the switches", async () => {
    const off = await setup({ juryMode: false, llmProvider: "none" });
    expect((await off.app.inject({ url: "/api/ui-config" })).json()).toEqual({ juryMode: false, llmEnabled: false });
    const on = await setup({ juryMode: true, llmProvider: "mock" });
    expect((await on.app.inject({ url: "/api/ui-config" })).json()).toEqual({ juryMode: true, llmEnabled: true });
  });

  it("returns juryLink only in JURY_MODE", async () => {
    const off = await setup({ juryMode: false });
    const a = await off.app.inject({ method: "POST", url: "/api/requests", headers: LENA, payload: { ...labBody, acknowledgeWarnings: true } });
    expect(a.statusCode).toBe(201);
    expect(a.json()).not.toHaveProperty("juryLink");
    expect(a.json().request.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const on = await setup({ juryMode: true });
    const b = await on.app.inject({ method: "POST", url: "/api/requests", headers: LENA, payload: { ...labBody, acknowledgeWarnings: true } });
    expect(b.statusCode).toBe(201);
    const link: string = b.json().juryLink;
    expect(link).toMatch(/^http:\/\/localhost:3000\/r\//);
    const [mail] = await (on.t.deps.email as MemorySender).inbox();
    expect(mail!.body).toContain(link);
  });
});

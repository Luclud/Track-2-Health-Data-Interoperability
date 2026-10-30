import Fastify from "fastify";
import formbody from "@fastify/formbody";
import { describe, expect, it } from "vitest";
import type { Deps } from "../container.ts";
import { config } from "../config.ts";
import { MockPhysicianRegister } from "../register/index.ts";
import { EidError, MockIdAustria } from "./index.ts";
import { isAllowedRedirect, registerEidRoutes } from "./routes.ts";

const base = "http://localhost:3000";
const redirectUri = `${base}/r/tok123/callback`;

async function app() {
  const eid = new MockIdAustria({ eidIssuerUrl: `${base}/mock-eid` });
  const register = new MockPhysicianRegister();
  const deps = { config: { ...config, publicBaseUrl: base }, eid, register } as unknown as Deps;
  const a = Fastify();
  await a.register(formbody);
  await registerEidRoutes(a, deps);
  return { a, eid, register };
}

function form(fields: Record<string, string>) {
  return { payload: new URLSearchParams(fields).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } };
}

describe("MockIdAustria", () => {
  it("builds the authorize URL", () => {
    const eid = new MockIdAustria({ eidIssuerUrl: `${base}/mock-eid/` });
    const u = new URL(eid.authorizationUrl({ state: "s1", redirectUri, loginHint: "Dr. Eva Brandl" }));
    expect(u.pathname).toBe("/mock-eid/authorize");
    expect(u.searchParams.get("state")).toBe("s1");
    expect(u.searchParams.get("redirect_uri")).toBe(redirectUri);
    expect(u.searchParams.get("login_hint")).toBe("Dr. Eva Brandl");
  });

  it("exchanges a code once, with LoA high and a fake bPK", async () => {
    const eid = new MockIdAustria({ eidIssuerUrl: `${base}/mock-eid` });
    const code = eid.issueCode({ name: { given: ["Jörg"], family: "Müller-Groß" }, birthDate: "1970-01-02" }, redirectUri);
    const id = await eid.exchangeCode(code, redirectUri);
    expect(id).toMatchObject({ provider: "mock-id-austria", levelOfAssurance: "high", subject: "GH:mock-bpk-jorg-muller-gross-1970-01-02", birthDate: "1970-01-02" });
    await expect(eid.exchangeCode(code, redirectUri)).rejects.toBeInstanceOf(EidError);
  });

  it("rejects wrong redirect_uri and expired codes", async () => {
    let now = 1_000_000;
    const eid = new MockIdAustria({ eidIssuerUrl: `${base}/mock-eid` }, () => now);
    const c1 = eid.issueCode({ name: { given: ["A"], family: "B" }, birthDate: "1990-01-01" }, redirectUri);
    await expect(eid.exchangeCode(c1, `${base}/r/other/callback`)).rejects.toThrow(/redirect_uri/);
    const c2 = eid.issueCode({ name: { given: ["A"], family: "B" }, birthDate: "1990-01-01" }, redirectUri);
    now += 6 * 60 * 1000;
    await expect(eid.exchangeCode(c2, redirectUri)).rejects.toThrow(/expired/);
  });
});

describe("MockPhysicianRegister", () => {
  const identity = (given: string, family: string, birthDate: string) => ({
    provider: "mock-id-austria", subject: "x", name: { given: [given], family }, birthDate, levelOfAssurance: "high" as const, authenticatedAt: "",
  });
  it("finds Eva Brandl by family + first given + birth date", async () => {
    const r = await new MockPhysicianRegister().lookup(identity("Eva", "Brandl", "1979-05-14"));
    expect(r).toEqual({ checked: true, listed: true, registerName: "Ärzteliste (simuliert)", registrationNumber: "AT-LAB-4711", specialty: "Medizinische und Chemische Labordiagnostik" });
  });
  it("does not list a wrong birth date or an unknown person", async () => {
    const reg = new MockPhysicianRegister();
    expect((await reg.lookup(identity("Eva", "Brandl", "1979-05-15"))).listed).toBe(false);
    expect((await reg.lookup(identity("Ines", "Fremd", "1990-08-08"))).listed).toBe(false);
  });
  it("ignores case and diacritics; entries without birth date match any", async () => {
    const reg = new MockPhysicianRegister({ registerName: "R", entries: [{ given: ["Jörg"], family: "Groß", registrationNumber: "N1" }] });
    expect((await reg.lookup(identity("jorg", "GROSS", "2000-01-01"))).listed).toBe(true);
  });
});

describe("mock eID pages", () => {
  it("shows the simulation label and personas, without ID Austria branding", async () => {
    const { a } = await app();
    const res = await a.inject({ url: `/mock-eid/authorize?state=s1&redirect_uri=${encodeURIComponent(redirectUri)}` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Simulierte e-ID – Platzhalter für ID Austria");
    expect(res.body).toContain("Dr. Eva Brandl");
    expect(res.body).toContain("Andere Person");
    expect(res.body).not.toMatch(/<img/);
  });

  it("refuses foreign redirect URIs", async () => {
    const { a } = await app();
    const res = await a.inject({ url: `/mock-eid/authorize?state=s1&redirect_uri=${encodeURIComponent("https://evil.example/r/x")}` });
    expect(res.statusCode).toBe(400);
    expect(isAllowedRedirect("http://localhost:3000/r/x/callback", base)).toBe(true);
    expect(isAllowedRedirect("http://localhost:3000/api/x", base)).toBe(false);
  });

  it("persona login redirects with a code that exchanges to the persona", async () => {
    const { a, eid } = await app();
    const res = await a.inject({ method: "POST", url: "/mock-eid/login", ...form({ state: "s1", redirect_uri: redirectUri, persona: "thomas-gruber" }) });
    expect(res.statusCode).toBe(303);
    const loc = new URL(res.headers.location as string);
    expect(loc.pathname).toBe("/r/tok123/callback");
    expect(loc.searchParams.get("state")).toBe("s1");
    const id = await eid.exchangeCode(loc.searchParams.get("code")!, redirectUri);
    expect(id.name).toEqual({ given: ["Thomas"], family: "Gruber", prefix: ["Dr."] });
    expect(id.subject).toBe("GH:mock-bpk-thomas-gruber");
  });

  it("'andere Person' can be added to the register", async () => {
    const { a, eid, register } = await app();
    const res = await a.inject({
      method: "POST", url: "/mock-eid/login",
      ...form({ state: "s1", redirect_uri: redirectUri, given: "Anna Maria", family: "Jury", birthDate: "1975-06-01", addToRegister: "1" }),
    });
    expect(res.statusCode).toBe(303);
    const id = await eid.exchangeCode(new URL(res.headers.location as string).searchParams.get("code")!, redirectUri);
    expect(id.name).toEqual({ given: ["Anna", "Maria"], family: "Jury" });
    expect((await register.lookup(id)).listed).toBe(true);
  });

  it("'andere Person' with missing fields goes back with an error", async () => {
    const { a } = await app();
    const res = await a.inject({ method: "POST", url: "/mock-eid/login", ...form({ state: "s1", redirect_uri: redirectUri, given: "X", family: "", birthDate: "" }) });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toContain("/mock-eid/authorize?");
    expect(res.headers.location).toContain("error=");
  });
});

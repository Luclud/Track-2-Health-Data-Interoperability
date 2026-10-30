import { describe, expect, it } from "vitest";
import type { Bundle, Patient } from "fhir/r4.js";
import { createdReferences, FhirHttpError, HapiFhirStore } from "./store.ts";
import { MemoryFhirStore } from "./memory-store.ts";

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
function fakeFetch(responses: { status: number; body?: unknown }[]) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method!, headers: init.headers as Record<string, string>, body: init.body as string | undefined });
    const r = responses.shift() ?? { status: 200, body: {} };
    return new Response(r.body === undefined ? "" : typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("HapiFhirStore", () => {
  it("sends fhir+json and maps CRUD to REST", async () => {
    const { f, calls } = fakeFetch([
      { status: 200, body: { resourceType: "Bundle", type: "transaction-response", entry: [] } },
      { status: 200, body: { resourceType: "Patient", id: "p1" } },
      { status: 404, body: { resourceType: "OperationOutcome", issue: [] } },
      { status: 200, body: { resourceType: "Bundle", type: "searchset", entry: [{ resource: { resourceType: "Patient", id: "p1" }, search: { mode: "match" } }, { resource: { resourceType: "Organization", id: "o" }, search: { mode: "include" } }] } },
      { status: 201, body: { resourceType: "Patient", id: "p2" } },
      { status: 201, body: { resourceType: "Patient", id: "new" } },
    ]);
    const s = new HapiFhirStore("http://hapi/fhir/", f);
    await s.transaction({ resourceType: "Bundle", type: "transaction" });
    expect(calls[0]).toMatchObject({ url: "http://hapi/fhir/", method: "POST" });
    expect(calls[0]!.headers["content-type"]).toBe("application/fhir+json");
    expect(calls[0]!.headers.accept).toBe("application/fhir+json");
    expect((await s.read<Patient>("Patient", "p1"))?.id).toBe("p1");
    expect(await s.read<Patient>("Patient", "missing")).toBeUndefined();
    const found = await s.search<Patient>("Patient", { identifier: "sys|v" });
    expect(found.map((p) => p.id)).toEqual(["p1"]);
    expect(calls[3]!.url).toBe("http://hapi/fhir/Patient?identifier=sys%7Cv");
    await s.upsert<Patient>({ resourceType: "Patient", id: "p2" });
    expect(calls[4]).toMatchObject({ url: "http://hapi/fhir/Patient/p2", method: "PUT" });
    await s.create<Patient>({ resourceType: "Patient" });
    expect(calls[5]).toMatchObject({ url: "http://hapi/fhir/Patient", method: "POST" });
  });

  it("errors include OperationOutcome text", async () => {
    const { f } = fakeFetch([
      { status: 422, body: { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "processing", diagnostics: "Unknown code 'xyz'" }] } },
      { status: 500, body: "boom" },
    ]);
    const s = new HapiFhirStore("http://hapi/fhir", f);
    await expect(s.create<Patient>({ resourceType: "Patient" })).rejects.toThrow(/422 — error: Unknown code 'xyz'/);
    const err = await s.create<Patient>({ resourceType: "Patient" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FhirHttpError);
    expect((err as Error).message).toContain("boom");
  });

  it("maps urn:uuid to created ids", () => {
    const req: Bundle = { resourceType: "Bundle", type: "transaction", entry: [{ fullUrl: "urn:uuid:a" }, { fullUrl: "urn:uuid:b" }, { fullUrl: "urn:uuid:c" }] };
    const res: Bundle = {
      resourceType: "Bundle",
      type: "transaction-response",
      entry: [
        { response: { status: "201 Created", location: "Observation/12/_history/1" } },
        { response: { status: "200 OK", location: "http://hapi/fhir/Practitioner/7/_history/3" } },
        { response: { status: "200 OK", location: "Task/bt-7k2q" } },
      ],
    };
    expect(createdReferences(req, res)).toEqual({ "urn:uuid:a": "Observation/12", "urn:uuid:b": "Practitioner/7", "urn:uuid:c": "Task/bt-7k2q" });
  });
});

describe("MemoryFhirStore", () => {
  it("transaction: conditional create, urn rewrite, PUT id", async () => {
    const s = new MemoryFhirStore();
    const bundle = (): Bundle => ({
      resourceType: "Bundle",
      type: "transaction",
      entry: [
        { fullUrl: "urn:uuid:1", resource: { resourceType: "Organization", identifier: [{ system: "s", value: "o" }], name: "O" }, request: { method: "POST", url: "Organization", ifNoneExist: "identifier=s|o" } },
        { fullUrl: "urn:uuid:2", resource: { resourceType: "Task", id: "t1", status: "completed", intent: "order", owner: { reference: "urn:uuid:1" } }, request: { method: "PUT", url: "Task/t1" } },
      ],
    });
    const r1 = await s.transaction(bundle());
    const r2 = await s.transaction(bundle());
    expect(r1.entry![0]!.response!.status).toBe("201 Created");
    expect(r2.entry![0]!.response!.status).toBe("200 OK");
    expect(createdReferences(bundle(), r1)["urn:uuid:2"]).toBe("Task/t1");
    expect((await s.search("Organization", {})).length).toBe(1);
    const task = await s.read("Task", "t1");
    expect(JSON.stringify(task)).toContain(createdReferences(bundle(), r1)["urn:uuid:1"]);
  });
});

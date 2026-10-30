import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AuditEvent } from "fhir/r4.js";
import { MemoryFhirStore } from "../fhir/memory-store.ts";
import type { FhirStore } from "../ports.ts";
import { SqliteAuditLog } from "./index.ts";

const entry = (step: "request-sent" | "link-opened", requestId = "r1", at?: string) => ({
  requestId,
  requestReference: "BT-7K2Q",
  step,
  actor: { kind: "system" as const, id: "brieftaube", display: "Brieftaube" },
  what: `${step} happened`,
  outcome: "success" as const,
  ...(at ? { at } : {}),
});

describe("SqliteAuditLog", () => {
  it("stores in SQLite, appends JSONL, mirrors AuditEvent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-"));
    const fhir = new MemoryFhirStore();
    const log = new SqliteAuditLog({ dataDir: dir, patientIdFor: () => "maria-beispiel" }, fhir);
    const a = await log.record(entry("link-opened", "r1", "2026-10-30T08:10:00.000Z"));
    await log.record(entry("request-sent", "r1", "2026-10-30T08:05:00.000Z"));
    await log.record(entry("request-sent", "r2"));
    await log.flush();
    expect(a.id).toBeTruthy();
    expect(a.fhirAuditEventId).toBeTruthy();
    expect((await log.forRequest("r1")).map((e) => e.step)).toEqual(["request-sent", "link-opened"]);
    expect(await log.all()).toHaveLength(3);
    const lines = readFileSync(join(dir, "audit.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!).step).toBe("link-opened");
    const ev = (await fhir.read<AuditEvent>("AuditEvent", a.fhirAuditEventId!))!;
    expect(ev.subtype?.[0]?.code).toBe("link-opened");
    expect(ev.entity?.map((x) => x.what?.reference)).toEqual(["Task/bt-7k2q", "Patient/maria-beispiel"]);
    // survives reopen
    const again = new SqliteAuditLog({ dataDir: dir }, fhir);
    expect(await again.all()).toHaveLength(3);
  });

  it("FHIR failure is logged, not thrown", async () => {
    const broken = { create: async () => { throw new Error("HAPI down"); } } as unknown as FhirStore;
    const logs: string[] = [];
    const log = new SqliteAuditLog({ dataDir: ":memory:", log: (m) => logs.push(m) }, broken);
    const e = await log.record(entry("request-sent"));
    await log.flush();
    expect(e.fhirAuditEventId).toBeUndefined();
    expect(await log.all()).toHaveLength(1);
    expect(logs[0]).toContain("HAPI down");
  });

  it("SQLite first; a hanging mirror never blocks record()", async () => {
    const hanging = { create: () => new Promise(() => {}) } as unknown as FhirStore;
    const log = new SqliteAuditLog({ dataDir: ":memory:", log: () => {} }, hanging);
    const e = await log.record(entry("request-sent"));
    expect(e.id).toBeTruthy();
    expect(await log.all()).toHaveLength(1);
  });

  it("mirror id is written back to SQLite", async () => {
    const fhir = new MemoryFhirStore();
    const log = new SqliteAuditLog({ dataDir: ":memory:" }, fhir);
    const e = await log.record(entry("request-sent"));
    await log.flush();
    expect((await log.all())[0]!.fhirAuditEventId).toBe(e.fhirAuditEventId);
    expect(e.fhirAuditEventId).toBeTruthy();
  });
});

// Account A, Dev Core — task CORE-7. SQLite + data/audit.jsonl + FHIR AuditEvent mirror (best effort).
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { AuditEntry } from "@brieftaube/shared";
import { REQUESTER_ORG } from "@brieftaube/shared";
import type { Config } from "../config.ts";
import type { AuditLog, FhirStore } from "../ports.ts";
import { buildAuditEvent } from "../fhir/build-audit-event.ts";
import { taskId } from "../fhir/build-task.ts";

type Row = { json: string };

export interface AuditLogOptions {
  /** Directory for brieftaube.db and audit.jsonl; ":memory:" keeps everything in memory (tests) */
  dataDir: string;
  /** Resolves the FHIR Patient id of a request, for the AuditEvent entity (optional) */
  patientIdFor?: (requestId: string) => Promise<string | undefined> | string | undefined;
  log?: (msg: string) => void;
}

export class SqliteAuditLog implements AuditLog {
  private readonly db: Database.Database;
  private readonly jsonl?: string;
  private readonly log: (msg: string) => void;

  constructor(
    private readonly opts: AuditLogOptions,
    private readonly fhir: FhirStore,
  ) {
    this.log = opts.log ?? ((m) => console.warn(m));
    if (opts.dataDir === ":memory:") {
      this.db = new Database(":memory:");
    } else {
      mkdirSync(opts.dataDir, { recursive: true });
      this.db = new Database(join(opts.dataDir, "brieftaube.db"));
      this.jsonl = join(opts.dataDir, "audit.jsonl");
    }
    this.db.pragma("journal_mode = WAL");
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS audit (
         seq INTEGER PRIMARY KEY AUTOINCREMENT,
         id TEXT NOT NULL UNIQUE,
         request_id TEXT NOT NULL,
         at TEXT NOT NULL,
         json TEXT NOT NULL
       );
       CREATE INDEX IF NOT EXISTS audit_request ON audit(request_id);`,
    );
  }

  async record(e: Omit<AuditEntry, "id" | "at"> & { at?: string }): Promise<AuditEntry> {
    const entry: AuditEntry = { ...e, id: randomUUID(), at: e.at ?? new Date().toISOString() };
    try {
      const patientId = await this.opts.patientIdFor?.(entry.requestId);
      const ev = buildAuditEvent(entry, {
        taskId: entry.requestReference ? taskId(entry.requestReference) : undefined,
        patientId,
        site: REQUESTER_ORG,
      });
      const created = await this.fhir.create(ev);
      if (created?.id) entry.fhirAuditEventId = created.id;
    } catch (err) {
      this.log(`audit: FHIR AuditEvent mirror failed for ${entry.step} ${entry.requestReference}: ${(err as Error).message}`);
    }
    const json = JSON.stringify(entry);
    this.db.prepare("INSERT INTO audit (id, request_id, at, json) VALUES (?, ?, ?, ?)").run(entry.id, entry.requestId, entry.at, json);
    if (this.jsonl) {
      try {
        appendFileSync(this.jsonl, `${json}\n`);
      } catch (err) {
        this.log(`audit: append to ${this.jsonl} failed: ${(err as Error).message}`);
      }
    }
    return entry;
  }

  async forRequest(requestId: string): Promise<AuditEntry[]> {
    const rows = this.db.prepare("SELECT json FROM audit WHERE request_id = ? ORDER BY at, seq").all(requestId) as Row[];
    return rows.map((r) => JSON.parse(r.json) as AuditEntry);
  }

  async all(): Promise<AuditEntry[]> {
    const rows = this.db.prepare("SELECT json FROM audit ORDER BY at, seq").all() as Row[];
    return rows.map((r) => JSON.parse(r.json) as AuditEntry);
  }
}

export function createAuditLog(config: Config, fhir: FhirStore): AuditLog {
  return new SqliteAuditLog({ dataDir: config.dataDir }, fhir);
}

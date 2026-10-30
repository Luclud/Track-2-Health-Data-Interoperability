// Account A, Dev Core — task CORE-7. SQLite + data/audit.jsonl + FHIR AuditEvent mirror (best effort).
import type { Config } from "../config.ts";
import type { AuditLog, FhirStore } from "../ports.ts";
import type { AuditEntry } from "@brieftaube/shared";
import { NotImplementedError } from "../not-implemented.ts";

export class SqliteAuditLog implements AuditLog {
  constructor(private readonly config: Config, private readonly fhir: FhirStore) {}
  async record(_e: Omit<AuditEntry, "id" | "at"> & { at?: string }): Promise<AuditEntry> {
    throw new NotImplementedError("SqliteAuditLog.record", "CORE-7");
  }
  async forRequest(_requestId: string): Promise<AuditEntry[]> {
    throw new NotImplementedError("SqliteAuditLog.forRequest", "CORE-7");
  }
  async all(): Promise<AuditEntry[]> {
    throw new NotImplementedError("SqliteAuditLog.all", "CORE-7");
  }
}

export function createAuditLog(config: Config, fhir: FhirStore): AuditLog {
  return new SqliteAuditLog(config, fhir);
}

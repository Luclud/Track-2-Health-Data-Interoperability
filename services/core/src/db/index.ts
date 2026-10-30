// Account A, Dev Core — task CORE-3. SQLite (better-sqlite3) in DATA_DIR/brieftaube.db. Store request JSON + token hash.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { DocumentRequest, ParsedDocument } from "@brieftaube/shared";
import type { FilingContext } from "../fhir/types.ts";
import type { Config } from "../config.ts";
import type { RequestRepository } from "../ports.ts";

type Row = { json: string };

/** A held answer, kept until Dr. Hofer releases or rejects it (CORE-11). */
export interface HeldAnswer {
  document: ParsedDocument;
  context: Omit<FilingContext, "request" | "newUuid">;
}

export interface HeldAnswerStore {
  saveHeld(requestId: string, held: HeldAnswer): Promise<void>;
  heldAnswer(requestId: string): Promise<HeldAnswer | undefined>;
  deleteHeld(requestId: string): Promise<void>;
}

export class MemoryHeldAnswerStore implements HeldAnswerStore {
  private readonly map = new Map<string, string>();
  async saveHeld(id: string, held: HeldAnswer) {
    this.map.set(id, JSON.stringify(held));
  }
  async heldAnswer(id: string) {
    const j = this.map.get(id);
    return j ? (JSON.parse(j) as HeldAnswer) : undefined;
  }
  async deleteHeld(id: string) {
    this.map.delete(id);
  }
}

export const isHeldAnswerStore = (x: unknown): x is HeldAnswerStore =>
  typeof (x as HeldAnswerStore | undefined)?.saveHeld === "function";

export class SqliteRequestRepository implements RequestRepository, HeldAnswerStore {
  private readonly db: Database.Database;

  /** `dataDir: ":memory:"` keeps everything in memory (tests). */
  constructor(opts: { dataDir: string }) {
    if (opts.dataDir === ":memory:") {
      this.db = new Database(":memory:");
    } else {
      mkdirSync(opts.dataDir, { recursive: true });
      this.db = new Database(join(opts.dataDir, "brieftaube.db"));
      this.db.pragma("journal_mode = WAL");
    }
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS requests (
         id TEXT PRIMARY KEY,
         token_hash TEXT NOT NULL UNIQUE,
         room_id TEXT NOT NULL,
         requester TEXT NOT NULL,
         created_at TEXT NOT NULL,
         json TEXT NOT NULL
       );
       CREATE INDEX IF NOT EXISTS requests_room ON requests(room_id);
       CREATE INDEX IF NOT EXISTS requests_requester ON requests(requester);
       CREATE TABLE IF NOT EXISTS held_answers (
         request_id TEXT PRIMARY KEY,
         json TEXT NOT NULL
       );`,
    );
  }

  async insert(r: DocumentRequest, tokenHash: string): Promise<void> {
    this.db
      .prepare("INSERT INTO requests (id, token_hash, room_id, requester, created_at, json) VALUES (?, ?, ?, ?, ?, ?)")
      .run(r.id, tokenHash, r.roomId, r.requester.matrixUserId, r.createdAt, JSON.stringify(r));
  }
  async update(r: DocumentRequest): Promise<void> {
    const res = this.db.prepare("UPDATE requests SET json = ?, room_id = ? WHERE id = ?").run(JSON.stringify(r), r.roomId, r.id);
    if (res.changes === 0) throw new Error(`request ${r.id} not found`);
  }
  async byId(id: string): Promise<DocumentRequest | undefined> {
    const row = this.db.prepare("SELECT json FROM requests WHERE id = ?").get(id) as Row | undefined;
    return row ? (JSON.parse(row.json) as DocumentRequest) : undefined;
  }
  async byTokenHash(h: string): Promise<DocumentRequest | undefined> {
    const row = this.db.prepare("SELECT json FROM requests WHERE token_hash = ?").get(h) as Row | undefined;
    return row ? (JSON.parse(row.json) as DocumentRequest) : undefined;
  }
  /** Newest first */
  async listByRoom(roomId: string): Promise<DocumentRequest[]> {
    const rows = this.db.prepare("SELECT json FROM requests WHERE room_id = ? ORDER BY created_at DESC, rowid DESC").all(roomId) as Row[];
    return rows.map((r) => JSON.parse(r.json) as DocumentRequest);
  }
  async saveHeld(id: string, held: HeldAnswer): Promise<void> {
    this.db.prepare("INSERT OR REPLACE INTO held_answers (request_id, json) VALUES (?, ?)").run(id, JSON.stringify(held));
  }
  async heldAnswer(id: string): Promise<HeldAnswer | undefined> {
    const row = this.db.prepare("SELECT json FROM held_answers WHERE request_id = ?").get(id) as Row | undefined;
    return row ? (JSON.parse(row.json) as HeldAnswer) : undefined;
  }
  async deleteHeld(id: string): Promise<void> {
    this.db.prepare("DELETE FROM held_answers WHERE request_id = ?").run(id);
  }
  async knownAddresses(m: string): Promise<string[]> {
    const rows = this.db.prepare("SELECT json FROM requests WHERE requester = ?").all(m) as Row[];
    return [...new Set(rows.map((r) => (JSON.parse(r.json) as DocumentRequest).recipient.address))];
  }
}

export function createRequestRepository(config: Config): RequestRepository {
  return new SqliteRequestRepository({ dataDir: config.dataDir });
}

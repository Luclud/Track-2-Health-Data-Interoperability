// Account A, Dev Core — task CORE-3. SQLite (better-sqlite3) in DATA_DIR/brieftaube.db. Store request JSON + token hash.
import type { Config } from "../config.ts";
import type { RequestRepository } from "../ports.ts";
import type { DocumentRequest } from "@brieftaube/shared";
import { NotImplementedError } from "../not-implemented.ts";

export class SqliteRequestRepository implements RequestRepository {
  constructor(private readonly config: Config) {}
  async insert(_r: DocumentRequest, _tokenHash: string): Promise<void> {
    throw new NotImplementedError("insert", "CORE-3");
  }
  async update(_r: DocumentRequest): Promise<void> {
    throw new NotImplementedError("update", "CORE-3");
  }
  async byId(_id: string): Promise<DocumentRequest | undefined> {
    throw new NotImplementedError("byId", "CORE-3");
  }
  async byTokenHash(_h: string): Promise<DocumentRequest | undefined> {
    throw new NotImplementedError("byTokenHash", "CORE-3");
  }
  async listByRoom(_roomId: string): Promise<DocumentRequest[]> {
    throw new NotImplementedError("listByRoom", "CORE-3");
  }
  async knownAddresses(_m: string): Promise<string[]> {
    throw new NotImplementedError("knownAddresses", "CORE-3");
  }
}

export function createRequestRepository(config: Config): RequestRepository {
  return new SqliteRequestRepository(config);
}

// Account B, Dev Outside — task OUT-2. Mock physician register ("Ärzteliste", simulated), seeded from infra/mock-register.json.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Config } from "../config.ts";
import type { PhysicianRegister } from "../ports.ts";
import type { RegisterResult, VerifiedIdentity } from "@brieftaube/shared";

export interface RegisterEntry {
  given: string[];
  family: string;
  birthDate?: string;
  registrationNumber: string;
  specialty?: string;
}

interface RegisterFile {
  registerName: string;
  entries: RegisterEntry[];
}

const REGISTER_FILE = fileURLToPath(new URL("../../../../infra/mock-register.json", import.meta.url));

export function normalizeNamePart(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/ß/g, "ss").replace(/[\s-]+/g, " ").trim();
}

export class MockPhysicianRegister implements PhysicianRegister {
  readonly registerName: string;
  private readonly entries: RegisterEntry[];
  private added = 0;

  constructor(source: RegisterFile | string = REGISTER_FILE) {
    const data: RegisterFile = typeof source === "string" ? JSON.parse(readFileSync(source, "utf8")) : source;
    this.registerName = data.registerName;
    this.entries = [...data.entries];
  }

  /** Jury test persons ("andere Person" + checkbox on the mock eID page). In memory only. */
  add(entry: Omit<RegisterEntry, "registrationNumber"> & { registrationNumber?: string }): RegisterEntry {
    const full: RegisterEntry = { ...entry, registrationNumber: entry.registrationNumber ?? `AT-SIM-${9000 + ++this.added}` };
    this.entries.push(full);
    return full;
  }

  async lookup(identity: VerifiedIdentity): Promise<RegisterResult> {
    const family = normalizeNamePart(identity.name.family);
    const given = normalizeNamePart(identity.name.given[0] ?? "");
    const hit = this.entries.find(
      (e) =>
        normalizeNamePart(e.family) === family &&
        normalizeNamePart(e.given[0] ?? "") === given &&
        (!e.birthDate || e.birthDate === identity.birthDate),
    );
    return {
      checked: true,
      listed: !!hit,
      registerName: this.registerName,
      ...(hit ? { registrationNumber: hit.registrationNumber, specialty: hit.specialty } : {}),
    };
  }
}

export function createPhysicianRegister(_config: Config): PhysicianRegister {
  return new MockPhysicianRegister();
}

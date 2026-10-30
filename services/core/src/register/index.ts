// Account B, Dev Outside — task OUT-2. Mock physician register ("Ärzteliste", simulated), seeded from infra/mock-register.json.
import type { Config } from "../config.ts";
import type { PhysicianRegister } from "../ports.ts";
import type { RegisterResult, VerifiedIdentity } from "@brieftaube/shared";
import { NotImplementedError } from "../not-implemented.ts";

export class MockPhysicianRegister implements PhysicianRegister {
  constructor(private readonly config: Config) {}
  async lookup(_identity: VerifiedIdentity): Promise<RegisterResult> {
    throw new NotImplementedError("MockPhysicianRegister.lookup", "OUT-2");
  }
}

export function createPhysicianRegister(config: Config): PhysicianRegister {
  return new MockPhysicianRegister(config);
}

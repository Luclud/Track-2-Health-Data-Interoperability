// Account A, Dev Core — task CORE-6. HAPI FHIR client (fetch, application/fhir+json).
import type { Config } from "../config.ts";
import type { FhirStore } from "../ports.ts";
import type { Bundle, FhirResource } from "fhir/r4";
import { NotImplementedError } from "../not-implemented.ts";

export class HapiFhirStore implements FhirStore {
  constructor(private readonly baseUrl: string) {}
  async transaction(_bundle: Bundle): Promise<Bundle> {
    throw new NotImplementedError("HapiFhirStore.transaction", "CORE-6");
  }
  async read<T extends FhirResource>(_type: T["resourceType"], _id: string): Promise<T | undefined> {
    throw new NotImplementedError("HapiFhirStore.read", "CORE-6");
  }
  async search<T extends FhirResource>(_type: T["resourceType"], _params: Record<string, string>): Promise<T[]> {
    throw new NotImplementedError("HapiFhirStore.search", "CORE-6");
  }
  async upsert<T extends FhirResource>(_resource: T & { id: string }): Promise<T> {
    throw new NotImplementedError("HapiFhirStore.upsert", "CORE-6");
  }
  async create<T extends FhirResource>(_resource: T): Promise<T> {
    throw new NotImplementedError("HapiFhirStore.create", "CORE-6");
  }
}

export function createFhirStore(config: Config): FhirStore {
  return new HapiFhirStore(config.fhirBaseUrl);
}

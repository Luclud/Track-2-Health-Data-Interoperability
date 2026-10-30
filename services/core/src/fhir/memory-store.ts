// In-memory FhirStore for unit tests and FHIR-less dev runs. Supports transactions with
// conditional create (ifNoneExist identifier=system|value), urn:uuid reference rewriting, PUT and POST.
import { randomUUID } from "node:crypto";
import type { FhirStore } from "../ports.ts";
import type { Bundle, BundleEntry, FhirResource } from "fhir/r4.js";

type AnyResource = FhirResource & { id?: string; identifier?: { system?: string; value?: string }[] };

export class MemoryFhirStore implements FhirStore {
  readonly resources = new Map<string, AnyResource>();
  readonly transactions: Bundle[] = [];

  private key(type: string, id: string) {
    return `${type}/${id}`;
  }
  private findByIdentifier(type: string, system: string, value: string): AnyResource | undefined {
    for (const r of this.resources.values()) {
      if (r.resourceType === type && r.identifier?.some((i) => i.system === system && i.value === value)) return r;
    }
    return undefined;
  }
  private put(r: AnyResource): AnyResource {
    const copy = structuredClone(r);
    copy.id ??= randomUUID();
    this.resources.set(this.key(copy.resourceType, copy.id), copy);
    return structuredClone(copy);
  }

  async transaction(bundle: Bundle): Promise<Bundle> {
    this.transactions.push(structuredClone(bundle));
    const entries = bundle.entry ?? [];
    const ids = new Map<string, string>();
    const results: { status: string; location: string }[] = [];
    // Assign ids first so references can be rewritten.
    for (const e of entries) {
      const r = e.resource as AnyResource;
      const cond = e.request?.ifNoneExist && /^identifier=([^|]*)\|(.*)$/.exec(e.request.ifNoneExist);
      const existing = cond ? this.findByIdentifier(r.resourceType, cond[1]!, cond[2]!) : undefined;
      const id = e.request?.method === "PUT" ? e.request.url.split("/")[1]! : (existing?.id ?? randomUUID());
      if (e.fullUrl) ids.set(e.fullUrl, this.key(r.resourceType, id));
      results.push({ status: existing ? "200 OK" : "201 Created", location: `${this.key(r.resourceType, id)}/_history/1` });
    }
    entries.forEach((e: BundleEntry, i) => {
      if (results[i]!.status === "200 OK" && e.request?.method === "POST") return;
      let json = JSON.stringify(e.resource);
      for (const [urn, ref] of ids) json = json.split(`"${urn}"`).join(`"${ref}"`);
      const r = JSON.parse(json) as AnyResource;
      r.id = ids.get(e.fullUrl ?? "")?.split("/")[1] ?? r.id;
      this.put(r);
    });
    return {
      resourceType: "Bundle",
      type: "transaction-response",
      entry: results.map((response) => ({ response })),
    };
  }
  async read<T extends FhirResource>(type: T["resourceType"], id: string): Promise<T | undefined> {
    const r = this.resources.get(this.key(type, id));
    return r ? (structuredClone(r) as T) : undefined;
  }
  async search<T extends FhirResource>(type: T["resourceType"], params: Record<string, string>): Promise<T[]> {
    const out: T[] = [];
    for (const r of this.resources.values()) {
      if (r.resourceType !== type) continue;
      const ok = Object.entries(params).every(([k, v]) => {
        if (k === "identifier") {
          const [s, val] = v.includes("|") ? v.split("|") : [undefined, v];
          return r.identifier?.some((i) => (s === undefined || i.system === s) && i.value === val);
        }
        if (k === "_id") return r.id === v;
        const field = (r as unknown as Record<string, unknown>)[k];
        if (field && typeof field === "object" && "reference" in field) return (field as { reference?: string }).reference === v || (field as { reference?: string }).reference?.endsWith(`/${v}`);
        return field === undefined ? true : String(field) === v;
      });
      if (ok) out.push(structuredClone(r) as T);
    }
    return out;
  }
  async upsert<T extends FhirResource>(resource: T & { id: string }): Promise<T> {
    return this.put(resource as AnyResource) as T;
  }
  async create<T extends FhirResource>(resource: T): Promise<T> {
    const r = structuredClone(resource) as AnyResource;
    delete r.id;
    return this.put(r) as T;
  }
}

// Account A, Dev Core — task CORE-6. HAPI FHIR client (fetch, application/fhir+json).
import type { Config } from "../config.ts";
import type { FhirStore } from "../ports.ts";
import type { Bundle, FhirResource, OperationOutcome } from "fhir/r4.js";

const FHIR_JSON = "application/fhir+json";

export class FhirHttpError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly url: string,
    readonly outcome?: OperationOutcome,
  ) {
    super(`FHIR ${method} ${url} failed: ${status}${outcome ? ` — ${outcomeText(outcome)}` : ""}`);
    this.name = "FhirHttpError";
  }
}

export function outcomeText(o: OperationOutcome): string {
  return (o.issue ?? [])
    .map((i) => `${i.severity}: ${i.diagnostics ?? i.details?.text ?? i.code}`)
    .join("; ");
}

/** Transaction response → map of request entry fullUrl (urn:uuid) to the created "Type/id". */
export function createdReferences(request: Bundle, response: Bundle): Record<string, string> {
  const map: Record<string, string> = {};
  (request.entry ?? []).forEach((e, i) => {
    const loc = response.entry?.[i]?.response?.location;
    if (!e.fullUrl || !loc) return;
    const m = /^(?:.*\/)?([A-Za-z]+)\/([^/]+)(?:\/_history\/.*)?$/.exec(loc);
    if (m) map[e.fullUrl] = `${m[1]}/${m[2]}`;
  });
  return map;
}

export class HapiFhirStore implements FhirStore {
  private readonly baseUrl: string;
  constructor(
    baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 5000,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private async call<T>(method: string, path: string, body?: unknown, allow404 = false): Promise<T | undefined> {
    const url = `${this.baseUrl}/${path}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { accept: FHIR_JSON, ...(body === undefined ? {} : { "content-type": FHIR_JSON }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      const e = err as Error;
      const why = e.name === "TimeoutError" || e.name === "AbortError" ? `timed out after ${this.timeoutMs} ms` : e.message;
      throw new Error(`FHIR ${method} ${url} failed: ${why}`);
    }
    if (allow404 && (res.status === 404 || res.status === 410)) return undefined;
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      const outcome = (json as { resourceType?: string } | undefined)?.resourceType === "OperationOutcome" ? (json as OperationOutcome) : undefined;
      throw new FhirHttpError(res.status, method, url, outcome ?? (text ? { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "exception", diagnostics: text.slice(0, 500) }] } : undefined));
    }
    return json as T;
  }

  async transaction(bundle: Bundle): Promise<Bundle> {
    return (await this.call<Bundle>("POST", "", bundle))!;
  }
  async read<T extends FhirResource>(type: T["resourceType"], id: string): Promise<T | undefined> {
    return this.call<T>("GET", `${type}/${encodeURIComponent(id)}`, undefined, true);
  }
  async search<T extends FhirResource>(type: T["resourceType"], params: Record<string, string>): Promise<T[]> {
    const qs = new URLSearchParams(params).toString();
    const b = await this.call<Bundle>("GET", `${type}${qs ? `?${qs}` : ""}`);
    return (b?.entry ?? [])
      .filter((e) => e.search?.mode !== "include" && e.search?.mode !== "outcome")
      .map((e) => e.resource as T)
      .filter((r): r is T => r?.resourceType === type);
  }
  async upsert<T extends FhirResource>(resource: T & { id: string }): Promise<T> {
    return (await this.call<T>("PUT", `${resource.resourceType}/${encodeURIComponent(resource.id)}`, resource))!;
  }
  async create<T extends FhirResource>(resource: T): Promise<T> {
    return (await this.call<T>("POST", resource.resourceType, resource))!;
  }
}

export function createFhirStore(config: Config): FhirStore {
  return new HapiFhirStore(config.fhirBaseUrl);
}

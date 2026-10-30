// CORE-8 doctor authentication. AUTH_MODE=dev: "X-Dev-User" header. AUTH_MODE=matrix: Matrix OpenID token
// verified at Synapse (federation userinfo). Only users of our homeserver are allowed.
import type { Requester } from "@brieftaube/shared";
import type { Practitioner } from "fhir/r4.js";
import type { Config } from "../config.ts";
import type { FhirStore } from "../ports.ts";
import { formatPersonName } from "../parser/names.ts";
import { DomainError } from "../domain/errors.ts";

export const ORGANIZATION = "Klinikum Beispielstadt";
const SEED: Record<string, { displayName: string; practitionerId: string }> = {
  "lena.hofer": { displayName: "Dr. Lena Hofer", practitionerId: "lena-hofer" },
};

type AuthConfig = Pick<Config, "authMode" | "synapseUrl" | "matrixServerName">;

export class DoctorAuth {
  private readonly tokens = new Map<string, { userId: string; until: number }>();
  private readonly profiles = new Map<string, Requester>();

  constructor(
    private readonly config: AuthConfig,
    private readonly fhir: FhirStore,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async authenticate(headers: Record<string, string | string[] | undefined>): Promise<Requester> {
    const userId = this.config.authMode === "matrix" ? await this.matrixUser(headers) : this.devUser(headers);
    if (!userId.endsWith(`:${this.config.matrixServerName}`)) {
      throw new DomainError("forbidden", `Nur Benutzer:innen von ${this.config.matrixServerName} sind zugelassen.`, 403);
    }
    return this.profile(userId);
  }

  private devUser(headers: Record<string, string | string[] | undefined>): string {
    const h = headers["x-dev-user"];
    const v = (Array.isArray(h) ? h[0] : h)?.trim();
    if (!v || !/^@[^:\s]+:\S+$/.test(v)) throw new DomainError("unauthorized", "Header X-Dev-User fehlt (z. B. @lena.hofer:klinikum.example).", 401);
    return v;
  }

  private async matrixUser(headers: Record<string, string | string[] | undefined>): Promise<string> {
    const h = headers.authorization;
    const m = /^Bearer\s+(\S+)$/i.exec((Array.isArray(h) ? h[0] : h) ?? "");
    if (!m) throw new DomainError("unauthorized", "Matrix-Anmeldung fehlt.", 401);
    const token = m[1]!;
    const cached = this.tokens.get(token);
    if (cached && cached.until > Date.now()) return cached.userId;
    const base = this.config.synapseUrl.replace(/\/$/, "");
    let res: Response;
    try {
      res = await this.fetchImpl(`${base}/_matrix/federation/v1/openid/userinfo?access_token=${encodeURIComponent(token)}`, {
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      throw new DomainError("matrix-unavailable", `Matrix-Server nicht erreichbar: ${(err as Error).message}`, 502);
    }
    if (!res.ok) throw new DomainError("unauthorized", "Matrix-Anmeldung ungültig oder abgelaufen.", 401);
    const { sub } = (await res.json()) as { sub?: string };
    if (!sub) throw new DomainError("unauthorized", "Matrix-Anmeldung ungültig.", 401);
    this.tokens.set(token, { userId: sub, until: Date.now() + 5 * 60_000 });
    return sub;
  }

  /** Display name: Practitioner (identifier urn:brieftaube:matrix-user) → Matrix profile → seed values → localpart. */
  private async profile(userId: string): Promise<Requester> {
    const hit = this.profiles.get(userId);
    if (hit) return hit;
    const localpart = userId.slice(1, userId.indexOf(":"));
    const seed = SEED[localpart];
    let practitioner: Practitioner | undefined;
    try {
      [practitioner] = await this.fhir.search<Practitioner>("Practitioner", { identifier: `urn:brieftaube:matrix-user|${userId}` });
    } catch {
      practitioner = undefined;
    }
    const n = practitioner?.name?.[0];
    const fromFhir = n?.family ? formatPersonName({ given: n.given ?? [], family: n.family, ...(n.prefix ? { prefix: n.prefix } : {}) }) : undefined;
    const displayName = fromFhir ?? (await this.matrixDisplayName(userId)) ?? seed?.displayName ?? localpart;
    const r: Requester = {
      matrixUserId: userId,
      displayName,
      organization: ORGANIZATION,
      practitionerId: practitioner?.id ?? seed?.practitionerId ?? localpart.replace(/[^a-z0-9-]/gi, "-"),
    };
    if (practitioner || seed) this.profiles.set(userId, r);
    return r;
  }

  private async matrixDisplayName(userId: string): Promise<string | undefined> {
    if (this.config.authMode !== "matrix") return undefined;
    try {
      const res = await this.fetchImpl(`${this.config.synapseUrl.replace(/\/$/, "")}/_matrix/client/v3/profile/${encodeURIComponent(userId)}/displayname`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return undefined;
      return ((await res.json()) as { displayname?: string }).displayname || undefined;
    } catch {
      return undefined;
    }
  }
}

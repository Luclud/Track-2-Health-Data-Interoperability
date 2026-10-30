// Account B, Dev Outside — task OUT-2. Mock ID Austria (OIDC-like: authorize -> code -> identity).
// A simulation only: no real eID, fake bPKs. Real ID Austria would be a drop-in IdentityProvider.
import { randomBytes } from "node:crypto";
import type { Config } from "../config.ts";
import type { IdentityProvider } from "../ports.ts";
import type { PersonName, VerifiedIdentity } from "@brieftaube/shared";
import { slugify } from "./personas.ts";

export const MOCK_EID_PROVIDER = "mock-id-austria";
const CODE_TTL_MS = 5 * 60 * 1000;

interface PendingCode {
  identity: VerifiedIdentity;
  redirectUri: string;
  expiresAt: number;
}

export class EidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EidError";
  }
}

export function mockBpk(name: Pick<PersonName, "given" | "family">, birthDate: string): string {
  return `GH:mock-bpk-${slugify([...name.given, name.family, birthDate].join(" "))}`;
}

export class MockIdAustria implements IdentityProvider {
  private readonly codes = new Map<string, PendingCode>();

  constructor(
    private readonly config: Pick<Config, "eidIssuerUrl">,
    private readonly now: () => number = Date.now,
  ) {}

  authorizationUrl(p: { state: string; redirectUri: string; loginHint?: string }): string {
    const url = new URL(`${this.config.eidIssuerUrl.replace(/\/$/, "")}/authorize`);
    url.searchParams.set("state", p.state);
    url.searchParams.set("redirect_uri", p.redirectUri);
    if (p.loginHint) url.searchParams.set("login_hint", p.loginHint);
    return url.toString();
  }

  /** Called by the mock login page after the person picked who they are. Returns a one-time code. */
  issueCode(person: { name: PersonName; birthDate: string; subject?: string }, redirectUri: string): string {
    const code = randomBytes(24).toString("base64url");
    const identity: VerifiedIdentity = {
      provider: MOCK_EID_PROVIDER,
      subject: person.subject ?? mockBpk(person.name, person.birthDate),
      name: person.name,
      birthDate: person.birthDate,
      levelOfAssurance: "high",
      authenticatedAt: new Date(this.now()).toISOString(),
    };
    this.codes.set(code, { identity, redirectUri, expiresAt: this.now() + CODE_TTL_MS });
    return code;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<VerifiedIdentity> {
    const pending = this.codes.get(code);
    this.codes.delete(code); // one-time, even if the checks below fail
    if (!pending) throw new EidError("unknown or already used code");
    if (pending.expiresAt < this.now()) throw new EidError("code expired");
    if (pending.redirectUri !== redirectUri) throw new EidError("redirect_uri mismatch");
    return pending.identity;
  }
}

export function createIdentityProvider(config: Config): IdentityProvider {
  return new MockIdAustria(config);
}

// Account B, Dev Outside — task OUT-2. Mock ID Austria (OIDC-like: authorize -> code -> identity).
import type { Config } from "../config.ts";
import type { IdentityProvider } from "../ports.ts";
import type { VerifiedIdentity } from "@brieftaube/shared";
import { NotImplementedError } from "../not-implemented.ts";

export class MockIdAustria implements IdentityProvider {
  constructor(private readonly config: Config) {}
  authorizationUrl(_p: { state: string; redirectUri: string; loginHint?: string }): string {
    throw new NotImplementedError("MockIdAustria.authorizationUrl", "OUT-2");
  }
  async exchangeCode(_code: string, _redirectUri: string): Promise<VerifiedIdentity> {
    throw new NotImplementedError("MockIdAustria.exchangeCode", "OUT-2");
  }
}

export function createIdentityProvider(config: Config): IdentityProvider {
  return new MockIdAustria(config);
}

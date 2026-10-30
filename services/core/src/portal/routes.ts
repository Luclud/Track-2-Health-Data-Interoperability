// Account B, Dev Outside — task OUT-3. The outside person's browser flow under /r/:token.
// Uses ONLY deps.requests (RequestService) and deps.eid — never the repository or FHIR directly.
import type { FastifyInstance } from "fastify";
import type { Deps } from "../container.ts";

export async function registerPortalRoutes(_app: FastifyInstance, _deps: Deps): Promise<void> {
  // TODO OUT-3:
  //   GET  /r/:token              landing (PublicRequestView only) + "Mit e-ID anmelden (simuliert)"
  //   GET  /r/:token/callback     eID callback -> deps.requests.completeIdentityCheck -> set signed session cookie
  //   GET  /r/:token/answer       form (patient given/family name, birth date, file upload or textarea)
  //   POST /r/:token/answer       -> deps.requests.submitAnswer -> result page
}

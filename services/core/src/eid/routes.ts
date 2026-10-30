// Account B, Dev Outside — task OUT-2. Pages of the mock eID under /mock-eid/*.
import type { FastifyInstance } from "fastify";
import type { Deps } from "../container.ts";

export async function registerEidRoutes(_app: FastifyInstance, _deps: Deps): Promise<void> {
  // TODO OUT-2: GET /mock-eid/authorize (persona picker + "andere Person" form), POST /mock-eid/login -> redirect with code
}

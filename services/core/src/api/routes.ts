// Account A, Dev Core — task CORE-8. JSON API for the doctor UI. Contract: packages/shared/src/api.ts
import type { FastifyInstance } from "fastify";
import type { Deps } from "../container.ts";

export async function registerApiRoutes(_app: FastifyInstance, _deps: Deps): Promise<void> {
  // TODO CORE-8: GET /api/me, GET /api/patients, POST /api/recipient-check, POST /api/requests,
  //              GET /api/requests, GET /api/requests/:id, POST /api/requests/:id/release|reject
}

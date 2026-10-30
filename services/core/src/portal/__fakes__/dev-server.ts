// Portal preview with the fake RequestService (no Docker, no core): npx tsx services/core/src/portal/__fakes__/dev-server.ts
// Open http://localhost:3100/r/tok-eva (Anfrage 1), /r/tok-old (expired), /r/tok-done (answered).
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import multipart from "@fastify/multipart";
import type { Deps } from "../../container.ts";
import { config } from "../../config.ts";
import { MockIdAustria } from "../../eid/index.ts";
import { registerEidRoutes } from "../../eid/routes.ts";
import { MockPhysicianRegister } from "../../register/index.ts";
import { registerPortalRoutes } from "../routes.ts";
import { FakeRequestService, makeFakeRequest } from "./fake-request-service.ts";

const port = Number(process.env.PORTAL_PREVIEW_PORT ?? 3100);
const base = `http://localhost:${port}`;
const deps = {
  config: { ...config, publicBaseUrl: base, eidIssuerUrl: `${base}/mock-eid` },
  eid: new MockIdAustria({ eidIssuerUrl: `${base}/mock-eid` }),
  register: new MockPhysicianRegister(),
  requests: new FakeRequestService(
    makeFakeRequest(),
    makeFakeRequest({ id: "req-2", token: "tok-old" }, { status: "expired" }),
    makeFakeRequest({ id: "req-3", token: "tok-done" }, { status: "answered" }),
  ),
} as unknown as Deps;

const app = Fastify({ logger: { level: "warn" } });
await app.register(cookie, { secret: config.sessionSecret });
await app.register(formbody);
await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
await registerPortalRoutes(app, deps);
await registerEidRoutes(app, deps);
await app.listen({ port, host: "0.0.0.0" });
console.log(`portal preview on ${base}/r/tok-eva`);

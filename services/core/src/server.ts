// Fastify app. Owned by the coordinator. Areas register their routes through their own plugin.

import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Deps } from "./container.ts";
import { registerApiRoutes } from "./api/routes.ts";
import { registerPortalRoutes } from "./portal/routes.ts";
import { registerEidRoutes } from "./eid/routes.ts";
import { registerNotifyRoutes } from "./notify/routes.ts";
import { registerChatRoutes } from "./chat/routes.ts";

export async function buildServer(deps: Deps): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

  await app.register(cookie, { secret: deps.config.sessionSecret });
  await app.register(formbody);
  await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

  app.get("/health", async () => ({ ok: true, service: "brieftaube-core" }));

  await registerApiRoutes(app, deps); // /api/*            (Account A, Dev Core)
  await registerPortalRoutes(app, deps); // /r/*            (Account B, Dev Outside)
  await registerEidRoutes(app, deps); // /mock-eid/*        (Account B, Dev Outside)
  await registerNotifyRoutes(app, deps); // /dev/sms, /api/dev/sms (Account B, Dev Outside)
  await registerChatRoutes(app, deps); // /api/chat/*       (Account B, Dev Matrix)

  // Doctor UI (built by `npm run ui:build`) served at /widget/ — works inside Element and standalone.
  const uiDist = resolve("apps/doctor-ui/dist");
  if (existsSync(uiDist)) {
    await app.register(fastifyStatic, { root: uiDist, prefix: "/widget/", decorateReply: false });
  } else {
    app.get("/widget/*", async (_req, reply) =>
      reply.code(503).send("Doctor UI not built. Run: npm run ui:build (or npm run ui:dev on :5173)"),
    );
  }

  return app;
}

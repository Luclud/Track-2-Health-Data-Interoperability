// Account B, Dev Outside — task OUT-1. SMS simulator: GET /api/dev/sms (JSON) and GET /dev/sms (page).
import type { FastifyInstance } from "fastify";
import type { Deps } from "../container.ts";

export async function registerNotifyRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.get("/api/dev/sms", async () => {
    const inbox = await deps.sms.inbox();
    return inbox.map((m) => ({ id: m.id, to: m.to, body: m.body, sentAt: m.sentAt }));
  });
  // TODO OUT-1: GET /dev/sms — a phone-like page that lists the simulated SMS with clickable links.
}

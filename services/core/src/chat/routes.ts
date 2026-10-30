// Account B, Dev Matrix. GET /api/chat/messages?roomId=... (standalone website timeline)
// In CHAT_MODE=matrix also runs the `!brieftaube status` bot (BOT-1).
import type { FastifyInstance } from "fastify";
import type { Deps } from "../container.ts";
import { StatusBot } from "./bot.ts";
import { resolveMatrixRuntime } from "./runtime.ts";

export async function registerChatRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const runtime = resolveMatrixRuntime(deps.config);
  app.get<{ Querystring: { roomId?: string } }>("/api/chat/messages", async (req) => {
    return deps.chat.list(req.query.roomId || runtime.roomId);
  });

  if (deps.config.chatMode === "matrix") {
    const bot = new StatusBot({
      runtime,
      chat: deps.chat,
      listForRoom: (roomId) => deps.requests.listForRoom(roomId),
      log: (msg) => app.log.warn(msg),
    });
    app.addHook("onReady", async () => bot.start());
    app.addHook("onClose", async () => bot.stop());
  }
}

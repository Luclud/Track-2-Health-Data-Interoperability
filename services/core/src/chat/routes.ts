// Account B, Dev Matrix. GET /api/chat/messages?roomId=... (standalone website timeline)
import type { FastifyInstance } from "fastify";
import type { Deps } from "../container.ts";
import { resolveMatrixRuntime } from "./runtime.ts";

export async function registerChatRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const defaultRoomId = resolveMatrixRuntime(deps.config).roomId;
  app.get<{ Querystring: { roomId?: string } }>("/api/chat/messages", async (req) => {
    return deps.chat.list(req.query.roomId || defaultRoomId);
  });
}

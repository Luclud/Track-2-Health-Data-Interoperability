// Account B, Dev Matrix — task MATRIX-2.
import { randomUUID } from "node:crypto";
import type { ChatMessageView } from "@brieftaube/shared";
import type { Config } from "../config.ts";
import type { ChatNotifier } from "../ports.ts";
import { NotImplementedError } from "../not-implemented.ts";

/** Standalone website / tests: keeps the room timeline in memory. Done — do not break. */
export class InMemoryChatNotifier implements ChatNotifier {
  private messages: ChatMessageView[] = [];
  async post(m: Omit<ChatMessageView, "id" | "sentAt" | "sender">): Promise<void> {
    this.messages.push({ ...m, id: randomUUID(), sentAt: new Date().toISOString(), sender: "@brieftaube:klinikum.example" });
  }
  async list(roomId: string): Promise<ChatMessageView[]> {
    return this.messages.filter((m) => m.roomId === roomId);
  }
}

/** TODO MATRIX-2: post m.room.message (with formatted_body) as the bot user via the client-server API. */
export class MatrixNotifier implements ChatNotifier {
  constructor(private readonly config: Config) {}
  async post(_m: Omit<ChatMessageView, "id" | "sentAt" | "sender">): Promise<void> {
    throw new NotImplementedError("MatrixNotifier.post", "MATRIX-2");
  }
  async list(): Promise<ChatMessageView[]> {
    return [];
  }
}

export function createChatNotifier(config: Config): ChatNotifier {
  return config.chatMode === "matrix" ? new MatrixNotifier(config) : new InMemoryChatNotifier();
}

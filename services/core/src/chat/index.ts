// Dev Matrix — task MATRIX-2.
import { randomUUID } from "node:crypto";
import type { ChatMessageView } from "@brieftaube/shared";
import type { Config } from "../config.ts";
import type { ChatNotifier } from "../ports.ts";
import { resolveMatrixRuntime, STANDALONE_ROOM_ID, type MatrixRuntime } from "./runtime.ts";

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

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface MatrixNotifierOptions {
  runtime?: MatrixRuntime;
  fetch?: FetchLike;
  /** Delay before the single retry (ms) */
  retryDelayMs?: number;
}

/** Content of the m.room.message event the bot sends. Exported for tests and BOT-1. */
export function matrixMessageContent(m: Pick<ChatMessageView, "body" | "html" | "severity">): Record<string, unknown> {
  const content: Record<string, unknown> = { msgtype: "m.notice", body: m.body };
  content.format = "org.matrix.custom.html";
  content.formatted_body = m.html ?? escapeHtml(m.body).replace(/\n/g, "<br>");
  // Not shown by Element; lets other tools (and the standalone timeline) keep the colour of the message.
  content["io.brieftaube.severity"] = m.severity;
  return content;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Posts m.room.message (body + formatted_body) as the bot user via the client-server API. Retries once. */
export class MatrixNotifier implements ChatNotifier {
  private readonly runtime: MatrixRuntime;
  private readonly fetchImpl: FetchLike;
  private readonly retryDelayMs: number;

  constructor(config: Config, opts: MatrixNotifierOptions = {}) {
    this.runtime = opts.runtime ?? resolveMatrixRuntime(config);
    this.fetchImpl = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.retryDelayMs = opts.retryDelayMs ?? 500;
  }

  /** Room the message goes to: the request's room, or the seeded room for the standalone placeholder. */
  roomFor(roomId: string | undefined): string {
    return !roomId || roomId === STANDALONE_ROOM_ID ? this.runtime.roomId : roomId;
  }

  async post(m: Omit<ChatMessageView, "id" | "sentAt" | "sender">): Promise<void> {
    if (!this.runtime.botAccessToken) {
      throw new Error("MatrixNotifier: no bot token. Run `npm run seed` (writes data/runtime.json) or set MATRIX_BOT_TOKEN.");
    }
    const roomId = this.roomFor(m.roomId);
    const txnId = `bt-${randomUUID()}`; // same txn id on retry -> Synapse deduplicates
    const url = `${this.runtime.synapseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`;
    const init = {
      method: "PUT",
      headers: { authorization: `Bearer ${this.runtime.botAccessToken}`, "content-type": "application/json" },
      body: JSON.stringify(matrixMessageContent(m)),
    };
    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, this.retryDelayMs));
      try {
        const res = await this.fetchImpl(url, init);
        if (res.ok) return;
        lastError = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }
    throw new Error(`MatrixNotifier: posting to ${roomId} failed twice (${lastError})`);
  }

  async list(): Promise<ChatMessageView[]> {
    return [];
  }
}

export function createChatNotifier(config: Config): ChatNotifier {
  return config.chatMode === "matrix" ? new MatrixNotifier(config) : new InMemoryChatNotifier();
}

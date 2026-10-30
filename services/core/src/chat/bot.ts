// Dev Matrix — task BOT-1. `!brieftaube status` in the room lists open requests.
import type { ChatMessageView, DocumentRequest, RequestStatus } from "@brieftaube/shared";
import type { ChatNotifier } from "../ports.ts";
import { STANDALONE_ROOM_ID, type MatrixRuntime } from "./runtime.ts";

type Reply = Omit<ChatMessageView, "id" | "sentAt" | "sender">;

const CLOSED: RequestStatus[] = ["filed", "expired", "cancelled"];

const STATUS_DE: Record<RequestStatus, string> = {
  sent: "gesendet, Link noch nicht geöffnet",
  opened: "Link geöffnet, Identität noch nicht geprüft",
  "identity-failed": "falsche Person hat geöffnet – wartet auf richtige Empfänger:in",
  verified: "Identität bestätigt, Antwort ausständig",
  filed: "abgelegt",
  held: "wartet auf Ihre Freigabe",
  rejected: "Antwort abgelehnt – wartet auf korrigierte Antwort",
  expired: "abgelaufen",
  cancelled: "storniert",
};

const DOC_DE: Record<DocumentRequest["documentType"], string> = {
  "lab-result": "Laborbefund",
  "rehab-discharge-report": "Reha-Entlassungsbericht",
};

export type BotCommand = "status" | "help";

/** `!brieftaube status` → "status"; `!brieftaube` / `!brieftaube hilfe` / unknown sub-command → "help"; else undefined. */
export function parseCommand(body: string): BotCommand | undefined {
  const m = /^\s*!brieftaube\b\s*(\S*)/i.exec(body);
  if (!m) return undefined;
  return m[1]?.toLowerCase() === "status" ? "status" : "help";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function helpMessage(roomId: string): Reply {
  return {
    roomId,
    severity: "info",
    body: "Befehle: „!brieftaube status“ – offene Anfragen in diesem Raum anzeigen.",
    html: "Befehle: <b>!brieftaube status</b> – offene Anfragen in diesem Raum anzeigen.",
  };
}

/** Room reply listing open requests (oldest first). Room-internal, so patient names are fine here. */
export function statusMessage(roomId: string, requests: DocumentRequest[]): Reply {
  const open = requests.filter((r) => !CLOSED.includes(r.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (open.length === 0) {
    return { roomId, severity: "success", body: "✅ Keine offenen Anfragen.", html: "✅ Keine offenen Anfragen." };
  }
  const line = (r: DocumentRequest) =>
    `${r.reference} – ${DOC_DE[r.documentType]} für ${r.patient.name.given.join(" ")} ${r.patient.name.family} an ${r.recipient.displayName}: ${STATUS_DE[r.status]}`;
  const needsAction = open.some((r) => r.status === "held");
  const head = `📋 ${open.length} offene Anfrage${open.length === 1 ? "" : "n"}:`;
  return {
    roomId,
    severity: needsAction ? "warning" : "info",
    body: [head, ...open.map((r) => `• ${line(r)}`)].join("\n"),
    html:
      `${esc(head)}<ul>` +
      open
        .map(
          (r) =>
            `<li><b>${esc(r.reference)}</b> – ${esc(DOC_DE[r.documentType])} für <b>${esc(`${r.patient.name.given.join(" ")} ${r.patient.name.family}`)}</b>` +
            ` an ${esc(r.recipient.displayName)}: ${esc(STATUS_DE[r.status])}</li>`,
        )
        .join("") +
      "</ul>",
  };
}

type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

interface SyncResponse {
  next_batch: string;
  rooms?: { join?: Record<string, { timeline?: { events?: { type: string; sender: string; event_id: string; content?: { body?: unknown; msgtype?: unknown } }[] } }> };
}

export interface StatusBotDeps {
  runtime: MatrixRuntime;
  chat: ChatNotifier;
  listForRoom(roomId: string): Promise<DocumentRequest[]>;
  fetch?: FetchLike;
  log?: (msg: string) => void;
}

/** Long-polls /sync as the bot and answers `!brieftaube` commands. Skips history from before start(). */
export class StatusBot {
  private since: string | undefined;
  private stopped = false;
  private abort = new AbortController();
  private readonly fetchImpl: FetchLike;

  constructor(private readonly deps: StatusBotDeps) {
    this.fetchImpl = deps.fetch ?? (globalThis.fetch as unknown as FetchLike);
  }

  /** One /sync round. Returns the number of commands answered. Exposed for tests. */
  async syncOnce(timeoutMs: number): Promise<number> {
    const { synapseUrl, botAccessToken } = this.deps.runtime;
    const params = new URLSearchParams({ timeout: String(this.since ? timeoutMs : 0) });
    if (this.since) params.set("since", this.since);
    else params.set("filter", JSON.stringify({ room: { timeline: { limit: 0 } }, presence: { not_types: ["*"] } }));
    const res = await this.fetchImpl(`${synapseUrl}/_matrix/client/v3/sync?${params}`, {
      headers: { authorization: `Bearer ${botAccessToken}` },
      signal: this.abort.signal,
    });
    if (!res.ok) throw new Error(`sync HTTP ${res.status}`);
    const data = (await res.json()) as SyncResponse;
    const first = this.since === undefined;
    this.since = data.next_batch;
    if (first) return 0;

    let answered = 0;
    for (const [roomId, room] of Object.entries(data.rooms?.join ?? {})) {
      for (const ev of room.timeline?.events ?? []) {
        if (ev.type !== "m.room.message" || ev.sender === this.deps.runtime.botUserId) continue;
        const cmd = typeof ev.content?.body === "string" ? parseCommand(ev.content.body) : undefined;
        if (!cmd) continue;
        await this.deps.chat.post(cmd === "status" ? await this.status(roomId) : helpMessage(roomId));
        answered++;
      }
    }
    return answered;
  }

  private async status(roomId: string): Promise<Reply> {
    try {
      const rooms = roomId === this.deps.runtime.roomId ? [roomId, STANDALONE_ROOM_ID] : [roomId];
      const lists = await Promise.all(rooms.map((r) => this.deps.listForRoom(r)));
      return statusMessage(roomId, lists.flat());
    } catch (e) {
      this.deps.log?.(`status failed: ${e instanceof Error ? e.message : String(e)}`);
      return { roomId, severity: "warning", body: "⚠️ Status gerade nicht verfügbar. Bitte später erneut versuchen." };
    }
  }

  start(): void {
    if (!this.deps.runtime.botAccessToken) {
      this.deps.log?.("StatusBot not started: no bot token (run `npm run seed`)");
      return;
    }
    void (async () => {
      while (!this.stopped) {
        try {
          await this.syncOnce(30_000);
        } catch (e) {
          if (this.stopped) break;
          this.deps.log?.(`StatusBot sync error: ${e instanceof Error ? e.message : String(e)}`);
          await new Promise((r) => setTimeout(r, 5_000));
        }
      }
    })();
  }

  stop(): void {
    this.stopped = true;
    this.abort.abort();
  }
}

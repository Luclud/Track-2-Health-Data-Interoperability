// Dev Matrix — task BOT-1. `!brieftaube status` in the room lists requests by status group.
import type { ChatMessageView, DocumentRequest, RequestStatus } from "@brieftaube/shared";
import type { ChatNotifier } from "../ports.ts";
import { STANDALONE_ROOM_ID, type MatrixRuntime } from "./runtime.ts";

type Reply = Omit<ChatMessageView, "id" | "sentAt" | "sender">;

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

const GROUPS: { label: string; statuses: RequestStatus[] }[] = [
  { label: "Problem", statuses: ["rejected", "expired", "cancelled"] },
  { label: "Zur Prüfung", statuses: ["held"] },
  { label: "Wartet auf Antwort", statuses: ["sent", "opened", "verified", "identity-failed"] },
];

function expiryText(expiresAt: string, now: number): string {
  const left = Date.parse(expiresAt) - now;
  if (Number.isNaN(left)) return "";
  if (left <= 0) return "Frist abgelaufen";
  const min = Math.floor(left / 60_000);
  if (min < 60) return `läuft ab in ${Math.max(min, 1)} min`;
  const h = Math.floor(min / 60);
  return h < 48 ? `läuft ab in ${h} h` : `läuft ab in ${Math.floor(h / 24)} Tagen`;
}

/**
 * Room reply with the same groups as the doctor UI status board (V2-UI-2):
 * Problem and Zur Prüfung first, then Wartet auf Antwort (with expiry, 🔔 after a reminder); filed only as a count.
 * Room-internal, so patient names are fine here.
 */
export function statusMessage(roomId: string, requests: DocumentRequest[], now = Date.now()): Reply {
  const sorted = [...requests].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const groups = GROUPS.map((g) => ({ label: g.label, items: sorted.filter((r) => g.statuses.includes(r.status)) }));
  const filed = sorted.filter((r) => r.status === "filed").length;
  const shown = groups.filter((g) => g.items.length > 0);
  if (shown.length === 0) {
    return { roomId, severity: "success", body: "✅ Keine offenen Anfragen.", html: "✅ Keine offenen Anfragen." };
  }
  const extra = (r: DocumentRequest) =>
    GROUPS[2]!.statuses.includes(r.status)
      ? ` · ${expiryText(r.expiresAt, now)}${r.reminderSentAt ? " · 🔔 Erinnerung gesendet" : ""}`
      : "";
  const who = (r: DocumentRequest) => `${r.patient.name.given.join(" ")} ${r.patient.name.family}`;
  const head = `📋 ${[...groups.map((g) => `${g.items.length} ${g.label}`), `${filed} Abgelegt`].join(" · ")}`;
  return {
    roomId,
    severity: groups[0]!.items.length > 0 || groups[1]!.items.length > 0 ? "warning" : "info",
    body: [
      head,
      ...shown.flatMap((g) => [
        `${g.label}:`,
        ...g.items.map(
          (r) =>
            `• ${r.reference} – ${DOC_DE[r.documentType]} für ${who(r)} an ${r.recipient.displayName}: ${STATUS_DE[r.status]}${extra(r)}`,
        ),
      ]),
    ].join("\n"),
    html:
      esc(head) +
      shown
        .map(
          (g) =>
            `<p><b>${esc(g.label)}</b></p><ul>` +
            g.items
              .map(
                (r) =>
                  `<li><b>${esc(r.reference)}</b> – ${esc(DOC_DE[r.documentType])} für <b>${esc(who(r))}</b>` +
                  ` an ${esc(r.recipient.displayName)}: ${esc(STATUS_DE[r.status] + extra(r))}</li>`,
              )
              .join("") +
            "</ul>",
        )
        .join(""),
  };
}

type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

interface SyncResponse {
  next_batch: string;
  rooms?: { join?: Record<string, { timeline?: { events?: { type: string; sender: string; event_id: string; origin_server_ts?: number; content?: { body?: unknown; msgtype?: unknown } }[] } }> };
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
  /** Commands sent before the bot started are never answered (a restart must not replay old commands). */
  private readonly startedAt = Date.now();

  constructor(private readonly deps: StatusBotDeps) {
    this.fetchImpl = deps.fetch ?? (globalThis.fetch as unknown as FetchLike);
  }

  /** One /sync round. Returns the number of commands answered. Exposed for tests. */
  async syncOnce(timeoutMs: number): Promise<number> {
    const { synapseUrl, botAccessToken } = this.deps.runtime;
    const params = new URLSearchParams({ timeout: String(this.since ? timeoutMs : 0) });
    if (this.since) params.set("since", this.since);
    else params.set("filter", JSON.stringify({ room: { timeline: { limit: 1 } }, presence: { not_types: ["*"] } }));
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
        if ((ev.origin_server_ts ?? Number.MAX_SAFE_INTEGER) < this.startedAt) continue;
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

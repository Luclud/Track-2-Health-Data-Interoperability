import { describe, expect, it } from "vitest";
import type { ChatMessageView, DocumentRequest } from "@brieftaube/shared";
import { parseCommand, statusMessage, StatusBot } from "./bot.ts";
import { STANDALONE_ROOM_ID } from "./runtime.ts";

const ROOM = "!room:klinikum.example";
const BOT = "@brieftaube:klinikum.example";

function req(ref: string, status: DocumentRequest["status"], createdAt: string, roomId = ROOM): DocumentRequest {
  return {
    id: ref,
    reference: ref,
    createdAt,
    expiresAt: createdAt,
    status,
    requester: { matrixUserId: "@lena.hofer:klinikum.example", displayName: "Dr. Lena Hofer", organization: "Klinikum", practitionerId: "lena-hofer" },
    roomId,
    patient: { fhirId: "maria-beispiel", name: { given: ["Maria"], family: "Beispiel" }, birthDate: "1961-03-12" },
    documentType: "lab-result",
    recipient: { displayName: "Dr. Eva Brandl", name: { given: ["Eva"], family: "Brandl" }, role: "", organization: "", channel: "email", address: "eva@x.example", isPhysician: true },
    filedResources: [],
  };
}

describe("parseCommand", () => {
  it("recognises status and help", () => {
    expect(parseCommand("!brieftaube status")).toBe("status");
    expect(parseCommand("  !Brieftaube STATUS ")).toBe("status");
    expect(parseCommand("!brieftaube")).toBe("help");
    expect(parseCommand("!brieftaube hilfe")).toBe("help");
    expect(parseCommand("brieftaube status")).toBeUndefined();
    expect(parseCommand("hallo")).toBeUndefined();
  });
});

describe("statusMessage", () => {
  it("groups like the status board: Problem and Zur Prüfung first, filed only counted", () => {
    const now = Date.parse("2026-10-30T12:00:00Z");
    const m = statusMessage(
      ROOM,
      [
        req("BT-B", "held", "2026-10-30T10:00:00Z"),
        req("BT-F", "filed", "2026-10-30T08:00:00Z"),
        { ...req("BT-A", "sent", "2026-10-30T09:00:00Z"), expiresAt: "2026-10-30T17:30:00Z", reminderSentAt: "2026-10-30T11:00:00Z" },
        req("BT-R", "rejected", "2026-10-30T07:00:00Z"),
      ],
      now,
    );
    expect(m.body.split("\n")).toEqual([
      "📋 1 Problem · 1 Zur Prüfung · 1 Wartet auf Antwort · 1 Abgelegt",
      "Problem:",
      "• BT-R – Laborbefund für Maria Beispiel an Dr. Eva Brandl: Antwort abgelehnt – wartet auf korrigierte Antwort",
      "Zur Prüfung:",
      "• BT-B – Laborbefund für Maria Beispiel an Dr. Eva Brandl: wartet auf Ihre Freigabe",
      "Wartet auf Antwort:",
      "• BT-A – Laborbefund für Maria Beispiel an Dr. Eva Brandl: gesendet, Link noch nicht geöffnet · läuft ab in 5 h · 🔔 Erinnerung gesendet",
    ]);
    expect(m.severity).toBe("warning");
    expect(m.html).toContain("<li><b>BT-R</b>");
    const html = m.html ?? "";
    expect(html.indexOf("Problem")).toBeLessThan(html.indexOf("Wartet auf Antwort"));
  });

  it("is info-only when everything is just waiting", () => {
    expect(statusMessage(ROOM, [req("BT-A", "opened", "2026-10-30T09:00:00Z")]).severity).toBe("info");
  });

  it("says so when nothing is open", () => {
    expect(statusMessage(ROOM, [req("BT-F", "filed", "2026-10-30T08:00:00Z")]).body).toBe("✅ Keine offenen Anfragen.");
  });
});

describe("StatusBot", () => {
  function setup(syncs: unknown[]) {
    const posted: Omit<ChatMessageView, "id" | "sentAt" | "sender">[] = [];
    const urls: string[] = [];
    const listed: string[] = [];
    const bot = new StatusBot({
      runtime: { synapseUrl: "http://syn", botAccessToken: "tok", botUserId: BOT, roomId: ROOM, source: "runtime.json" },
      chat: { post: async (m) => void posted.push(m), list: async () => [] },
      listForRoom: async (roomId) => {
        listed.push(roomId);
        return roomId === STANDALONE_ROOM_ID ? [req("BT-S", "verified", "2026-10-30T07:00:00Z", roomId)] : [req("BT-A", "sent", "2026-10-30T09:00:00Z")];
      },
      fetch: async (url) => {
        urls.push(url);
        return { ok: true, status: 200, json: async () => syncs.shift() };
      },
    });
    return { bot, posted, urls, listed };
  }

  const msg = (sender: string, body: string, ts = Date.now() + 1000) => ({
    type: "m.room.message",
    sender,
    event_id: `$${body}`,
    origin_server_ts: ts,
    content: { msgtype: "m.text", body },
  });

  it("ignores commands sent before the bot started", async () => {
    const { bot, posted } = setup([
      { next_batch: "s1" },
      { next_batch: "s2", rooms: { join: { [ROOM]: { timeline: { events: [msg("@lena.hofer:klinikum.example", "!brieftaube status", 1)] } } } } },
    ]);
    await bot.syncOnce(0);
    expect(await bot.syncOnce(0)).toBe(0);
    expect(posted).toHaveLength(0);
  });

  it("skips history on the first sync, then answers commands but not its own messages", async () => {
    const { bot, posted, urls, listed } = setup([
      { next_batch: "s1", rooms: { join: { [ROOM]: { timeline: { events: [msg("@lena.hofer:klinikum.example", "!brieftaube status")] } } } } },
      {
        next_batch: "s2",
        rooms: {
          join: {
            [ROOM]: {
              timeline: { events: [msg("@lena.hofer:klinikum.example", "!brieftaube status"), msg(BOT, "!brieftaube status"), msg("@lena.hofer:klinikum.example", "danke")] },
            },
          },
        },
      },
    ]);
    expect(await bot.syncOnce(1000)).toBe(0);
    expect(urls[0]).toContain("timeout=0");
    expect(urls[0]).toContain("filter=");
    expect(await bot.syncOnce(1000)).toBe(1);
    expect(urls[1]).toContain("since=s1");
    expect(listed).toEqual([ROOM, STANDALONE_ROOM_ID]);
    expect(posted).toHaveLength(1);
    expect(posted[0]!.roomId).toBe(ROOM);
    expect(posted[0]!.body).toContain("BT-S");
    expect(posted[0]!.body).toContain("BT-A");
  });

  it("replies with a German fallback when the request service fails", async () => {
    const { bot, posted } = setup([
      { next_batch: "s1" },
      { next_batch: "s2", rooms: { join: { "!other:klinikum.example": { timeline: { events: [msg("@lena.hofer:klinikum.example", "!brieftaube status")] } } } } },
    ]);
    // other room -> only that room is listed; make listing fail
    (bot as unknown as { deps: { listForRoom: () => Promise<never> } }).deps.listForRoom = async () => {
      throw new Error("not implemented");
    };
    await bot.syncOnce(0);
    await bot.syncOnce(0);
    expect(posted[0]!.body).toContain("Status gerade nicht verfügbar");
    expect(posted[0]!.roomId).toBe("!other:klinikum.example");
  });
});

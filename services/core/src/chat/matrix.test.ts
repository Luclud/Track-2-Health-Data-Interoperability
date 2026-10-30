import { describe, expect, it } from "vitest";
import { config } from "../config.ts";
import { MatrixNotifier, matrixMessageContent } from "./index.ts";
import { STANDALONE_ROOM_ID, type MatrixRuntime } from "./runtime.ts";

const runtime: MatrixRuntime = {
  synapseUrl: "http://synapse.test",
  botAccessToken: "bot-token",
  botUserId: "@brieftaube:klinikum.example",
  roomId: "!seeded:klinikum.example",
  source: "runtime.json",
};

type Call = { url: string; method: string; headers: Record<string, string>; body: string };

function fakeFetch(statuses: (number | Error)[]) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    calls.push({ url, ...init });
    const s = statuses[Math.min(calls.length - 1, statuses.length - 1)]!;
    if (s instanceof Error) throw s;
    return { ok: s >= 200 && s < 300, status: s, text: async () => (s >= 400 ? '{"errcode":"M_UNKNOWN"}' : '{"event_id":"$e"}') };
  };
  return { fetch, calls };
}

const msg = {
  roomId: "!room:klinikum.example",
  body: "✅ BT-7K2Q: Laborbefund abgelegt.",
  html: "✅ <b>BT-7K2Q</b>: Laborbefund abgelegt.",
  severity: "success" as const,
};

describe("MatrixNotifier", () => {
  it("PUTs m.room.message with formatted_body as the bot", async () => {
    const f = fakeFetch([200]);
    await new MatrixNotifier(config, { runtime, fetch: f.fetch, retryDelayMs: 0 }).post(msg);
    expect(f.calls).toHaveLength(1);
    const call = f.calls[0]!;
    expect(call.method).toBe("PUT");
    expect(call.url).toMatch(/^http:\/\/synapse\.test\/_matrix\/client\/v3\/rooms\/!room%3Aklinikum\.example\/send\/m\.room\.message\/bt-/);
    expect(call.headers.authorization).toBe("Bearer bot-token");
    expect(JSON.parse(call.body)).toMatchObject({
      msgtype: "m.notice",
      body: msg.body,
      format: "org.matrix.custom.html",
      formatted_body: msg.html,
    });
  });

  it("retries once with the same transaction id, then succeeds", async () => {
    const f = fakeFetch([502, 200]);
    await new MatrixNotifier(config, { runtime, fetch: f.fetch, retryDelayMs: 0 }).post(msg);
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0]!.url).toBe(f.calls[1]!.url);
  });

  it("throws after the retry also fails (network error, then HTTP error)", async () => {
    const f = fakeFetch([new Error("ECONNREFUSED"), 500]);
    await expect(new MatrixNotifier(config, { runtime, fetch: f.fetch, retryDelayMs: 0 }).post(msg)).rejects.toThrow(/failed twice.*HTTP 500/);
    expect(f.calls).toHaveLength(2);
  });

  it("sends the standalone placeholder room to the seeded room", async () => {
    const f = fakeFetch([200]);
    await new MatrixNotifier(config, { runtime, fetch: f.fetch }).post({ ...msg, roomId: STANDALONE_ROOM_ID });
    expect(f.calls[0]!.url).toContain(encodeURIComponent("!seeded:klinikum.example"));
  });

  it("fails clearly without a bot token", async () => {
    const f = fakeFetch([200]);
    const n = new MatrixNotifier(config, { runtime: { ...runtime, botAccessToken: "" }, fetch: f.fetch });
    await expect(n.post(msg)).rejects.toThrow(/npm run seed/);
    expect(f.calls).toHaveLength(0);
  });

  it("list() returns nothing (Element shows the timeline)", async () => {
    expect(await new MatrixNotifier(config, { runtime }).list()).toEqual([]);
  });
});

describe("matrixMessageContent", () => {
  it("escapes plain text when no html is given", () => {
    expect(matrixMessageContent({ body: "a <b> & c\nd", severity: "info" }).formatted_body).toBe("a &lt;b&gt; &amp; c<br>d");
  });
});

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveMatrixRuntime, STANDALONE_ROOM_ID } from "./runtime.ts";

const base = {
  synapseUrl: "http://localhost:8008/",
  matrixServerName: "klinikum.example",
  botAccessToken: "",
  defaultRoomId: STANDALONE_ROOM_ID,
};

function dirWith(content: string | undefined): string {
  const dir = mkdtempSync(join(tmpdir(), "bt-runtime-"));
  if (content !== undefined) writeFileSync(join(dir, "runtime.json"), content);
  return dir;
}

describe("resolveMatrixRuntime", () => {
  it("falls back to the standalone room without runtime.json", () => {
    const rt = resolveMatrixRuntime({ ...base, dataDir: dirWith(undefined) });
    expect(rt).toMatchObject({ roomId: STANDALONE_ROOM_ID, botAccessToken: "", source: "default", synapseUrl: "http://localhost:8008" });
    expect(rt.botUserId).toBe("@brieftaube:klinikum.example");
  });

  it("reads token and room from runtime.json when env is empty", () => {
    const dataDir = dirWith(JSON.stringify({ botAccessToken: "tok", botUserId: "@bot:x", roomId: "!r:klinikum.example" }));
    expect(resolveMatrixRuntime({ ...base, dataDir })).toMatchObject({
      botAccessToken: "tok",
      botUserId: "@bot:x",
      roomId: "!r:klinikum.example",
      source: "runtime.json",
    });
  });

  it("env wins over runtime.json", () => {
    const dataDir = dirWith(JSON.stringify({ botAccessToken: "file", roomId: "!file:x" }));
    const rt = resolveMatrixRuntime({ ...base, dataDir, botAccessToken: "env", defaultRoomId: "!env:x" });
    expect(rt).toMatchObject({ botAccessToken: "env", roomId: "!env:x", source: "env" });
  });

  it("ignores a broken runtime.json", () => {
    expect(resolveMatrixRuntime({ ...base, dataDir: dirWith("{not json") }).source).toBe("default");
  });
});

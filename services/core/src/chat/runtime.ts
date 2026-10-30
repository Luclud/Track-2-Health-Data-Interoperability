// Dev Matrix — INFRA-2. Matrix runtime values (bot token, room id) come from env first,
// then from DATA_DIR/runtime.json written by `npm run seed`. config.ts stays untouched.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config.ts";

/** Default room id in config.ts when MATRIX_ROOM_ID is empty */
export const STANDALONE_ROOM_ID = "!standalone:klinikum.example";

export interface MatrixRuntime {
  synapseUrl: string;
  botAccessToken: string;
  botUserId: string;
  roomId: string;
  /** "env" | "runtime.json" | "default" — for the startup log */
  source: "env" | "runtime.json" | "default";
}

interface RuntimeFile {
  botAccessToken?: string;
  botUserId?: string;
  roomId?: string;
}

export function readRuntimeFile(dataDir: string): RuntimeFile | undefined {
  const path = join(dataDir, "runtime.json");
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as RuntimeFile;
  } catch {
    return undefined;
  }
}

type RuntimeConfig = Pick<Config, "dataDir" | "synapseUrl" | "matrixServerName" | "botAccessToken" | "defaultRoomId">;

export function resolveMatrixRuntime(config: RuntimeConfig, file: RuntimeFile | undefined = readRuntimeFile(config.dataDir)): MatrixRuntime {
  const envRoom = config.defaultRoomId !== STANDALONE_ROOM_ID ? config.defaultRoomId : "";
  const botAccessToken = config.botAccessToken || file?.botAccessToken || "";
  const roomId = envRoom || file?.roomId || config.defaultRoomId;
  const source = config.botAccessToken || envRoom ? "env" : file?.botAccessToken || file?.roomId ? "runtime.json" : "default";
  return {
    synapseUrl: config.synapseUrl.replace(/\/$/, ""),
    botAccessToken,
    botUserId: file?.botUserId || `@brieftaube:${config.matrixServerName}`,
    roomId,
    source,
  };
}

// V2-TEST-2: starts an extra core process with its own config (jury mode, mock LLM, fast scheduler) next to the
// main core, sharing HAPI and Mailpit. Each extra core has its own port, DATA_DIR and in-memory chat.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { coreApiAt, sleep, type CoreApi } from "./stack.ts";

export interface ExtraCore {
  base: string;
  api: CoreApi;
  dataDir: string;
  /** For LLM_PROVIDER=mock: what the "model" answers next (read on every call). */
  setLlmMock(doc: unknown): void;
  log(): string;
  stop(): Promise<void>;
}

export async function isUp(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

/** HAPI and Mailpit are reachable (the extra cores need nothing else). */
export async function isStackUp(): Promise<boolean> {
  const fhir = process.env.FHIR_BASE_URL ?? "http://localhost:8090/fhir";
  const mailpit = process.env.MAILPIT_API_URL ?? "http://localhost:8025/api/v1";
  return (await isUp(`${fhir}/metadata`)) && (await isUp(`${mailpit}/info`));
}

export async function startCore(name: string, port: number, env: Record<string, string>): Promise<ExtraCore> {
  const base = `http://localhost:${port}`;
  const dataDir = resolve("out/e2e-cores", name);
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  let out = "";
  const child: ChildProcess = spawn(resolve("node_modules/.bin/tsx"), ["services/core/src/main.ts"], {
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_BASE_URL: base,
      EID_ISSUER_URL: `${base}/mock-eid`,
      DATA_DIR: dataDir,
      CHAT_MODE: "memory",
      AUTH_MODE: "dev",
      MAIL_MODE: "smtp",
      LOG_LEVEL: "warn",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (out += d.toString()));
  const end = Date.now() + 60_000;
  while (!(await isUp(`${base}/health`))) {
    if (child.exitCode !== null || Date.now() > end) throw new Error(`core ${name} did not start on :${port}\n${out.slice(-2000)}`);
    await sleep(300);
  }
  return {
    base,
    api: coreApiAt(base),
    dataDir,
    setLlmMock: (doc) => writeFileSync(resolve(dataDir, "llm-mock.json"), JSON.stringify(doc)),
    log: () => out,
    stop: async () => {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await new Promise((r) => child.once("exit", r));
    },
  };
}

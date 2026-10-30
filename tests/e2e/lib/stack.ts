// Clients for the running stack: core API, Mailpit, SMS simulator, HAPI FHIR, chat (memory timeline or Matrix).
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  ChatMessageView,
  CreateRequestBody,
  CreateRequestResponse,
  HeldDecisionResponse,
  RecipientCheckResponse,
  RequestDetailResponse,
  SmsView,
} from "@brieftaube/shared";

export const CORE = process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";
export const FHIR = process.env.FHIR_BASE_URL ?? "http://localhost:8090/fhir";
export const MAILPIT = process.env.MAILPIT_API_URL ?? "http://localhost:8025/api/v1";
export const SYNAPSE = process.env.SYNAPSE_URL ?? "http://localhost:8008";
export const PATIENT_ID = process.env.SCENARIO_PATIENT_ID ?? "maria-beispiel";
export const DEV_USER = "@lena.hofer:klinikum.example";
const DATA_DIR = process.env.DATA_DIR ?? "data";

export async function isCoreUp(): Promise<boolean> {
  try {
    const res = await fetch(`${CORE}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export function runtime(): { roomId?: string; lenaAccessToken?: string } {
  const f = resolve(DATA_DIR, "runtime.json");
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as { roomId?: string; lenaAccessToken?: string }) : {};
}

export const ROOM_ID = process.env.MATRIX_ROOM_ID || runtime().roomId || "!standalone:klinikum.example";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function poll<T>(what: string, fn: () => Promise<T | undefined>, timeoutMs = 15_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(300);
  }
}

// ------------------------------------------------------------------ core API (doctor side)

/** E2E_AUTH=matrix (core with AUTH_MODE=matrix): a Synapse OpenID token for Lena, as the Element widget sends it. */
export const E2E_AUTH = process.env.E2E_AUTH ?? "dev";
let openIdToken: string | undefined;

async function lenaAccessToken(): Promise<string> {
  const res = await fetch(`${SYNAPSE}/_matrix/client/v3/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "m.login.password", identifier: { type: "m.id.user", user: "lena.hofer" }, password: "demo-lena-2026" }),
  });
  if (!res.ok) throw new Error(`Synapse login as lena.hofer -> ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function doctorAuth(): Promise<Record<string, string>> {
  if (E2E_AUTH !== "matrix") return { "x-dev-user": DEV_USER };
  if (!openIdToken) {
    const res = await fetch(`${SYNAPSE}/_matrix/client/v3/user/${encodeURIComponent(DEV_USER)}/openid/request_token`, {
      method: "POST",
      headers: { authorization: `Bearer ${await lenaAccessToken()}`, "content-type": "application/json" },
      body: "{}",
    });
    if (!res.ok) throw new Error(`OpenID token for ${DEV_USER} -> ${res.status}: ${await res.text()}`);
    openIdToken = ((await res.json()) as { access_token: string }).access_token;
  }
  return { authorization: `Bearer ${openIdToken}` };
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${CORE}${path}`, {
    method,
    headers: { ...(await doctorAuth()), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text) as T;
}

export const coreApi = {
  recipientCheck: (body: { channel: "email" | "sms"; address: string; displayName: string }) =>
    api<RecipientCheckResponse>("POST", "/api/recipient-check", body),
  createRequest: (body: CreateRequestBody) => api<CreateRequestResponse>("POST", "/api/requests", body),
  detail: (id: string) => api<RequestDetailResponse>("GET", `/api/requests/${encodeURIComponent(id)}`),
  chat: (roomId: string) => api<ChatMessageView[]>("GET", `/api/chat/messages?roomId=${encodeURIComponent(roomId)}`),
  sms: () => api<SmsView[]>("GET", "/api/dev/sms"),
  release: (id: string) => api<HeldDecisionResponse>("POST", `/api/requests/${encodeURIComponent(id)}/release`),
};

export function labRequest(address: string, note = "Bitte die aktuellen Gerinnungswerte vor dem geplanten Eingriff."): CreateRequestBody {
  return {
    patientId: PATIENT_ID,
    documentType: "lab-result",
    note,
    roomId: ROOM_ID,
    recipient: { displayName: "Dr. Eva Brandl", role: "Laborärztin", organization: "Labor Kanalstraße", isPhysician: true, channel: "email", address },
    acknowledgeWarnings: true,
  };
}

export function rehabRequest(): CreateRequestBody {
  return {
    patientId: PATIENT_ID,
    documentType: "rehab-discharge-report",
    note: "Bitte den Entlassungsbericht der Reha.",
    roomId: ROOM_ID,
    recipient: { displayName: "Stefan Kern", role: "Entlassungsmanagement", organization: "Reha Waldblick", isPhysician: false, channel: "sms", address: "+43 660 000 0101" },
    acknowledgeWarnings: true,
  };
}

// ------------------------------------------------------------------ notifications

export interface Mail {
  id: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
}

/** Newest Mailpit message whose text mentions the request reference. */
export async function mailFor(reference: string): Promise<Mail> {
  return poll(`email with ${reference} in Mailpit`, async () => {
    const res = await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`"${reference}"`)}&limit=5`);
    if (!res.ok) return undefined;
    const list = (await res.json()) as { messages?: { ID: string }[] };
    const first = list.messages?.[0];
    if (!first) return undefined;
    const m = (await (await fetch(`${MAILPIT}/message/${first.ID}`)).json()) as {
      ID: string;
      To?: { Address: string }[];
      Subject?: string;
      Text?: string;
      HTML?: string;
    };
    return { id: m.ID, to: (m.To ?? []).map((t) => t.Address), subject: m.Subject ?? "", text: m.Text ?? "", html: m.HTML ?? "" };
  });
}

export async function smsFor(reference: string): Promise<SmsView> {
  return poll(`SMS with ${reference} in /api/dev/sms`, async () => (await coreApi.sms()).find((s) => s.body.includes(reference)));
}

/** The portal link in an email/SMS body. */
export function linkIn(text: string): { url: string; token: string } {
  const m = /(https?:\/\/[^\s"'<>]+\/r\/([A-Za-z0-9_-]{16,}))/.exec(text);
  if (!m) throw new Error(`No /r/<token> link found in: ${text.slice(0, 300)}`);
  return { url: m[1]!, token: m[2]! };
}

// ------------------------------------------------------------------ chat (memory timeline or Matrix room)

let matrixToken: string | undefined;

async function matrixMessages(roomId: string): Promise<{ body: string }[]> {
  if (!matrixToken) {
    matrixToken = runtime().lenaAccessToken;
    if (!matrixToken) {
      const res = await fetch(`${SYNAPSE}/_matrix/client/v3/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "m.login.password", identifier: { type: "m.id.user", user: "lena.hofer" }, password: "demo-lena-2026" }),
      });
      if (!res.ok) return [];
      matrixToken = ((await res.json()) as { access_token: string }).access_token;
    }
  }
  const res = await fetch(`${SYNAPSE}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=100`, {
    headers: { authorization: `Bearer ${matrixToken}` },
  });
  if (!res.ok) return [];
  const { chunk } = (await res.json()) as { chunk: { type: string; content?: { body?: string } }[] };
  return chunk.filter((e) => e.type === "m.room.message" && e.content?.body).map((e) => ({ body: e.content!.body! }));
}

/** Messages in Dr. Hofer's room: the in-memory timeline (CHAT_MODE=memory) or the Matrix room (CHAT_MODE=matrix). */
export async function chatMessages(roomId = ROOM_ID): Promise<{ body: string }[]> {
  const mem = await coreApi.chat(roomId).catch(() => [] as ChatMessageView[]);
  if (mem.length) return mem;
  return matrixMessages(roomId).catch(() => []);
}

export async function chatMessageMatching(what: string, pred: (body: string) => boolean): Promise<string> {
  return poll(`chat message: ${what}`, async () => (await chatMessages()).map((m) => m.body).find(pred));
}

// ------------------------------------------------------------------ FHIR

export async function fhirRead<T = Record<string, unknown>>(ref: string): Promise<T> {
  const res = await fetch(`${FHIR}/${ref}`, { headers: { accept: "application/fhir+json" } });
  if (!res.ok) throw new Error(`GET ${FHIR}/${ref} -> ${res.status}`);
  return (await res.json()) as T;
}

export async function fhirSearch<T = Record<string, unknown>>(type: string, params: Record<string, string>): Promise<T[]> {
  const res = await fetch(`${FHIR}/${type}?${new URLSearchParams({ ...params, _count: "200" })}`, { headers: { accept: "application/fhir+json" } });
  if (!res.ok) throw new Error(`search ${type} -> ${res.status}`);
  const b = (await res.json()) as { entry?: { resource: T }[] };
  return (b.entry ?? []).map((e) => e.resource);
}

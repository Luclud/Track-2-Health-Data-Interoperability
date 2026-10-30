// Seeds the local stack. Owner: Dev Matrix (task INFRA-2). Idempotent: safe to run twice.
//
// Steps:
//  1. Synapse: register @lena.hofer (password "demo-lena-2026") and @brieftaube (bot) via the shared-secret
//     admin API (POST /_synapse/admin/v1/register, HMAC with registration_shared_secret from infra/synapse/homeserver.yaml).
//     Set display names "Dr. Lena Hofer" and "Brieftaube".
//  2. Log in as lena.hofer, create room "Anfragen – Dr. Hofer" (private, alias #anfragen-hofer), invite + join the bot.
//  3. As lena.hofer (so Element trusts the widget without a prompt) send state events:
//       im.vector.modular.widgets (state_key "brieftaube") with
//         { type: "m.custom", url: "<PUBLIC_BASE_URL>/widget/?roomId=$matrix_room_id&userId=$matrix_user_id&widgetId=$matrix_widget_id&parentUrl=$parentUrl", ... }
//       io.element.widgets.layout pinning the widget to the top container
//  4. HAPI: PUT Patient/<SCENARIO_PATIENT_ID> from scenario/patient.json (id replaced),
//     PUT Practitioner/lena-hofer, PUT Organization/klinikum-beispielstadt, plus extra synthetic patients for the picker.
//  5. Write data/runtime.json: { botAccessToken, botUserId, roomId, lenaAccessToken } (core reads it at startup).
//
// Env (all optional): SYNAPSE_URL, MATRIX_SERVER_NAME, PUBLIC_BASE_URL, FHIR_BASE_URL, SCENARIO_PATIENT_ID, DATA_DIR,
// SEED_SKIP_MATRIX=1 / SEED_SKIP_FHIR=1 to seed only one side.
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

loadDotEnv(resolve(".env"));

const SYNAPSE_URL = env("SYNAPSE_URL", "http://localhost:8008").replace(/\/$/, "");
const SERVER_NAME = env("MATRIX_SERVER_NAME", "klinikum.example");
const PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", "http://localhost:3000").replace(/\/$/, "");
const FHIR_BASE_URL = env("FHIR_BASE_URL", "http://localhost:8090/fhir").replace(/\/$/, "");
const PATIENT_ID = env("SCENARIO_PATIENT_ID", "maria-beispiel");
const DATA_DIR = env("DATA_DIR", "data");
const RUNTIME_FILE = join(DATA_DIR, "runtime.json");

const SHARED_SECRET = readSharedSecret();
const LENA = { localpart: "lena.hofer", password: "demo-lena-2026", displayName: "Dr. Lena Hofer" };
const BOT = { localpart: "brieftaube", password: "demo-bot-2026", displayName: "Brieftaube" };
const ROOM_ALIAS_LOCALPART = "anfragen-hofer";
const ROOM_NAME = "Anfragen – Dr. Hofer";
const WIDGET_ID = "brieftaube";

export interface RuntimeFile {
  botAccessToken: string;
  botUserId: string;
  roomId: string;
  lenaAccessToken: string;
  lenaUserId: string;
  widgetUrl: string;
  seededAt: string;
}

// ---------------------------------------------------------------- helpers

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && m[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2] ?? "";
  }
}

function readSharedSecret(): string {
  if (process.env.SYNAPSE_REGISTRATION_SHARED_SECRET) return process.env.SYNAPSE_REGISTRATION_SHARED_SECRET;
  const yaml = readFileSync(resolve("infra/synapse/homeserver.yaml"), "utf8");
  const m = /^registration_shared_secret:\s*"?([^"\n]+)"?/m.exec(yaml);
  if (!m?.[1]) throw new Error("registration_shared_secret not found in infra/synapse/homeserver.yaml");
  return m[1];
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    what: string,
  ) {
    super(`${what} -> HTTP ${status}: ${JSON.stringify(body)}`);
  }
}

async function http<T = Record<string, unknown>>(
  method: string,
  url: string,
  opts: { token?: string; body?: unknown; contentType?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = opts.contentType ?? "application/json";
  const res = await fetch(url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    /* keep text */
  }
  if (!res.ok) throw new HttpError(res.status, parsed, `${method} ${url.replace(/access_token=[^&]+/, "access_token=…")}`);
  return parsed as T;
}

const mx = (path: string) => `${SYNAPSE_URL}/_matrix/client/v3${path}`;
const userId = (localpart: string) => `@${localpart}:${SERVER_NAME}`;

// ---------------------------------------------------------------- Matrix

async function registerUser(u: { localpart: string; password: string; displayName: string }, admin: boolean): Promise<void> {
  const { nonce } = await http<{ nonce: string }>("GET", `${SYNAPSE_URL}/_synapse/admin/v1/register`);
  const mac = createHmac("sha1", SHARED_SECRET)
    .update([nonce, u.localpart, u.password, admin ? "admin" : "notadmin"].join("\0"))
    .digest("hex");
  try {
    await http("POST", `${SYNAPSE_URL}/_synapse/admin/v1/register`, {
      body: { nonce, username: u.localpart, password: u.password, displayname: u.displayName, admin, mac },
    });
    console.log(`  registered ${userId(u.localpart)}`);
  } catch (e) {
    if (e instanceof HttpError && (e.body as { errcode?: string })?.errcode === "M_USER_IN_USE") {
      console.log(`  ${userId(u.localpart)} exists`);
      return;
    }
    throw e;
  }
}

async function tokenFor(u: { localpart: string; password: string }, previous?: string): Promise<string> {
  if (previous) {
    try {
      const who = await http<{ user_id: string }>("GET", mx("/account/whoami"), { token: previous });
      if (who.user_id === userId(u.localpart)) return previous;
    } catch {
      /* token invalid (e.g. after stack:reset) -> log in again */
    }
  }
  const res = await http<{ access_token: string }>("POST", mx("/login"), {
    body: {
      type: "m.login.password",
      identifier: { type: "m.id.user", user: u.localpart },
      password: u.password,
      initial_device_display_name: "brieftaube-seed",
    },
  });
  return res.access_token;
}

async function setDisplayName(token: string, localpart: string, name: string): Promise<void> {
  await http("PUT", mx(`/profile/${encodeURIComponent(userId(localpart))}/displayname`), { token, body: { displayname: name } });
}

async function ensureRoom(lenaToken: string, botUserId: string): Promise<string> {
  const alias = `#${ROOM_ALIAS_LOCALPART}:${SERVER_NAME}`;
  try {
    const { room_id } = await http<{ room_id: string }>("GET", mx(`/directory/room/${encodeURIComponent(alias)}`), { token: lenaToken });
    console.log(`  room ${alias} exists (${room_id})`);
    return room_id;
  } catch (e) {
    if (!(e instanceof HttpError && e.status === 404)) throw e;
  }
  const { room_id } = await http<{ room_id: string }>("POST", mx("/createRoom"), {
    token: lenaToken,
    body: {
      preset: "private_chat",
      visibility: "private",
      room_alias_name: ROOM_ALIAS_LOCALPART,
      name: ROOM_NAME,
      topic: "Dokumente von außen anfordern – Brieftaube meldet hier Status und Ergebnisse.",
      invite: [botUserId],
      // Room v12+: the creator must not appear in power_levels.users (creators are implicitly all-powerful).
      power_level_content_override: { users: { [botUserId]: 50 } },
    },
  });
  console.log(`  created room ${alias} (${room_id})`);
  return room_id;
}

async function ensureJoined(token: string, roomId: string): Promise<void> {
  const { joined_rooms } = await http<{ joined_rooms: string[] }>("GET", mx("/joined_rooms"), { token });
  if (joined_rooms.includes(roomId)) return;
  await http("POST", mx(`/join/${encodeURIComponent(roomId)}`), { token, body: {} });
}

async function ensureInvitedAndJoined(lenaToken: string, botToken: string, roomId: string, botUserId: string): Promise<void> {
  const { joined_rooms } = await http<{ joined_rooms: string[] }>("GET", mx("/joined_rooms"), { token: botToken });
  if (joined_rooms.includes(roomId)) return;
  try {
    await http("POST", mx(`/rooms/${encodeURIComponent(roomId)}/invite`), { token: lenaToken, body: { user_id: botUserId } });
  } catch (e) {
    // already invited is fine
    if (!(e instanceof HttpError && e.status === 403)) throw e;
  }
  await ensureJoined(botToken, roomId);
}

export function widgetUrl(publicBaseUrl: string): string {
  // Element substitutes the $matrix_* / $parentUrl template variables when it loads the widget.
  return `${publicBaseUrl}/widget/?roomId=$matrix_room_id&userId=$matrix_user_id&widgetId=$matrix_widget_id&parentUrl=$parentUrl`;
}

async function putState(token: string, roomId: string, type: string, stateKey: string, content: unknown): Promise<void> {
  await http("PUT", mx(`/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(type)}/${encodeURIComponent(stateKey)}`), {
    token,
    body: content,
  });
}

async function ensureWidget(lenaToken: string, roomId: string): Promise<string> {
  const url = widgetUrl(PUBLIC_BASE_URL);
  await putState(lenaToken, roomId, "im.vector.modular.widgets", WIDGET_ID, {
    id: WIDGET_ID,
    type: "m.custom",
    url,
    name: "Brieftaube – Dokument anfordern",
    creatorUserId: userId(LENA.localpart),
    waitForIframeLoad: true,
    data: { title: "Dokumente von außen anfordern" },
  });
  await putState(lenaToken, roomId, "io.element.widgets.layout", "", {
    widgets: { [WIDGET_ID]: { container: "top", index: 0, width: 100, height: 75 } },
  });
  return url;
}

async function seedMatrix(previous?: Partial<RuntimeFile>): Promise<Omit<RuntimeFile, "seededAt">> {
  console.log(`Synapse ${SYNAPSE_URL}`);
  await registerUser(LENA, false);
  await registerUser(BOT, false);
  const lenaToken = await tokenFor(LENA, previous?.lenaAccessToken);
  const botToken = await tokenFor(BOT, previous?.botAccessToken);
  await setDisplayName(lenaToken, LENA.localpart, LENA.displayName);
  await setDisplayName(botToken, BOT.localpart, BOT.displayName);
  const botUserId = userId(BOT.localpart);
  const roomId = await ensureRoom(lenaToken, botUserId);
  await ensureInvitedAndJoined(lenaToken, botToken, roomId, botUserId);
  const url = await ensureWidget(lenaToken, roomId);
  console.log(`  widget ${WIDGET_ID} pinned (${url})`);
  return { botAccessToken: botToken, botUserId, roomId, lenaAccessToken: lenaToken, lenaUserId: userId(LENA.localpart), widgetUrl: url };
}

// ---------------------------------------------------------------- FHIR

type Resource = { resourceType: string; id: string } & Record<string, unknown>;

export function seedResources(patientId: string, scenarioPatient: Record<string, unknown>): Resource[] {
  const org = {
    resourceType: "Organization",
    id: "klinikum-beispielstadt",
    identifier: [{ system: "urn:brieftaube:organization", value: "klinikum-beispielstadt" }],
    active: true,
    name: "Klinikum Beispielstadt",
    address: [{ city: "Beispielstadt", postalCode: "1000", country: "AT" }],
  };
  const practitioner = {
    resourceType: "Practitioner",
    id: "lena-hofer",
    identifier: [{ system: "urn:brieftaube:matrix-user", value: userId(LENA.localpart) }],
    active: true,
    name: [{ use: "official", family: "Hofer", given: ["Lena"], prefix: ["Dr."] }],
  };
  const extra = (id: string, mrn: string, given: string, family: string, gender: string, birthDate: string): Resource => ({
    resourceType: "Patient",
    id,
    identifier: [{ system: "urn:example:klinikum-beispielstadt:mrn", value: mrn }],
    active: true,
    name: [{ use: "official", family, given: [given] }],
    gender,
    birthDate,
    managingOrganization: { reference: "Organization/klinikum-beispielstadt", display: "Klinikum Beispielstadt" },
  });
  return [
    org,
    practitioner,
    { ...scenarioPatient, resourceType: "Patient", id: patientId } as Resource,
    // Same family name as the scenario patient on purpose: the picker must make the birth date obvious.
    extra("max-beispiel", "KB-000124", "Max", "Beispiel", "male", "1960-01-01"),
    extra("johann-muster", "KB-000125", "Johann", "Muster", "male", "1948-11-02"),
    extra("aylin-demir", "KB-000126", "Aylin", "Demir", "female", "1985-07-23"),
  ];
}

async function seedFhir(): Promise<void> {
  console.log(`FHIR ${FHIR_BASE_URL}`);
  const scenario = JSON.parse(readFileSync(resolve("scenario/patient.json"), "utf8")) as Record<string, unknown>;
  for (const r of seedResources(PATIENT_ID, scenario)) {
    await http("PUT", `${FHIR_BASE_URL}/${r.resourceType}/${r.id}`, { body: r, contentType: "application/fhir+json" });
    console.log(`  PUT ${r.resourceType}/${r.id}`);
  }
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  const previous: Partial<RuntimeFile> = existsSync(RUNTIME_FILE) ? JSON.parse(readFileSync(RUNTIME_FILE, "utf8")) : {};
  let runtime: Partial<RuntimeFile> = previous;
  if (process.env.SEED_SKIP_MATRIX !== "1") {
    runtime = { ...(await seedMatrix(previous)), seededAt: new Date().toISOString() };
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(RUNTIME_FILE, JSON.stringify(runtime, null, 2) + "\n");
    console.log(`  wrote ${RUNTIME_FILE}`);
  }
  if (process.env.SEED_SKIP_FHIR !== "1") await seedFhir();

  console.log(`
Seed done.
  Element      http://localhost:8080   user: ${LENA.localpart}   password: ${LENA.password}
  Room         ${ROOM_NAME} (${runtime.roomId ?? "?"})
  Widget       ${PUBLIC_BASE_URL}/widget/?mode=standalone  (standalone)
  FHIR         ${FHIR_BASE_URL}/Patient/${PATIENT_ID}
`);
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main().catch((e: unknown) => {
    console.error(`seed failed: ${e instanceof Error ? e.message : String(e)}`);
    console.error("Is the stack up? npm run stack:up && infra/wait-for-stack.sh");
    process.exit(1);
  });
}

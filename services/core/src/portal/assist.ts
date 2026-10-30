// ASSIST-1. "KI-Hilfe für Absender": rank the sender's own archive for this request.
// Real use: a local model at the sender. Prototype: a synthetic demo archive on our server,
// ranked by Claude if configured, else by the precomputed mock in scenario/sender-archive/ranking.mock.json.
import { readFileSync } from "node:fs";
import type { DocumentType } from "@brieftaube/shared";
import { DOCUMENT_TYPE_LABELS_DE } from "@brieftaube/shared";
import type { AuthorizedRequestView, LlmClient } from "../ports.ts";
import type { Config } from "../config.ts";
import { DEFAULT_ANTHROPIC_MODEL, MockLlmClient } from "../llm/index.ts";
import { englishDate, withPatient } from "./demo.ts";

export const IMPORTANCE = ["hoch", "mittel", "niedrig", "nicht relevant"] as const;
export type Importance = (typeof IMPORTANCE)[number];

export interface AssistItem { id: string; title: string; date?: string; importance: Importance; reason: string; evidence?: { line: number; text: string }; verified: boolean }
export interface AssistResult { source: "mock" | "llm"; model?: string; items: AssistItem[]; hiddenOtherPatients: number }
export interface ArchiveDocument { id: string; title: string; date?: string; content: string }

type AssistView = Pick<AuthorizedRequestView, "patient" | "documentType" | "note" | "freeText">;
export interface AssistOptions { cacheKey?: string; model?: string; timeoutMs?: number }

const DIR = new URL("../../../../scenario/sender-archive/", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, DIR), "utf8");

/** "own": belongs to the request patient (Patient line is rewritten); "namesake": same name, other birth date; "other": left as is. */
const ARCHIVE: { id: string; title: string; date: string; owner: "own" | "namesake" | "other" }[] = [
  { id: "labor-gerinnung-2026-10-22", title: "Laborbefund Gerinnung", date: "2026-10-22", owner: "own" },
  { id: "labor-gerinnung-2024-03-05", title: "Laborbefund Gerinnung", date: "2024-03-05", owner: "own" },
  { id: "labor-blutbild-2026-09-14", title: "Laborbefund Blutbild", date: "2026-09-14", owner: "own" },
  { id: "rehab-entlassungsbericht", title: "Reha-Entlassungsbericht", date: "2026-09-23", owner: "own" },
  { id: "rechnung-2026-10", title: "Rechnung Oktober 2026", date: "2026-10-31", owner: "own" },
  { id: "labor-andere-patientin", title: "Laborbefund Gerinnung", date: "2026-10-20", owner: "other" },
  { id: "labor-namensgleich", title: "Laborbefund Gerinnung", date: "2026-10-21", owner: "namesake" },
];
const NAMESAKE_BIRTH_DATE = "1990-01-01";

type MockEntry = { importance: Importance; reason: string; evidence: string };
const MOCK = JSON.parse(read("ranking.mock.json")) as Record<DocumentType, Record<string, MockEntry>>;

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim();

/** The whole demo archive as the sender would have it, with the request patient's name filled in. */
function loadArchive(v: AssistView): ArchiveDocument[] {
  return ARCHIVE.map(({ id, title, date, owner }) => {
    const raw = read(`${id}.md`);
    const content =
      owner === "own" ? withPatient(raw, v.patient) : owner === "namesake" ? withPatient(raw, { name: v.patient.name, birthDate: NAMESAKE_BIRTH_DATE }) : raw;
    return { id, title, date, content };
  });
}

/** Given name(s), family name and birth date on the "Patient:" line must all match. No AI involved. */
export function belongsToPatient(content: string, v: Pick<AssistView, "patient">): boolean {
  const m = /^Patient:\s*(.+?),\s*born\s+(.+?)\s*$/m.exec(content);
  if (!m) return false;
  const words = fold(m[1]!).split(" ");
  const family = fold(v.patient.name.family);
  const given = fold(v.patient.name.given[0] ?? "");
  return words.includes(given) && fold(m[1]!).endsWith(family) && fold(m[2]!) === fold(englishDate(v.patient.birthDate));
}

/** Only the request patient's documents; the others never leave this module. */
export function patientArchive(v: AssistView): { docs: ArchiveDocument[]; hidden: number } {
  const all = loadArchive(v);
  const docs = all.filter((d) => belongsToPatient(d.content, v));
  return { docs, hidden: all.length - docs.length };
}

export function archiveDocument(v: AssistView, id: string): ArchiveDocument | undefined {
  return patientArchive(v).docs.find((d) => d.id === id);
}

function evidenceIn(content: string, text: unknown): AssistItem["evidence"] {
  if (typeof text !== "string" || !text.trim()) return undefined;
  const needle = text.trim();
  const i = content.split(/\r?\n/).findIndex((l) => l.includes(needle));
  return i < 0 ? undefined : { line: i + 1, text: needle };
}

const SYSTEM = `Du hilfst einer Ärztin oder einem Arzt, für eine Anfrage das passende Dokument aus der eigenen Ablage zu finden.
Bewerte jedes Dokument nach seiner Wichtigkeit für genau diese Anfrage: "hoch", "mittel", "niedrig" oder "nicht relevant".
Gib für jedes Dokument einen kurzen Grund auf Deutsch (ein Satz) und als "evidence" eine kurze Textstelle, die wörtlich im Dokument vorkommt (aus einer einzigen Zeile kopiert).
Erfinde nichts. Verwende die Dokument-IDs unverändert.`;

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, importance: { type: "string", enum: [...IMPORTANCE] }, reason: { type: "string" }, evidence: { type: "string" } },
        required: ["id", "importance", "reason", "evidence"],
      },
    },
  },
  required: ["items"],
} as const;

type Ranked = { id: string; importance: Importance; reason: string; evidence?: string };

async function askLlm(llm: LlmClient, v: AssistView, docs: ArchiveDocument[], timeoutMs: number): Promise<Ranked[]> {
  const user = [
    ...(v.freeText
      ? [`Anfrage der anfragenden Ärztin / des anfragenden Arztes (Freitext, kein Dokumenttyp vorgegeben): ${v.note?.trim() || "(keine)"}`]
      : [`Angefragtes Dokument: ${DOCUMENT_TYPE_LABELS_DE[v.documentType]}`, `Nachricht der anfragenden Ärztin / des anfragenden Arztes: ${v.note?.trim() || "(keine)"}`]),
    "",
    ...docs.map((d) => `<document id="${d.id}">\n${d.content}\n</document>`),
  ].join("\n");
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`assist LLM timeout after ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    const out = (await Promise.race([llm.completeJson({ system: SYSTEM, user, jsonSchema: SCHEMA as unknown as Record<string, unknown>, schemaName: "archive_ranking" }), timeout])) as { items?: unknown };
    if (!Array.isArray(out?.items)) throw new Error("assist LLM: no items");
    const known = new Set(docs.map((d) => d.id));
    const ranked = new Map<string, Ranked>();
    for (const raw of out.items as Record<string, unknown>[]) {
      const id = raw?.id;
      if (typeof id !== "string" || !known.has(id) || ranked.has(id)) continue;
      if (!IMPORTANCE.includes(raw.importance as Importance) || typeof raw.reason !== "string" || !raw.reason.trim()) throw new Error(`assist LLM: invalid item ${id}`);
      ranked.set(id, { id, importance: raw.importance as Importance, reason: raw.reason.trim(), ...(typeof raw.evidence === "string" ? { evidence: raw.evidence } : {}) });
    }
    if (ranked.size === 0) throw new Error("assist LLM: no known documents");
    for (const d of docs) if (!ranked.has(d.id)) ranked.set(d.id, { id: d.id, importance: "nicht relevant", reason: "Vom Modell nicht bewertet." });
    return [...ranked.values()];
  } finally {
    clearTimeout(timer);
  }
}

function mockRanking(v: AssistView, docs: ArchiveDocument[]): Ranked[] {
  const table = MOCK[v.documentType] ?? MOCK["lab-result"];
  return docs.map((d) => ({ id: d.id, ...(table[d.id] ?? { importance: "nicht relevant" as const, reason: "Kein Bezug zur Anfrage.", evidence: "" }) }));
}

const cache = new Map<string, AssistResult>();

/** The LLM counts as configured only if it is a real provider client (not the eval mock). */
export function assistLlm(provider: string, llm?: LlmClient): LlmClient | undefined {
  return ["anthropic", "perplexity", "openai-compatible"].includes(provider) && llm?.enabled && !(llm instanceof MockLlmClient) ? llm : undefined;
}

export function assistModelName(c: Pick<Config, "llmProvider" | "llmModel">): string {
  return c.llmModel || (c.llmProvider === "anthropic" ? DEFAULT_ANTHROPIC_MODEL : c.llmProvider === "perplexity" ? "sonar-pro" : c.llmProvider);
}

export async function rankArchive(v: AssistView, llm?: LlmClient, opts: AssistOptions = {}): Promise<AssistResult> {
  const hit = opts.cacheKey ? cache.get(opts.cacheKey) : undefined;
  if (hit) return hit;
  const { docs, hidden } = patientArchive(v);
  let source: AssistResult["source"] = "mock";
  let ranked: Ranked[];
  if (llm && !(llm instanceof MockLlmClient)) {
    try {
      ranked = await askLlm(llm, v, docs, opts.timeoutMs ?? 20_000);
      source = "llm";
    } catch {
      ranked = mockRanking(v, docs);
    }
  } else {
    ranked = mockRanking(v, docs);
  }
  const byId = new Map(docs.map((d) => [d.id, d]));
  const items: AssistItem[] = ranked.map((r) => {
    const d = byId.get(r.id)!;
    const evidence = evidenceIn(d.content, r.evidence);
    return { id: d.id, title: d.title, ...(d.date ? { date: d.date } : {}), importance: r.importance, reason: r.reason, ...(evidence ? { evidence } : {}), verified: !!evidence };
  });
  items.sort((a, b) => IMPORTANCE.indexOf(a.importance) - IMPORTANCE.indexOf(b.importance) || (b.date ?? "").localeCompare(a.date ?? ""));
  const result: AssistResult = { source, ...(source === "llm" && opts.model ? { model: opts.model } : {}), items, hiddenOtherPatients: hidden };
  if (opts.cacheKey) cache.set(opts.cacheKey, result);
  return result;
}

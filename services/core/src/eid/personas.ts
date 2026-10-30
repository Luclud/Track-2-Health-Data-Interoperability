import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface Persona {
  key: string;
  given: string[];
  family: string;
  prefix?: string[];
  birthDate: string;
  bpk: string;
  label: string;
}

const PERSONAS_FILE = fileURLToPath(new URL("../../../../infra/mock-eid-personas.json", import.meta.url));

let cached: Persona[] | undefined;

export function loadPersonas(file = PERSONAS_FILE): Persona[] {
  if (file === PERSONAS_FILE && cached) return cached;
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { personas: Persona[] };
  if (file === PERSONAS_FILE) cached = parsed.personas;
  return parsed.personas;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

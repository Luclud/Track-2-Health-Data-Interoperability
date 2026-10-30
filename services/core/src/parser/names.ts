// Person name helpers shared by the parser and the identity policy (DESIGN.md §1).
import type { PersonName } from "@brieftaube/shared";

const TITLES = new Set(["dr", "prof", "mag", "dipl", "ing", "med", "univ", "msc", "phd", "md", "dr.in", "dr.med", "ddr", "priv", "doz", "prim", "primar", "ao", "a.o", "hr", "ddr"]);

/** Lowercase, strip diacritics, ß → ss. */
export function foldText(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").replace(/ß/g, "ss").toLowerCase();
}

function isTitle(token: string): boolean {
  const t = foldText(token).replace(/\.+$/, "");
  if (TITLES.has(t)) return true;
  // compound titles such as "Dr.med." or "Univ.-Prof."
  const parts = t.split(/[.\-]+/).filter(Boolean);
  return parts.length > 1 && parts.every((p) => TITLES.has(p));
}

/** "Dr. Eva Brandl" → { prefix: ["Dr."], given: ["Eva"], family: "Brandl" }. Last token = family. */
export function parsePersonName(input: string): PersonName {
  const tokens = input.replace(/,/g, " ").trim().split(/\s+/).filter(Boolean);
  const prefix: string[] = [];
  while (tokens.length > 1 && isTitle(tokens[0]!)) prefix.push(tokens.shift()!);
  // trailing post-nominal titles such as "MSc", "PhD"
  while (tokens.length > 2 && isTitle(tokens[tokens.length - 1]!)) tokens.pop();
  const family = tokens.pop() ?? "";
  const name: PersonName = { given: tokens, family };
  if (prefix.length) name.prefix = prefix;
  return name;
}

/** Key used for name comparison: folded, titles dropped, hyphens/whitespace collapsed. */
export function normalizeNamePart(s: string): string {
  return foldText(s)
    .split(/[\s\-]+/)
    .filter((t) => t && !isTitle(t))
    .join(" ")
    .replace(/\.+$/, "")
    .trim();
}

export function formatPersonName(n: PersonName, withPrefix = true): string {
  return [...(withPrefix ? n.prefix ?? [] : []), ...n.given, n.family].filter(Boolean).join(" ");
}

/** Family names equal and first given name equal (middle names may be missing on one side). */
export function samePerson(a: PersonName, b: PersonName): boolean {
  const fa = normalizeNamePart(a.family);
  const fb = normalizeNamePart(b.family);
  const ga = a.given.flatMap((g) => normalizeNamePart(g).split(" ")).filter(Boolean);
  const gb = b.given.flatMap((g) => normalizeNamePart(g).split(" ")).filter(Boolean);
  if (!fa || fa !== fb || !ga[0] || !gb[0]) return false;
  return ga[0] === gb[0];
}

// CORE-10 pre-send recipient check (DESIGN.md M1): warnings only — the doctor may still send.
import type { RecipientCheckBody, RecipientWarning } from "@brieftaube/shared";
import { foldText, parsePersonName } from "../parser/names.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9][0-9 ()/-]{5,}$/;
/** Non-ASCII letters that look like Latin ones (Cyrillic, Greek) */
const SCRIPT = /[\u0370-\u03FF\u0400-\u04FF]/u;

export const normalizeAddress = (channel: RecipientCheckBody["channel"], a: string) =>
  channel === "email" ? a.trim().toLowerCase() : a.replace(/[^0-9+]/g, "");

export function checkRecipientAddress(body: RecipientCheckBody, known: string[]): RecipientWarning[] {
  const address = body.address.trim();
  const out: RecipientWarning[] = [];
  if (body.channel === "email" ? !EMAIL.test(address) : !PHONE.test(address)) {
    out.push({ code: "invalid-format", message: body.channel === "email" ? "Das sieht nicht wie eine gültige E-Mail-Adresse aus." : "Das sieht nicht wie eine gültige Mobilnummer aus." });
    return out;
  }
  if (body.channel === "email") {
    const upper = [...new Set(address.match(/[A-Z]/g) ?? [])];
    if (upper.length) {
      out.push({
        code: "uppercase-in-address",
        message: `Die Adresse enthält Großbuchstaben (${upper.map((c) => `„${c}“`).join(", ")}). E-Mail-Adressen werden fast immer klein geschrieben – bitte auf Tippfehler prüfen.`,
      });
    }
    const odd = [...new Set([...address].filter((c) => c.charCodeAt(0) > 127))];
    const iL = /[a-z]I|I[a-z]/.test(address) || /[A-Z]l|l[A-Z]/.test(address);
    if (odd.length || iL) {
      const parts: string[] = [];
      if (iL) parts.push("„I“ (großes i) und „l“ (kleines L) sehen gleich aus");
      if (odd.length) parts.push(`ungewöhnliche Zeichen ${odd.map((c) => `„${c}“`).join(", ")}${odd.some((c) => SCRIPT.test(c)) ? " aus einem anderen Schriftsystem" : ""}`);
      out.push({ code: "confusable-characters", message: `Die Adresse enthält leicht verwechselbare Zeichen: ${parts.join("; ")}.` });
    }
    const name = parsePersonName(body.displayName);
    const local = foldText(address.split("@")[0]!).replace(/[^a-z0-9]/g, "");
    const family = foldText(name.family).replace(/[^a-z0-9]/g, "");
    if (family && !local.includes(family)) {
      out.push({ code: "name-not-in-address", message: `Der Name „${name.family}“ kommt in der Adresse nicht vor.` });
    }
  }
  const norm = normalizeAddress(body.channel, address);
  if (!known.some((k) => normalizeAddress(body.channel, k) === norm)) {
    out.push({ code: "unknown-contact", message: "An diese Adresse wurde noch keine Anfrage geschickt und sie ist nicht im Verzeichnis. Bitte prüfen." });
  }
  return out;
}

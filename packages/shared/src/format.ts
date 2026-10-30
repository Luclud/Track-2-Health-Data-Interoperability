// Display helpers shared by core (chat messages) and doctor UI. Pure functions, no I/O.
// FHIR data is never changed by these; they only format values for people.

function decimals(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) return 0;
  const s = String(n);
  const exp = /e-(\d+)$/.exec(s);
  if (exp) return Number(exp[1]) + (s.split("e")[0]!.split(".")[1]?.length ?? 0);
  return s.split(".")[1]?.length ?? 0;
}

/** German decimal comma; as many decimals as the most precise of value, low and high (INR 1 with 0.8–1.2 → "1,0"). */
export function formatValueDe(value: number, refLow?: number, refHigh?: number): string {
  const d = Math.min(Math.max(decimals(value), decimals(refLow), decimals(refHigh)), 20);
  return value.toFixed(d).replace(".", ",");
}

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻",
};

/** Human-readable unit for a UCUM code: 10*9/L → 10⁹/L, {INR} → "", otherwise unchanged. */
export function unitDisplay(ucum: string): string {
  const u = ucum.trim();
  if (/^\{[^}]*\}$/.test(u)) return "";
  return u.replace(/10[*^](-?\d+)/g, (_m, p: string) => `10${[...p].map((c) => SUPERSCRIPT[c] ?? c).join("")}`);
}

export const LAB_NAMES_DE: Readonly<Record<string, string>> = {
  "6301-6": "INR",
  "14979-9": "aPTT",
  "777-3": "Thrombozyten",
  "3255-7": "Fibrinogen",
  "718-7": "Hämoglobin",
  "2160-0": "Kreatinin",
  "1988-5": "CRP",
  "2823-3": "Kalium",
  "2951-2": "Natrium",
  "6690-2": "Leukozyten",
};

/** German test name for a known LOINC code, else the fallback (usually the name as written in the document). */
export function labNameDe(loinc: string | undefined, fallback: string): string {
  return (loinc && LAB_NAMES_DE[loinc]) || fallback;
}

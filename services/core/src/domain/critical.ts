// V2-CRIT-1: critical (panic) values from infra/critical-values.json, keyed by LOINC.
import { existsSync, readFileSync } from "node:fs";
import type { ParsedLabValue } from "@brieftaube/shared";
import { quantity } from "../fhir/util.ts";

export interface CriticalLimit {
  low?: number;
  high?: number;
  /** UCUM code the limits are written in */
  unit: string;
}
export type CriticalLimits = Record<string, CriticalLimit>;
export interface CriticalHit {
  rule: string;
}

/** value in `from` × factor = value in `to` (only safe, well-known conversions). */
const CONVERSIONS: Record<string, number> = {
  "g/L>g/dL": 0.1,
  "g/dL>g/L": 10,
  "umol/L>mg/dL": 1 / 88.4,
  "mg/dL>umol/L": 88.4,
};

export function loadCriticalLimits(file: string, log: (m: string) => void = console.warn): CriticalLimits {
  if (!existsSync(file)) {
    log(`critical values: ${file} not found, no critical-value alerts`);
    return {};
  }
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const out: CriticalLimits = {};
    for (const [loinc, v] of Object.entries(raw)) {
      if (loinc === "note" || typeof v !== "object" || v === null) continue;
      const e = v as Partial<CriticalLimit>;
      if (typeof e.unit !== "string" || (typeof e.low !== "number" && typeof e.high !== "number")) continue;
      out[loinc] = { unit: e.unit, ...(typeof e.low === "number" ? { low: e.low } : {}), ...(typeof e.high === "number" ? { high: e.high } : {}) };
    }
    return out;
  } catch (err) {
    log(`critical values: ${file} unreadable (${(err as Error).message}), no critical-value alerts`);
    return {};
  }
}

const fmt = (n: number) => String(n).replace(".", ",");

/** Compare a value (in UCUM `unit`) with the limits. Unknown or non-convertible unit → not critical. */
export function criticalFor(limits: CriticalLimits, loinc: string | undefined, value: number, unit: string | undefined): CriticalHit | undefined {
  const limit = loinc ? limits[loinc] : undefined;
  if (!limit || unit === undefined || !Number.isFinite(value)) return undefined;
  const factor = unit === limit.unit ? 1 : CONVERSIONS[`${unit}>${limit.unit}`];
  if (factor === undefined) return undefined;
  const v = value * factor;
  const suffix = unit === limit.unit ? "" : ` ${limit.unit}`;
  if (limit.low !== undefined && v < limit.low) return { rule: `< ${fmt(limit.low)}${suffix}` };
  if (limit.high !== undefined && v > limit.high) return { rule: `> ${fmt(limit.high)}${suffix}` };
  return undefined;
}

/** Same as criticalFor, for a value as parsed from the document (unit as written → UCUM). */
export function criticalForParsed(limits: CriticalLimits, v: ParsedLabValue): CriticalHit | undefined {
  const q = quantity(v.value, v.unitText, v.loinc);
  return q.code ? criticalFor(limits, v.loinc, v.value, q.code) : undefined;
}

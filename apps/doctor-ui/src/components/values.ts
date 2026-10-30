import { formatValueDe } from "@brieftaube/shared";

/** Reference range in German notation, with the same precision as the value ("0,8–1,2", "2,0–4,0", "< 5,0"). */
export function formatRange(low?: number, high?: number, value?: number): string {
  const f = (n: number, other?: number) => formatValueDe(n, value ?? other, value === undefined ? undefined : other);
  if (low !== undefined && high !== undefined) return `${f(low, high)}–${f(high, low)}`;
  if (high !== undefined) return `< ${f(high)}`;
  if (low !== undefined) return `> ${f(low)}`;
  return "";
}

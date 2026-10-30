import type { PersonName } from "@brieftaube/shared";

export function formatName(n: PersonName): string {
  return [...(n.prefix ?? []), ...n.given, n.family].join(" ");
}

/** YYYY-MM-DD -> DD.MM.YYYY */
export function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/** ISO date-time -> "22.10.2026, 08:10" in local time */
export function formatDateTime(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
}

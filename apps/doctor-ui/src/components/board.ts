import { REQUEST_TTL_HOURS, type DocumentRequestView, type RequestStatus } from "@brieftaube/shared";

export type BoardGroup = "problem" | "review" | "waiting" | "filed";

export const BOARD_GROUPS: readonly { id: BoardGroup; label: string; statuses: readonly RequestStatus[] }[] = [
  { id: "problem", label: "Problem", statuses: ["rejected", "expired", "cancelled"] },
  { id: "review", label: "Zur Prüfung", statuses: ["held"] },
  { id: "waiting", label: "Wartet auf Antwort", statuses: ["sent", "opened", "verified", "identity-failed"] },
  { id: "filed", label: "Abgelegt", statuses: ["filed"] },
];

export function groupRequests(requests: readonly DocumentRequestView[]): { id: BoardGroup; label: string; items: DocumentRequestView[] }[] {
  return BOARD_GROUPS.map((g) => ({ id: g.id, label: g.label, items: requests.filter((r) => g.statuses.includes(r.status)) }));
}

/** "läuft ab in 5 h" from `expiresAt`; falls back to createdAt + REQUEST_TTL_HOURS for an older core. */
export function expiryText(r: Pick<DocumentRequestView, "createdAt" | "expiresAt">, now = Date.now()): string {
  const end = r.expiresAt ? Date.parse(r.expiresAt) : Date.parse(r.createdAt) + REQUEST_TTL_HOURS * 3_600_000;
  if (Number.isNaN(end)) return "";
  const left = end - now;
  if (left <= 0) return "Frist abgelaufen";
  const min = Math.floor(left / 60_000);
  if (min < 60) return `läuft ab in ${Math.max(min, 1)} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `läuft ab in ${h} h`;
  return `läuft ab in ${Math.floor(h / 24)} Tagen`;
}

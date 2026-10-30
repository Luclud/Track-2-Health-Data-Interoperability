import type { AuditStep, Channel, DocumentType, MisdeliveryKind, RequestStatus } from "@brieftaube/shared";

export const DOC_TYPE_DE: Record<DocumentType, string> = {
  "lab-result": "Laborbefund",
  "rehab-discharge-report": "Reha-Entlassungsbericht",
};

/** What the doctor asked for: free text until a document arrived, then the type that was actually sent. */
export function requestLabel(r: { documentType: DocumentType; freeText?: boolean; note?: string; status: RequestStatus }): string {
  if (r.freeText && r.status !== "filed" && r.status !== "held") return `„${r.note ?? ""}“`;
  return DOC_TYPE_DE[r.documentType];
}

export const CHANNEL_DE: Record<Channel, string> = { email: "E-Mail", sms: "SMS" };

export type Tone = "neutral" | "info" | "success" | "warning" | "alert";

export const STATUS_DE: Record<RequestStatus, { label: string; tone: Tone }> = {
  sent: { label: "Gesendet", tone: "info" },
  opened: { label: "Link geöffnet", tone: "info" },
  "identity-failed": { label: "Falsche Person", tone: "warning" },
  verified: { label: "Identität bestätigt", tone: "info" },
  filed: { label: "Abgelegt", tone: "success" },
  held: { label: "Wartet auf Freigabe", tone: "warning" },
  rejected: { label: "Abgelehnt", tone: "alert" },
  expired: { label: "Abgelaufen", tone: "neutral" },
  cancelled: { label: "Storniert", tone: "neutral" },
};

export const STEP_DE: Record<AuditStep, { label: string; icon: string }> = {
  "request-sent": { label: "Anfrage gesendet", icon: "📨" },
  "link-opened": { label: "Link geöffnet", icon: "🔗" },
  "identity-checked": { label: "Identität geprüft", icon: "🪪" },
  "answer-sent": { label: "Antwort eingegangen", icon: "📄" },
  "answer-filed": { label: "Im Patientenakt abgelegt", icon: "✅" },
  "misdelivery-caught": { label: "Fehlzustellung erkannt", icon: "🛑" },
  "reminder-sent": { label: "Erinnerung gesendet", icon: "🔔" },
};

export const PROBLEM_DE: Record<MisdeliveryKind, string> = {
  "identity-mismatch": "Jemand anderer als die Empfängerin / der Empfänger hat versucht, die Anfrage zu öffnen.",
  "wrong-patient": "Die Antwort betrifft eine andere Person – nicht abgelegt.",
  "wrong-document-type": "Falsche Dokumentart gesendet – nicht abgelegt.",
  "suspicious-address": "Die Adresse sieht verdächtig aus.",
};

export const HELD_DE: Record<"not-in-register" | "ai-extracted" | "unreadable", string> = {
  "not-in-register": "Absender:in nicht in der Ärzteliste gefunden",
  "ai-extracted": "KI-gelesen – bitte Werte prüfen",
  unreadable: "Dokument nicht sicher lesbar",
};

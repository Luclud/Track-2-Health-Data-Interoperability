// German texts: notifications (DESIGN.md §4) and Matrix messages (§6).
import type { DocumentRequest, Requester } from "@brieftaube/shared";
import { DOCUMENT_TYPE_LABELS_DE } from "@brieftaube/shared";
import { DateTime } from "luxon";
import type { OutboundMessage } from "../ports.ts";

export function viennaDisplay(iso: string): string {
  return DateTime.fromISO(iso, { setZone: true }).setZone("Europe/Vienna").toFormat("dd.MM.yyyy, HH:mm");
}

export function linkFor(publicBaseUrl: string, token: string): string {
  return `${publicBaseUrl.replace(/\/+$/, "")}/r/${token}`;
}

export function notificationFor(r: DocumentRequest, link: string): OutboundMessage {
  const org = r.requester.organization;
  if (r.recipient.channel === "sms") {
    return {
      channel: "sms",
      to: r.recipient.address,
      text: `${org}: sichere Anfrage von ${r.requester.displayName} für ${r.recipient.displayName}. Ref. ${r.reference}: ${link}`,
    };
  }
  const name = r.recipient.displayName;
  return {
    channel: "email",
    to: r.recipient.address,
    subject: `Sichere Anfrage von ${org} (Ref. ${r.reference})`,
    text: [
      `Guten Tag ${name},`,
      "",
      `${r.requester.displayName} (${org}) hat Ihnen eine sichere Anfrage gesendet.`,
      "",
      "Bitte öffnen Sie diesen Link und bestätigen Sie Ihre Identität:",
      link,
      "",
      `Referenz: ${r.reference} · gültig bis ${viennaDisplay(r.expiresAt)}`,
      "Sie benötigen kein Konto und müssen nichts installieren.",
      "",
      `Sind Sie nicht ${name}? Dann leiten Sie diese Nachricht bitte nicht weiter und löschen Sie sie.`,
      "",
    ].join("\n"),
  };
}

const CHANNEL_DE = { email: "E-Mail", sms: "SMS" } as const;

export function chatRequestSent(r: DocumentRequest): string {
  const p = r.patient.name;
  return `📨 Anfrage ${r.reference} an ${r.recipient.displayName} (${CHANNEL_DE[r.recipient.channel]}) gesendet – ${DOCUMENT_TYPE_LABELS_DE[r.documentType]} für ${[...p.given, p.family].join(" ")}.`;
}

export function requesterActor(q: Requester) {
  return { kind: "internal-practitioner" as const, id: q.matrixUserId, display: q.displayName };
}

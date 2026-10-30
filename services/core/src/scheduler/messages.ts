// German texts for the scheduler (V2-REM-1). Same privacy rules as the first notification (DESIGN.md §4).
import type { DocumentRequest } from "@brieftaube/shared";
import { viennaDisplay } from "../domain/messages.ts";
import type { OutboundMessage } from "../ports.ts";

export function reminderFor(r: DocumentRequest, link: string): OutboundMessage {
  const org = r.requester.organization;
  const until = viennaDisplay(r.expiresAt);
  if (r.recipient.channel === "sms") {
    return {
      channel: "sms",
      to: r.recipient.address,
      text: `Erinnerung: ${org}: sichere Anfrage von ${r.requester.displayName} für ${r.recipient.displayName}. Ref. ${r.reference}, gültig bis ${until}. Neuer Link (der alte gilt nicht mehr): ${link}`,
    };
  }
  const name = r.recipient.displayName;
  return {
    channel: "email",
    to: r.recipient.address,
    subject: `Erinnerung: sichere Anfrage von ${org} (Ref. ${r.reference})`,
    text: [
      `Guten Tag ${name},`,
      "",
      `${r.requester.displayName} (${org}) wartet noch auf Ihre Antwort auf eine sichere Anfrage.`,
      "",
      "Bitte öffnen Sie diesen neuen Link und bestätigen Sie Ihre Identität:",
      link,
      "",
      `Referenz: ${r.reference} · gültig bis ${until}`,
      "Der Link aus der ersten Nachricht gilt nicht mehr.",
      "",
      `Sind Sie nicht ${name}? Dann leiten Sie diese Nachricht bitte nicht weiter und löschen Sie sie.`,
      "",
    ].join("\n"),
  };
}

export const chatReminderSent = (r: DocumentRequest) => `🔔 Erinnerung an ${r.recipient.displayName} gesendet (${r.reference})`;

export const chatExpired = (r: DocumentRequest) => `⌛ ${r.reference} abgelaufen – keine Antwort von ${r.recipient.displayName}.`;

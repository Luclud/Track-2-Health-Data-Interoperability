// Account B, Dev Outside — task OUT-1.
import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { Config } from "../config.ts";
import type { MessageSender, OutboundMessage } from "../ports.ts";
import { findPrivacyLeaks, PrivacyViolationError } from "./privacy.ts";

export interface StoredMessage { id: string; to: string; subject?: string; body: string; sentAt: string }

/** Portal links contain a random token; random letters must not count as a "medical word". */
const PORTAL_LINK = /https?:\/\/\S*\/r\/[A-Za-z0-9_-]+/g;

/**
 * Belt and braces: the RequestService already ran assertNotificationIsClean() with the patient.
 * The sender does not know the patient, so it re-checks what it can: document-type and medical words
 * (for every document type). Throws PrivacyViolationError; the message is not sent.
 */
export function assertOutboundIsClean(m: OutboundMessage): void {
  const text = [m.subject ?? "", m.text, m.html ?? ""].join("\n").replace(PORTAL_LINK, " ");
  const noPatient = { name: { given: [], family: "" }, birthDate: "0000-00-00" };
  const findings = (["lab-result", "rehab-discharge-report"] as const)
    .flatMap((documentType) => findPrivacyLeaks(text, { patient: noPatient, documentType, recipientAddress: m.to }))
    .filter((f) => f.kind === "document-type");
  const unique = [...new Map(findings.map((f) => [f.match, f])).values()];
  if (unique.length > 0) throw new PrivacyViolationError(unique);
}

/** Keeps messages in memory. Used for the SMS simulator and for MAIL_MODE=memory in tests. */
export class MemorySender implements MessageSender {
  private sent: StoredMessage[] = [];
  async send(m: OutboundMessage): Promise<{ providerMessageId: string }> {
    assertOutboundIsClean(m);
    const id = randomUUID();
    this.sent.unshift({ id, to: m.to, subject: m.subject, body: m.text, sentAt: new Date().toISOString() });
    return { providerMessageId: id };
  }
  async inbox(): Promise<StoredMessage[]> {
    return [...this.sent];
  }
}

/** Sends email via SMTP (nodemailer) to Mailpit (SMTP_HOST/SMTP_PORT). Never a real mail server in this project. */
export class SmtpSender implements MessageSender {
  private readonly transport: Transporter;
  constructor(
    private readonly config: Pick<Config, "smtpHost" | "smtpPort" | "mailFrom">,
    transport?: Transporter,
  ) {
    this.transport =
      transport ??
      nodemailer.createTransport({ host: config.smtpHost, port: config.smtpPort, secure: false, ignoreTLS: true });
  }
  async send(m: OutboundMessage): Promise<{ providerMessageId: string }> {
    if (m.channel !== "email") throw new Error(`SmtpSender only sends email, got ${m.channel}`);
    assertOutboundIsClean(m);
    const info = await this.transport.sendMail({
      from: this.config.mailFrom,
      to: m.to,
      subject: m.subject ?? "Sichere Anfrage",
      text: m.text,
      ...(m.html ? { html: m.html } : {}),
    });
    return { providerMessageId: String(info.messageId ?? randomUUID()) };
  }
}

export function createMessageSenders(config: Config) {
  const sms = new MemorySender();
  const email: MessageSender = config.mailMode === "smtp" ? new SmtpSender(config) : new MemorySender();
  return { email, sms };
}

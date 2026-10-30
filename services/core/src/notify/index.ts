// Account B, Dev Outside — task OUT-1.
import { randomUUID } from "node:crypto";
import type { Config } from "../config.ts";
import type { MessageSender, OutboundMessage } from "../ports.ts";
import { NotImplementedError } from "../not-implemented.ts";

export interface StoredMessage { id: string; to: string; subject?: string; body: string; sentAt: string }

/** Keeps messages in memory. Used for the SMS simulator and for MAIL_MODE=memory in tests. Done. */
export class MemorySender implements MessageSender {
  private sent: StoredMessage[] = [];
  async send(m: OutboundMessage): Promise<{ providerMessageId: string }> {
    const id = randomUUID();
    this.sent.unshift({ id, to: m.to, subject: m.subject, body: m.text, sentAt: new Date().toISOString() });
    return { providerMessageId: id };
  }
  async inbox(): Promise<StoredMessage[]> {
    return [...this.sent];
  }
}

/** TODO OUT-1: send via SMTP (nodemailer) to Mailpit (SMTP_HOST/SMTP_PORT). */
export class SmtpSender implements MessageSender {
  constructor(private readonly config: Config) {}
  async send(_m: OutboundMessage): Promise<{ providerMessageId: string }> {
    throw new NotImplementedError("SmtpSender.send", "OUT-1");
  }
}

export function createMessageSenders(config: Config) {
  const sms = new MemorySender();
  const email: MessageSender = config.mailMode === "smtp" ? new SmtpSender(config) : new MemorySender();
  return { email, sms };
}

// Lane OUTSIDE, Dev Outside — task V2-REM-1. Periodic jobs: reminders (with link rotation) and active expiry.
import type { DocumentRequest, RequestStatus } from "@brieftaube/shared";
import type { Deps } from "../container.ts";
import { linkFor } from "../domain/messages.ts";
import { newToken, sha256 } from "../domain/tokens.ts";
import { assertNotificationIsClean, findPrivacyLeaks } from "../notify/privacy.ts";
import type { MessageSender, OutboundMessage } from "../ports.ts";
import { chatExpired, chatReminderSent, reminderFor } from "./messages.ts";

/** Deps satisfies this; tests pass plain fakes. */
export type SchedulerDeps = Pick<Deps, "config" | "repo" | "audit" | "chat"> & { email: MessageSender; sms: MessageSender; log?: (msg: string) => void };

const REMINDABLE: ReadonlySet<RequestStatus> = new Set(["sent", "opened", "identity-failed"]);
/** Same rule as the domain's lazy expiry: a held answer waits for the doctor and never expires. */
const EXPIRABLE: ReadonlySet<RequestStatus> = new Set(["sent", "opened", "identity-failed", "verified", "rejected"]);
const SYSTEM = { kind: "system" as const, id: "brieftaube", display: "Brieftaube" };

export interface TickResult {
  reminded: string[];
  expired: string[];
}

/** One scheduler pass. Errors on one request are logged and do not stop the others. */
export async function runSchedulerOnce(deps: SchedulerDeps, now: Date = new Date()): Promise<TickResult> {
  const log = deps.log ?? console.warn;
  const out: TickResult = { reminded: [], expired: [] };
  const t = now.getTime();
  const remindBeforeMs = deps.config.reminderBeforeExpiryMinutes * 60_000;
  for (const r of await deps.repo.listOpen()) {
    try {
      const expiresAt = Date.parse(r.expiresAt);
      if (EXPIRABLE.has(r.status) && expiresAt <= t) {
        await expire(deps, r);
        out.expired.push(r.reference);
      } else if (REMINDABLE.has(r.status) && !r.reminderSentAt && remindBeforeMs > 0 && t >= expiresAt - remindBeforeMs) {
        await remind(deps, r, now);
        out.reminded.push(r.reference);
      }
    } catch (err) {
      log(`scheduler: ${r.reference}: ${(err as Error).message}`);
    }
  }
  return out;
}

async function expire(deps: SchedulerDeps, r: DocumentRequest): Promise<void> {
  r.status = "expired";
  await deps.repo.update(r);
  await post(deps, { roomId: r.roomId, body: chatExpired(r), severity: "warning" });
}

/** New token first, then send: the mail never carries a link that does not work yet. */
async function remind(deps: SchedulerDeps, r: DocumentRequest, now: Date): Promise<void> {
  const ctx = { patient: r.patient, documentType: r.documentType, recipientAddress: r.recipient.address };
  // A random token can, very rarely, contain a "forbidden" word or the birth year; draw a new one then.
  let token = "";
  let message: OutboundMessage | undefined;
  for (let i = 0; i < 8; i++) {
    token = newToken();
    message = reminderFor(r, linkFor(deps.config.publicBaseUrl, token));
    if (![message.subject ?? "", message.text].some((s) => findPrivacyLeaks(s, ctx).length)) break;
  }
  for (const s of [message!.subject ?? "", message!.text]) assertNotificationIsClean(s, ctx);

  await deps.repo.rotateTokenHash(r.id, sha256(token));
  const sender = r.recipient.channel === "email" ? deps.email : deps.sms;
  const sent = await sender.send(message!);

  r.reminderSentAt = now.toISOString();
  await deps.repo.update(r);
  await deps.audit.record({
    requestId: r.id,
    requestReference: r.reference,
    step: "reminder-sent",
    at: now.toISOString(),
    actor: SYSTEM,
    what: `Reminder for ${r.reference} sent by ${r.recipient.channel} to ${r.recipient.address} with a new link; the previous link no longer works`,
    outcome: "success",
    details: { channel: r.recipient.channel, providerMessageId: sent.providerMessageId },
  });
  await post(deps, { roomId: r.roomId, body: chatReminderSent(r), severity: "info" });
}

/** A Matrix outage must never break the scheduler. */
async function post(deps: SchedulerDeps, msg: Parameters<Deps["chat"]["post"]>[0]): Promise<void> {
  try {
    await deps.chat.post(msg);
  } catch (err) {
    (deps.log ?? console.warn)(`scheduler: posting to ${msg.roomId} failed: ${(err as Error).message}`);
  }
}

/** Starts the periodic jobs (every SCHEDULER_INTERVAL_SECONDS; 0 = off). Returns a function that stops them. */
export function startScheduler(deps: SchedulerDeps, now: () => Date = () => new Date()): () => void {
  const seconds = deps.config.schedulerIntervalSeconds;
  if (!Number.isFinite(seconds) || seconds <= 0) return () => {};
  let running = false;
  const timer = setInterval(() => {
    if (running) return; // a slow SMTP/Matrix call must not overlap the next tick
    running = true;
    runSchedulerOnce(deps, now())
      .catch((err) => (deps.log ?? console.warn)(`scheduler: ${(err as Error).message}`))
      .finally(() => (running = false));
  }, seconds * 1000);
  timer.unref();
  return () => clearInterval(timer);
}

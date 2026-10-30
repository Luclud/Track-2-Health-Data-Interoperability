import { describe, expect, it, vi } from "vitest";
import type { ChatMessageView } from "@brieftaube/shared";
import { labBody, lena, rehabBody, testDeps } from "../domain/testkit.ts";
import type { MemorySender } from "../notify/index.ts";
import { findPrivacyLeaks } from "../notify/privacy.ts";
import { runSchedulerOnce, startScheduler } from "./index.ts";

const tokenFrom = (text: string) => /\/r\/([A-Za-z0-9_-]+)/.exec(text)![1]!;
const T0 = new Date("2026-10-30T08:00:00Z"); // TTL 72 h -> expires 2026-11-02T08:00Z
const hours = (h: number) => new Date(T0.getTime() + h * 3600_000);

function setup() {
  let clock = T0;
  const { deps, service } = testDeps({ now: () => clock });
  const cfg = { ...deps.config, reminderBeforeExpiryMinutes: 24 * 60, requestTtlHours: 72 };
  deps.config = cfg;
  const sched = { ...deps, config: cfg };
  const chat = async () => (await deps.chat.list(labBody.roomId)) as ChatMessageView[];
  return { deps, service, sched, chat, setClock: (d: Date) => (clock = d) };
}

describe("scheduler (V2-REM-1)", () => {
  it("sends one reminder with a rotated link: old token invalid, new one works", async () => {
    const { deps, service, sched, chat, setClock } = setup();
    const { request } = await service.createRequest(lena, labBody);
    const email = deps.email as MemorySender;
    const oldToken = tokenFrom((await email.inbox())[0]!.body);

    expect((await runSchedulerOnce(sched, hours(47))).reminded).toEqual([]); // 25 h left: too early

    const tick = await runSchedulerOnce(sched, hours(48));
    expect(tick.reminded).toEqual([request.reference]);
    const inbox = await email.inbox();
    expect(inbox).toHaveLength(2);
    const reminder = inbox[0]!;
    expect(reminder.to).toBe(labBody.recipient.address);
    expect(reminder.subject).toBe(`Erinnerung: sichere Anfrage von Klinikum Beispielstadt (Ref. ${request.reference})`);
    expect(reminder.body).toContain(`Referenz: ${request.reference} · gültig bis 02.11.2026, 09:00`);
    const newToken = tokenFrom(reminder.body);
    expect(newToken).not.toBe(oldToken);

    setClock(hours(49));
    expect(await service.openLink(oldToken, {})).toBeUndefined();
    expect((await service.openLink(newToken, {}))?.view.reference).toBe(request.reference);

    const stored = await deps.repo.byId(request.id);
    expect(stored?.reminderSentAt).toBe(hours(48).toISOString());
    const audit = (await deps.audit.forRequest(request.id)).filter((a) => a.step === "reminder-sent");
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor.kind).toBe("system");
    expect((await chat()).filter((m) => m.body === `🔔 Erinnerung an Dr. Eva Brandl gesendet (${request.reference})`)).toHaveLength(1);

    // only once
    expect((await runSchedulerOnce(sched, hours(50))).reminded).toEqual([]);
    expect(await email.inbox()).toHaveLength(2);
  });

  it("reminders (email and SMS) pass the privacy guard for the request's patient", async () => {
    const { deps, service, sched } = setup();
    const lab = await service.createRequest(lena, labBody);
    const rehab = await service.createRequest(lena, rehabBody);
    await runSchedulerOnce(sched, hours(60));
    const mail = (await (deps.email as MemorySender).inbox())[0]!;
    const sms = (await (deps.sms as MemorySender).inbox())[0]!;
    expect(sms.body).toMatch(/^Erinnerung: /);
    expect(sms.body).toContain(rehab.request.reference);
    for (const [msg, r] of [[mail, lab.request], [sms, rehab.request]] as const) {
      const ctx = { patient: r.patient, documentType: r.documentType, recipientAddress: r.recipient.address };
      for (const text of [msg.subject ?? "", msg.body]) expect(findPrivacyLeaks(text.replace(/\/r\/[A-Za-z0-9_-]+/, "/r/x"), ctx)).toEqual([]);
    }
  });

  it("only sent | opened | identity-failed get a reminder", async () => {
    const { deps, service, sched } = setup();
    const { request } = await service.createRequest(lena, labBody);
    await deps.repo.update({ ...request, status: "verified" });
    expect((await runSchedulerOnce(sched, hours(60))).reminded).toEqual([]);
    await deps.repo.update({ ...request, status: "identity-failed" });
    expect((await runSchedulerOnce(sched, hours(60))).reminded).toEqual([request.reference]);
  });

  it("expires due requests actively and posts one expiry message", async () => {
    const { deps, service, sched, chat } = setup();
    const { request } = await service.createRequest(lena, labBody);
    const held = (await service.createRequest(lena, labBody)).request;
    await deps.repo.update({ ...held, status: "held" });

    const tick = await runSchedulerOnce(sched, hours(72));
    expect(tick.expired).toEqual([request.reference]);
    expect(tick.reminded).toEqual([]); // no reminder for an already expired request
    expect((await deps.repo.byId(request.id))?.status).toBe("expired");
    expect((await deps.repo.byId(held.id))?.status).toBe("held");

    await runSchedulerOnce(sched, hours(73));
    const msgs = (await chat()).filter((m) => m.body.startsWith("⌛"));
    expect(msgs.map((m) => m.body)).toEqual([`⌛ ${request.reference} abgelaufen – keine Antwort von Dr. Eva Brandl.`]);
  });

  it("a failing sender keeps the request remindable and does not stop other requests", async () => {
    const { deps, service, sched } = setup();
    const a = (await service.createRequest(lena, labBody)).request;
    const b = (await service.createRequest(lena, rehabBody)).request;
    const failing = { ...sched, email: { send: async () => { throw new Error("smtp down"); } }, log: () => {} };
    const tick = await runSchedulerOnce(failing, hours(60));
    expect(tick.reminded).toEqual([b.reference]);
    expect((await deps.repo.byId(a.id))?.reminderSentAt).toBeUndefined();
    expect((await runSchedulerOnce(sched, hours(61))).reminded).toEqual([a.reference]);
  });

  it("startScheduler runs on the interval and is off for 0", async () => {
    vi.useFakeTimers();
    try {
      const { service, sched } = setup();
      const { request } = await service.createRequest(lena, labBody);
      expect(startScheduler({ ...sched, config: { ...sched.config, schedulerIntervalSeconds: 0 } })).toBeTypeOf("function");
      const stop = startScheduler({ ...sched, config: { ...sched.config, schedulerIntervalSeconds: 60 } }, () => hours(72));
      await vi.advanceTimersByTimeAsync(60_000);
      stop();
      expect((await sched.repo.byId(request.id))?.status).toBe("expired");
    } finally {
      vi.useRealTimers();
    }
  });
});


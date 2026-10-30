import { describe, expect, it } from "vitest";
import type { Task as FhirTask } from "fhir/r4.js";
import { findPrivacyLeaks } from "../notify/privacy.ts";
import type { MemorySender } from "../notify/index.ts";
import { labBody, lena, rehabBody, testDeps } from "./testkit.ts";


const tokenFrom = (text: string) => /\/r\/([A-Za-z0-9_-]+)/.exec(text)![1]!;

describe("createRequest", () => {
  it("lab request by email: Task, clean email, audit, chat", async () => {
    const now = new Date("2026-10-30T08:05:00Z");
    const { deps, service } = testDeps({ now: () => now });
    const { request, warnings } = await service.createRequest(lena, labBody);
    expect(warnings).toEqual([]);
    expect(request.reference).toMatch(/^BT-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(request.status).toBe("sent");
    expect(request.expiresAt).toBe("2026-11-02T08:05:00.000Z");
    expect(request.recipient.name).toEqual({ given: ["Eva"], family: "Brandl", prefix: ["Dr."] });
    expect(request.patient).toMatchObject({ fhirId: "maria-beispiel", birthDate: "1961-03-12", name: { given: ["Maria"], family: "Beispiel" } });

    const task = await deps.fhir.read<FhirTask>("Task", request.fhirTaskId!);
    expect(task?.status).toBe("requested");
    expect(task?.identifier?.[0]?.value).toBe(request.reference);

    const [mail] = await (deps.email as MemorySender).inbox();
    expect(mail!.to).toBe("eva.brandl@labor-kanal.example");
    expect(mail!.subject).toBe(`Sichere Anfrage von Klinikum Beispielstadt (Ref. ${request.reference})`);
    expect(mail!.body).toContain("Guten Tag Dr. Eva Brandl,");
    expect(mail!.body).toContain(`Referenz: ${request.reference} · gültig bis 02.11.2026, 09:05`);
    const ctx = { patient: request.patient, documentType: request.documentType, recipientAddress: request.recipient.address };
    expect(findPrivacyLeaks(mail!.body, ctx)).toEqual([]);
    expect(mail!.body).not.toContain("Gerinnung");

    // only the token hash is stored
    const token = tokenFrom(mail!.body);
    expect(token).toHaveLength(43);
    expect(JSON.stringify(await deps.repo.byId(request.id))).not.toContain(token);

    const audit = await deps.audit.forRequest(request.id);
    expect(audit.map((a) => a.step)).toEqual(["request-sent"]);
    expect(audit[0]!.actor).toEqual({ kind: "internal-practitioner", id: lena.matrixUserId, display: "Dr. Lena Hofer" });
    const chat = await deps.chat.list(labBody.roomId);
    expect(chat[0]!.body).toBe(`📨 Anfrage ${request.reference} an Dr. Eva Brandl (E-Mail) gesendet – Laborbefund für Maria Beispiel.`);
  });

  it("rehab request by SMS", async () => {
    const { deps, service } = testDeps();
    const { request } = await service.createRequest(lena, rehabBody);
    const [sms] = await (deps.sms as MemorySender).inbox();
    expect(sms!.to).toBe("+43 660 000 0101");
    expect(sms!.body).toMatch(new RegExp(`^Klinikum Beispielstadt: sichere Anfrage von Dr\\. Lena Hofer für Stefan Kern\\. Ref\\. ${request.reference}: http://localhost:3000/r/[A-Za-z0-9_-]{43}$`));
    expect(findPrivacyLeaks(sms!.body, { patient: request.patient, documentType: request.documentType })).toEqual([]);
    expect(await deps.repo.knownAddresses(lena.matrixUserId)).toEqual(["+43 660 000 0101"]);
  });

  it("Matrix outage does not block sending", async () => {
    const logs: string[] = [];
    const chat = { post: async () => { throw new Error("Matrix down"); }, list: async () => [] };
    const { deps, service } = testDeps({ chat, log: (m) => logs.push(m) });
    const { request } = await service.createRequest(lena, labBody);
    expect(request.status).toBe("sent");
    expect(await (deps.email as MemorySender).inbox()).toHaveLength(1);
    expect(logs[0]).toContain("Matrix down");
  });

  it("unknown patient → patient-not-found, nothing sent", async () => {
    const { deps, service } = testDeps();
    await expect(service.createRequest(lena, { ...labBody, patientId: "nobody" })).rejects.toMatchObject({ code: "patient-not-found", status: 404 });
    expect(await (deps.email as MemorySender).inbox()).toEqual([]);
  });
});

describe("openLink / list / detail", () => {
  it("opens, audits, shows only public data", async () => {
    let now = new Date("2026-10-30T08:05:00Z");
    const { deps, service } = testDeps({ now: () => now });
    const { request } = await service.createRequest(lena, labBody);
    const token = tokenFrom((await (deps.email as MemorySender).inbox())[0]!.body);
    expect(await service.openLink("wrong-token", {})).toBeUndefined();

    now = new Date("2026-10-30T08:10:00Z");
    const opened = await service.openLink(token, { ipHash: "abc", userAgent: "UA" });
    expect(opened!.requestId).toBe(request.id);
    expect(opened!.view).toEqual({
      reference: request.reference,
      requesterDisplayName: "Dr. Lena Hofer",
      requesterOrganization: "Klinikum Beispielstadt",
      recipientDisplayName: "Dr. Eva Brandl",
      expiresAt: request.expiresAt,
      status: "open",
    });
    expect(JSON.stringify(opened)).not.toMatch(/Maria|1961|lab-result/);

    const detail = await service.detail(request.id);
    expect(detail!.request.status).toBe("opened");
    expect(detail!.audit.map((a) => a.step)).toEqual(["request-sent", "link-opened"]);
    expect(detail!.audit[1]!.actor.kind).toBe("unverified-visitor");
    expect(detail!.audit[1]!.details).toMatchObject({ ipHash: "abc", userAgent: "UA" });
    expect(await service.detail("nope")).toBeUndefined();

    await service.createRequest(lena, rehabBody);
    const list = await service.listForRoom(labBody.roomId);
    expect(list).toHaveLength(2);

    now = new Date("2026-11-03T00:00:00Z");
    expect((await service.openLink(token, {}))!.view.status).toBe("expired");
    expect((await service.listForRoom(labBody.roomId)).every((r) => r.status === "expired")).toBe(true);
  });
});

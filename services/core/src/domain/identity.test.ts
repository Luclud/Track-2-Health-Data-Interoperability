import { describe, expect, it } from "vitest";
import type { DocumentRequest } from "@brieftaube/shared";
import type { MemorySender } from "../notify/index.ts";
import { FakeRegister, identity, labBody, lena, rehabBody, testDeps } from "./testkit.ts";
import { decideIdentity, matchesRecipient, parseRecipientName, policyFor } from "./identity.ts";

const tokenFrom = (text: string) => /\/r\/([A-Za-z0-9_-]+)/.exec(text)![1]!;

async function sent(body = labBody, overrides = {}) {
  const t = testDeps(overrides);
  const { request } = await t.service.createRequest(lena, body);
  const inbox = await ((body.recipient.channel === "email" ? t.deps.email : t.deps.sms) as MemorySender).inbox();
  return { ...t, request, token: tokenFrom(inbox[0]!.body) };
}

describe("matchesRecipient", () => {
  const eva = { given: ["Eva"], family: "Brandl" };
  it.each(["Dr. Eva Brandl", "eva brandl", "EVA BRANDL", "Dr.med. Eva Maria Brandl", "Univ.-Prof. Dr. Eva Brandl", "Mag. Éva Brändl"])("%s matches Eva Brandl", (typed) => {
    const n = parseRecipientName(typed);
    expect(matchesRecipient(n, eva) || matchesRecipient({ ...n, family: n.family.replace("ä", "a") }, eva)).toBe(true);
  });
  it("folds diacritics and ß", () => {
    expect(matchesRecipient(parseRecipientName("Jürgen Groß"), { given: ["Jurgen"], family: "Gross" })).toBe(true);
  });
  it.each(["Dr. Thomas Gruber", "Ines Fremd", "Dr. Eva Brandner", "Maria Brandl"])("%s does not match", (typed) => {
    expect(matchesRecipient(parseRecipientName(typed), eva)).toBe(false);
  });
  it("policy per document type", () => {
    expect(policyFor({ documentType: "lab-result" } as DocumentRequest)).toBe("eid-high+register");
    expect(policyFor({ documentType: "rehab-discharge-report" } as DocumentRequest)).toBe("eid-high");
  });
  it("LoA must be high", () => {
    const r = { documentType: "lab-result", recipient: { name: { given: ["Eva"], family: "Brandl" } } } as DocumentRequest;
    expect(decideIdentity(r, identity("eva-brandl", undefined, "substantial"))).toEqual({ ok: false, reason: "loa-too-low" });
  });
});

describe("completeIdentityCheck", () => {
  it("Eva Brandl ok: register listed, authorized view, audit", async () => {
    const { service, deps, request, token } = await sent();
    const out = await service.completeIdentityCheck(token, identity("eva-brandl"), { ipHash: "h" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.policy).toBe("eid-high+register");
    expect(out.register).toMatchObject({ checked: true, listed: true, registrationNumber: "AT-LAB-4711" });
    expect(out.view).toMatchObject({ patient: { name: { given: ["Maria"], family: "Beispiel" }, birthDate: "1961-03-12" }, documentType: "lab-result", note: labBody.note });
    expect((await deps.repo.byId(request.id))!.status).toBe("verified");
    const audit = await deps.audit.forRequest(request.id);
    expect(audit.at(-1)).toMatchObject({ step: "identity-checked", outcome: "success", actor: { kind: "outside-person", id: "GH:mock-bpk-eva-brandl", display: "Dr. Eva Brandl" } });
    expect(audit.at(-1)!.what).toBe("Identity of Dr. Eva Brandl confirmed via ID Austria (simulated), LoA high; register: listed (AT-LAB-4711)");
  });

  it.each([
    ["thomas-gruber", "Thomas Gruber", "M2 forwarded"],
    ["ines-fremd", "Ines Fremd", "M1 wrong address"],
  ])("%s fails (%s): nothing shown, misdelivery audited, Matrix warning", async (key, name) => {
    const { service, deps, request, token } = await sent();
    const out = await service.completeIdentityCheck(token, identity(key), {});
    expect(out).toMatchObject({ ok: false, reason: "name-mismatch" });
    expect(out.view).toBeUndefined();
    expect(JSON.stringify(out)).not.toMatch(/Maria|1961-03-12/);
    const r = (await deps.repo.byId(request.id))!;
    expect(r.status).toBe("identity-failed");
    expect(r.lastProblem).toBe("identity-mismatch");
    const steps = (await deps.audit.forRequest(request.id)).map((a) => `${a.step}:${a.outcome}`);
    expect(steps).toEqual(["request-sent:success", "identity-checked:failure", "misdelivery-caught:failure"]);
    const chat = await deps.chat.list(labBody.roomId);
    expect(chat.at(-1)).toMatchObject({ severity: "warning" });
    expect(chat.at(-1)!.body).toContain(`Jemand anderer als Dr. Eva Brandl hat versucht, die Anfrage zu öffnen (verifiziert als: ${name})`);

    // the right person can still open it afterwards
    const ok = await service.completeIdentityCheck(token, identity("eva-brandl"), {});
    expect(ok.ok).toBe(true);
  });

  it("Eva not in register → ok with listed:false (answer will be held)", async () => {
    const { service, deps, request, token } = await sent(labBody, { register: new FakeRegister({}) });
    const out = await service.completeIdentityCheck(token, identity("eva-brandl"), {});
    expect(out).toMatchObject({ ok: true, register: { checked: true, listed: false } });
    expect((await deps.audit.forRequest(request.id)).at(-1)!.outcome).toBe("warning");
  });

  it("rehab: Stefan Kern, no register check", async () => {
    const { service, token } = await sent(rehabBody);
    const out = await service.completeIdentityCheck(token, identity("stefan-kern"), {});
    expect(out).toMatchObject({ ok: true, policy: "eid-high", register: { checked: false } });
  });

  it("expired and unknown links", async () => {
    let now = new Date("2026-10-30T08:05:00Z");
    const { service, token } = await sent(labBody, { now: () => now });
    now = new Date("2026-11-05T00:00:00Z");
    expect(await service.completeIdentityCheck(token, identity("eva-brandl"), {})).toMatchObject({ ok: false, reason: "expired" });
    await expect(service.completeIdentityCheck("nope", identity("eva-brandl"), {})).rejects.toMatchObject({ code: "request-not-found" });
  });
});

// V2-TEST-2: v2 add-ons end-to-end. Needs HAPI + Mailpit (npm run stack:up && npm run seed).
// Starts two extra cores (tests/e2e/lib/core.ts) so the main core on :3000 keeps its default config:
//   jury core     :3101  JURY_MODE=true, LLM_PROVIDER=mock, scheduler off
//   reminder core :3102  REMINDER_BEFORE_EXPIRY_MINUTES huge, SCHEDULER_INTERVAL_SECONDS=1 (every request is "due")
// The default-mode checks run against the main core when it is up (PUBLIC_BASE_URL).
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ChatMessageView, CreateRequestBody, DocumentRequestView, ParsedDocument } from "@brieftaube/shared";
import { assertNotificationIsClean } from "../../services/core/src/notify/privacy.ts";
import { fixture } from "../fixtures/documents/index.ts";
import { isStackUp, startCore, type ExtraCore } from "./lib/core.ts";
import { coreApi, isCoreUp, labRequest, linkIn, mailFor, mailsFor, poll, rehabRequest, type CoreApi } from "./lib/stack.ts";
import { OutsidePerson, text } from "./lib/portal.ts";
import { MERGED } from "./lib/v2-features.ts";


const stack = await isStackUp();
if (!stack) console.warn("[e2e] HAPI/Mailpit not reachable — v2 e2e skipped");
const mainUp = await isCoreUp();
const MARIA_FORM = { given: "Maria", family: "Beispiel", birthDate: "1961-03-12" };
const MARIA = { name: { given: ["Maria"], family: "Beispiel" }, birthDate: "1961-03-12" };
const ROOM = "!standalone:klinikum.example";
const runTag = Math.random().toString(36).slice(2, 7);
let n = 0;
const evaAddress = () => `eva.brandl+v2-${runTag}-${++n}@labor-kanal.example`;

let jury: ExtraCore | undefined;
let reminder: ExtraCore | undefined;
beforeAll(async () => {
  if (!stack) return;
  jury = await startCore("jury", 3101, { JURY_MODE: "true", LLM_PROVIDER: "mock", SCHEDULER_INTERVAL_SECONDS: "0" });
  if (MERGED["V2-REM-1"]) reminder = await startCore("reminder", 3102, { REMINDER_BEFORE_EXPIRY_MINUTES: "1000000", SCHEDULER_INTERVAL_SECONDS: "1" });
}, 120_000);
afterAll(async () => {
  await jury?.stop();
  await reminder?.stop();
});

const withRoom = (b: CreateRequestBody): CreateRequestBody => ({ ...b, roomId: ROOM });

async function waitFor(api: CoreApi, id: string, pred: (r: DocumentRequestView) => boolean, what: string) {
  return poll(what, async () => {
    const d = await api.detail(id);
    return pred(d.request) ? d : undefined;
  }, 20_000);
}

async function chatFor(api: CoreApi, reference: string): Promise<ChatMessageView[]> {
  return (await api.chat(ROOM)).filter((m) => m.body.includes(reference)).sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

/** Dr. Brandl (seeded eID persona) answers a lab request on `core` with `content`. */
async function evaAnswers(core: ExtraCore, content: string) {
  const { request, juryLink } = await core.api.createRequest(withRoom(labRequest(evaAddress())));
  const mail = await mailFor(request.reference);
  const eva = new OutsidePerson(linkIn(mail.text).url);
  await eva.open();
  await eva.loginWithEid({ persona: "eva-brandl" });
  const result = await eva.submitAnswer({ ...MARIA_FORM, content, fileName: "befund.md" });
  return { request, juryLink, mail, eva, result };
}

const lab = (d: ParsedDocument | undefined) => {
  if (d?.kind !== "lab-result") throw new Error("not a lab fixture");
  return d;
};

describe.skipIf(!stack)("V2 jury mode (V2-BOOT-1)", () => {
  it.skipIf(!MERGED["V2-BOOT-1"])("jury core: ui-config says juryMode, createRequest returns the same link as the email", async () => {
    expect(await jury!.api.uiConfig()).toEqual({ juryMode: true, llmEnabled: true });
    const { request, juryLink } = await jury!.api.createRequest(withRoom(labRequest(evaAddress())));
    expect(juryLink).toMatch(/^http:\/\/localhost:3101\/r\/[A-Za-z0-9_-]{16,}$/);
    const mail = await mailFor(request.reference);
    expect(linkIn(mail.text).url).toBe(juryLink);
  });

  it.skipIf(!MERGED["V2-BOOT-1"] || !mainUp)("default core: juryMode false and no juryLink", async () => {
    expect((await coreApi.uiConfig())?.juryMode).toBe(false);
    const res = await coreApi.createRequest(labRequest(evaAddress()));
    expect(res.juryLink).toBeUndefined();
    expect(JSON.stringify(res)).not.toMatch(/\/r\/[A-Za-z0-9_-]{16,}/);
  });
});

describe.skipIf(!stack)("V2 critical values (V2-CRIT-1, V2-CRIT-2)", () => {
  it.skipIf(!MERGED["V2-CRIT-1"])("platelets 38 + INR 5.2: 🚨 alert before ✅, critical flags in the summary", async () => {
    const f = fixture("lab-critical-platelets-inr");
    const { request } = await evaAnswers(jury!, f.content);
    const d = await waitFor(jury!.api, request.id, (r) => r.status === "filed", "critical lab filed");
    expect(d.summary?.kind).toBe("lab-result");
    const values = d.summary?.kind === "lab-result" ? d.summary.values : [];
    const flagged = values.filter((v) => v.critical).map((v) => v.loinc);
    expect(flagged.sort()).toEqual([...(f.expected.ok ? (f.expected.expectedCritical ?? []) : [])].sort());
    expect(values.find((v) => v.loinc === "777-3")?.critical?.rule).toBe("< 50");

    const msgs = await poll("🚨 and ✅ messages", async () => {
      const m = await chatFor(jury!.api, request.reference);
      return m.some((x) => x.severity === "alert" && x.body.includes("🚨")) && m.some((x) => x.severity === "success") ? m : undefined;
    });
    const alertIdx = msgs.findIndex((x) => x.severity === "alert" && x.body.includes("🚨"));
    const okIdx = msgs.findIndex((x) => x.severity === "success");
    expect(alertIdx, "🚨 comes before ✅").toBeLessThan(okIdx);
    expect(msgs[alertIdx]!.body).toMatch(/Kritischer Wert/);
    expect(msgs[alertIdx]!.body).toMatch(/Thrombozyten 38/);
    const filedAudit = d.audit.find((e) => e.step === "answer-filed");
    expect(JSON.stringify(filedAudit?.details ?? {})).toMatch(/777-3|Thrombozyten/);
  });

  it.skipIf(!MERGED["V2-CRIT-1"])("scenario values for Maria: no 🚨", async () => {
    const { request } = await evaAnswers(jury!, fixture("scenario/lab-result-maria-beispiel").content);
    const d = await waitFor(jury!.api, request.id, (r) => r.status === "filed", "Maria lab filed");
    expect(d.summary?.kind === "lab-result" && d.summary.values.some((v) => v.critical)).toBe(false);
    await poll("✅ message", async () => ((await chatFor(jury!.api, request.reference)).some((m) => m.severity === "success") ? true : undefined));
    expect((await chatFor(jury!.api, request.reference)).some((m) => m.body.includes("🚨"))).toBe(false);
  });

  it.skipIf(!MERGED["V2-CRIT-2"])("✅ message has a German html table with INR 1,0 and Thrombozyten 245 10⁹/L; summary has loinc", async () => {
    const { request } = await evaAnswers(jury!, fixture("scenario/lab-result-maria-beispiel").content);
    const d = await waitFor(jury!.api, request.id, (r) => r.status === "filed", "Maria lab filed");
    expect(d.summary?.kind === "lab-result" && d.summary.values.map((v) => v.loinc).sort()).toEqual(["14979-9", "3255-7", "6301-6", "777-3"]);
    const ok = await poll("✅ message with html", async () => (await chatFor(jury!.api, request.reference)).find((m) => m.severity === "success" && m.html));
    expect(ok.html).toMatch(/<table/);
    for (const s of ["INR", "1,0", "Thrombozyten", "245", "10⁹/L"]) expect(ok.html).toContain(s);
    expect(ok.html).not.toMatch(/Platelets|prothrombin time/);
  });
});

describe.skipIf(!stack)("V2 held review with evidence (V2-AI-1, mock LLM)", () => {
  for (const name of ["lab-prose-letter-de", "lab-bullet-list-de", "free-text-letter-not-in-format"]) {
    it.skipIf(!MERGED["V2-AI-1"])(`${name}: held (ai-extracted), every value has an evidence line from the source`, async () => {
      const f = fixture(name);
      const llm = lab(f.expected.ok ? undefined : f.expected.llmDocument);
      jury!.setLlmMock(llm);
      const { request } = await evaAnswers(jury!, f.content);
      const d = await waitFor(jury!.api, request.id, (r) => r.status === "held", `${name} held`);
      expect(d.request.heldReason).toBe("ai-extracted");
      expect(d.request.filedResources).toEqual([]);
      const review = d.review!;
      expect(review.method).toBe("llm");
      expect(review.sourceText.replace(/\r\n/g, "\n")).toBe(f.content.replace(/\r\n/g, "\n"));
      const lines = review.sourceText.split(/\r?\n/);
      expect(review.values).toHaveLength(llm.values.length);
      for (const v of review.values!) {
        const forms = [String(v.value), v.value.toFixed(1)].flatMap((x) => [x, x.replace(".", ",")]);
        expect(forms.some((x) => v.evidence.text.includes(x)), `${v.testName} ${v.value} in "${v.evidence.text}"`).toBe(true);
        expect(lines[v.evidence.line - 1], `line ${v.evidence.line}`).toContain(v.evidence.text.trim());
      }
      if (review.patient.evidence) expect(lines[review.patient.evidence.line - 1]).toContain("Beispiel");
    });
  }
});

describe.skipIf(!stack)("V2 portal: demo buttons and receipt (V2-JURY-2, V2-RCPT-1)", () => {
  async function answerPageText(api: CoreApi): Promise<string> {
    const { request } = await api.createRequest(withRoom(labRequest(evaAddress())));
    const p = new OutsidePerson(linkIn((await mailFor(request.reference)).text).url);
    await p.open();
    await p.loginWithEid({ persona: "eva-brandl" });
    return (await p.answerForm())!.page.html;
  }

  it.skipIf(!MERGED["V2-JURY-2"])("demo buttons only in jury mode", async () => {
    const html = await answerPageText(jury!.api);
    expect(html).toContain("Beispielbefund einsetzen (Demo)");
    expect(html).toContain("Beispiel: falsche Patientin (Demo)");
    if (mainUp) {
      const plain = await answerPageText(coreApi);
      expect(plain).not.toContain("(Demo)");
    }
  });

  it.skipIf(!MERGED["V2-RCPT-1"])("result page shows an Eingangsbestätigung with the SHA-256 of the submitted text", async () => {
    const content = fixture("scenario/lab-result-maria-beispiel").content;
    const { result, request } = await evaAnswers(jury!, content);
    const t = text(result);
    expect(t).toMatch(/Eingangsbestätigung/);
    expect(t).toContain(request.reference);
    const sha = createHash("sha256").update(content, "utf8").digest("hex");
    expect(result.html).toContain(sha.slice(0, 16));
    expect(result.html).toContain(sha);
    expect(result.html).toMatch(/window\.print\(\)/);
    expect(t).not.toMatch(/Thrombozyten|Platelets|INR/);
  });
});

describe.skipIf(!stack)("V2 reminders and link rotation (V2-REM-1)", () => {
  it.skipIf(!MERGED["V2-REM-1"])("email: reminder with a new link; old link no longer works; privacy guard passes", async () => {
    const address = evaAddress();
    const { request } = await reminder!.api.createRequest(withRoom(labRequest(address)));
    const first = linkIn((await mailFor(request.reference)).text).url;
    const d = await waitFor(reminder!.api, request.id, (r) => !!r.reminderSentAt, "reminderSentAt");
    expect(d.audit.filter((e) => e.step === "reminder-sent")).toHaveLength(1);
    const mails = await poll("reminder email", async () => {
      const m = await mailsFor(request.reference);
      return m.length >= 2 ? m : undefined;
    });
    const reminderMail = mails.find((m) => linkIn(m.text).url !== first)!;
    expect(reminderMail, "reminder email has a different link").toBeDefined();
    for (const part of [reminderMail.subject, reminderMail.text, reminderMail.html]) {
      assertNotificationIsClean(part, { patient: MARIA, documentType: "lab-result", recipientAddress: address });
    }
    expect(reminderMail.text).toMatch(/Erinnerung/);

    const old = new OutsidePerson(first);
    const oldPage = await old.browser.get(first);
    expect(text(oldPage)).toMatch(/abgelaufen|ersetzt|nicht mehr gültig/i);
    await expect(old.loginWithEid({ persona: "eva-brandl" })).rejects.toThrow();

    const fresh = new OutsidePerson(linkIn(reminderMail.text).url);
    await fresh.open();
    await fresh.loginWithEid({ persona: "eva-brandl" });
    expect(await fresh.answerForm(), "answer form behind the new link").toBeDefined();
    await poll("🔔 message", async () => ((await chatFor(reminder!.api, request.reference)).some((m) => m.body.includes("🔔")) ? true : undefined));

    await new Promise((r) => setTimeout(r, 2500)); // two more scheduler ticks: still exactly one reminder
    const again = await reminder!.api.detail(request.id);
    expect(again.audit.filter((e) => e.step === "reminder-sent")).toHaveLength(1);
  });

  it.skipIf(!MERGED["V2-REM-1"])("SMS: reminder passes the privacy guard", async () => {
    const { request } = await reminder!.api.createRequest(withRoom(rehabRequest()));
    await waitFor(reminder!.api, request.id, (r) => !!r.reminderSentAt, "reminderSentAt (sms)");
    const sms = await poll("2 SMS", async () => {
      const s = (await reminder!.api.sms()).filter((x) => x.body.includes(request.reference));
      return s.length >= 2 ? s : undefined;
    });
    for (const s of sms) assertNotificationIsClean(s.body, { patient: MARIA, documentType: "rehab-discharge-report", recipientAddress: s.to });
    expect(new Set(sms.map((s) => linkIn(s.body).url)).size).toBe(2);
  });
});

// In-browser mock of the core API (?mock=1). Lets the UI run and be screenshotted without the core.
// Behaviour follows docs/DESIGN.md loosely; the real rules live in the core.
import type {
  FiledOriginal,
  AuditEntry,
  AuditStep,
  ChatMessageView,
  CreateRequestBody,
  CreateRequestResponse,
  DocumentRequestView,
  FiledSummary,
  HeldDecisionResponse,
  HeldReview,
  MeResponse,
  PatientSnapshot,
  RecipientCheckBody,
  RecipientCheckResponse,
  RecipientWarning,
  RequestDetailResponse,
  UiConfigResponse,
} from "@brieftaube/shared";
import { REQUEST_TTL_HOURS } from "@brieftaube/shared";
import type { Api } from "./client.ts";
import { ApiRequestError } from "./client.ts";

const PATIENTS: PatientSnapshot[] = [
  { fhirId: "maria-beispiel", name: { given: ["Maria"], family: "Beispiel" }, birthDate: "1961-03-12", gender: "female" },
  { fhirId: "max-beispiel", name: { given: ["Max"], family: "Beispiel" }, birthDate: "1960-01-01", gender: "male" },
  { fhirId: "johann-muster", name: { given: ["Johann"], family: "Muster" }, birthDate: "1948-11-02", gender: "male" },
  { fhirId: "aylin-demir", name: { given: ["Aylin"], family: "Demir" }, birthDate: "1985-07-23", gender: "female" },
];

const KNOWN = ["eva.brandl@labor-kanal.example", "+436601234567"];
const BOT = "@brieftaube:klinikum.example";
const LENA = { kind: "internal-practitioner" as const, id: "@lena.hofer:klinikum.example", display: "Dr. Lena Hofer" };

interface MockRecord {
  view: DocumentRequestView;
  audit: AuditEntry[];
  summary?: FiledSummary;
  review?: HeldReview;
  original?: FiledOriginal;
}

const MOCK_SHA = "3f9a1c0e7b2d4a6f8e1c3b5d7f9a0c2e4b6d8f1a3c5e7b9d0f2a4c6e8b1d3f5a";
const mockOriginal = (storedIn: string, fileName: string, text: string): FiledOriginal => ({ storedIn, fileName, contentType: "text/markdown", text, sha256: MOCK_SHA });

const LAB_ORIGINAL = [
  "# Labor Kanalstraße: lab report",
  "",
  "Patient: Maria Beispiel, born 12 March 1961",
  "Requested by: Dr. Lena Hofer, Klinikum Beispielstadt",
  "Sample taken: 22 October 2026, 08:10",
  "Reported: 22 October 2026, 11:40",
  "",
  "| Test | Result | Unit | Reference range | LOINC code |",
  "|---|---|---|---|---|",
  "| INR (prothrombin time) | 1.0 | | 0.8 to 1.2 | 6301-6 |",
  "| aPTT | 31 | s | 25 to 37 | 14979-9 |",
  "| Platelets | 245 | 10^9/L | 150 to 400 | 777-3 |",
  "| Fibrinogen | 3.1 | g/L | 2.0 to 4.0 | 3255-7 |",
  "",
  "No coagulation disorder. Fit for surgery from a coagulation point of view.",
  "",
  "Validated by: Dr. Eva Brandl, lab physician",
].join("\n");

const REHAB_ORIGINAL = [
  "# Reha Waldblick: discharge report",
  "",
  "Patient: Maria Beispiel, born 12 March 1961",
  "Stay: 2 September 2026 to 23 September 2026",
  "",
  "## Summary",
  "Orthopaedic rehabilitation after right total knee replacement. Mobile with one crutch, pain well controlled.",
].join("\n");

const HELD_SOURCE = [
  "LABOR DR. WEISS – Befundübermittlung per Fax",
  "",
  "Pat.: Beispiel Maria, geb. 12.03.1961",
  "Einsender: Dr. L. Hofer, Klinikum Beispielstadt",
  "Abnahme 29.10.2026 07:45",
  "",
  "Gerinnung:",
  "  Prothrombinzeit INR ....... 2,9   (0,8 - 1,2)",
  "  aPTT ...................... 41 s  (25 - 37)",
  "Blutbild:",
  "  Thrombozyten .............. 38 G/l (150 - 400)",
  "  Hämoglobin ................ 11,8 g/dl (12,0 - 16,0)",
  "",
  "Kommentar: Antikoagulation? Bitte klinisch korrelieren.",
  "Vidiert: Dr. K. Weiss",
].join("\n");

const delay = (ms = 150) => new Promise((r) => setTimeout(r, ms));
let seq = 0;
const id = () => `mock-${++seq}`;
const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

export function mockRecipientWarnings(body: RecipientCheckBody): RecipientWarning[] {
  const w: RecipientWarning[] = [];
  const addr = body.address.trim();
  if (body.channel === "email") {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) w.push({ code: "invalid-format", message: "Das ist keine gültige E-Mail-Adresse." });
    if (/[A-Z]/.test(addr))
      w.push({ code: "uppercase-in-address", message: `Die Adresse enthält Großbuchstaben (${[...addr].filter((c) => /[A-Z]/.test(c)).join(", ")}). Tippfehler? Ein großes „I“ sieht aus wie ein kleines „l“.` });
    if (/[^\x00-\x7F]/.test(addr)) w.push({ code: "confusable-characters", message: "Die Adresse enthält ungewöhnliche Zeichen, die wie lateinische Buchstaben aussehen." });
    const family = body.displayName.trim().split(/\s+/).pop()?.toLowerCase() ?? "";
    if (family && !addr.toLowerCase().split("@")[0]!.includes(family))
      w.push({ code: "name-not-in-address", message: `Der Name „${family}“ kommt in der Adresse nicht vor.` });
  } else if (!/^\+?[0-9 ]{8,}$/.test(addr)) {
    w.push({ code: "invalid-format", message: "Das ist keine gültige Mobilnummer (z. B. +43 660 1234567)." });
  }
  if (addr && !KNOWN.includes(addr.replace(/\s/g, "")))
    w.push({ code: "unknown-contact", message: "An diese Adresse haben Sie noch nie eine Anfrage gesendet." });
  return w;
}

function entry(r: DocumentRequestView, step: AuditStep, minutesAgo: number, what: string, outcome: AuditEntry["outcome"], actor?: AuditEntry["actor"]): AuditEntry {
  return {
    id: id(),
    requestId: r.id,
    requestReference: r.reference,
    step,
    at: iso(minutesAgo),
    actor: actor ?? { kind: "system", id: "brieftaube", display: "Brieftaube" },
    what,
    outcome,
  };
}

function sampleData(roomId: string): { records: MockRecord[]; chat: ChatMessageView[] } {
  const maria = PATIENTS[0]!;
  const eva = { displayName: "Dr. Eva Brandl", name: { prefix: ["Dr."], given: ["Eva"], family: "Brandl" }, role: "Laborärztin", organization: "Labor Kanalstraße", isPhysician: true };
  const mk = (ref: string, status: DocumentRequestView["status"], minutesAgo: number, extra: Partial<DocumentRequestView>): DocumentRequestView => ({
    id: id(),
    reference: ref,
    createdAt: iso(minutesAgo),
    expiresAt: iso(minutesAgo - REQUEST_TTL_HOURS * 60),
    status,
    documentType: "lab-result",
    patient: maria,
    recipient: { ...eva, channel: "email", address: "eva.brandl@labor-kanal.example" },
    filedResources: [],
    ...extra,
  });
  const evaVerified = { kind: "outside-person" as const, id: "GH:mock-bpk-eva-brandl", display: "Dr. Eva Brandl (e-ID)" };

  const filed = mk("BT-7K2Q", "filed", 95, { filedResources: ["DiagnosticReport/dr-1", "Observation/o-1", "Observation/o-2", "Observation/o-3", "Observation/o-4"] });
  const filedRec: MockRecord = {
    view: filed,
    audit: [
      entry(filed, "request-sent", 95, "Request sent by email", "success", LENA),
      entry(filed, "link-opened", 80, "Link opened", "success", { kind: "unverified-visitor", id: "anonymous", display: "Unbekannt" }),
      entry(filed, "identity-checked", 79, "Identity verified: Eva Brandl (LoA high), physician register ✓", "success", evaVerified),
      entry(filed, "answer-sent", 76, "Answer uploaded: labor-kanalstrasse.md", "success", evaVerified),
      entry(filed, "answer-filed", 76, "Filed DiagnosticReport + 4 Observations + Provenance", "success"),
    ],
    summary: {
      kind: "lab-result",
      values: [
        { testName: "INR (prothrombin time)", loinc: "6301-6", value: 1.0, unit: "{INR}", low: 0.8, high: 1.2, interpretation: "N" },
        { testName: "aPTT", loinc: "14979-9", value: 31, unit: "s", low: 25, high: 37, interpretation: "N" },
        { testName: "Platelets", loinc: "777-3", value: 245, unit: "10*9/L", low: 150, high: 400, interpretation: "N" },
        { testName: "Fibrinogen", loinc: "3255-7", value: 3.1, unit: "g/L", low: 2.0, high: 4.0, interpretation: "N" },
      ],
      conclusion: "No coagulation disorder. Fit for surgery from a coagulation point of view.",
    },
    original: mockOriginal("DiagnosticReport/dr-1", "labor-kanalstrasse.md", LAB_ORIGINAL),
  };

  const m1 = mk("BT-M1X4", "identity-failed", 60, { recipient: { ...eva, channel: "email", address: "eva.brandl@labor-kanaI.example" }, lastProblem: "identity-mismatch" });
  const ines = { kind: "outside-person" as const, id: "GH:mock-bpk-ines-fremd", display: "Ines Fremd (e-ID)" };
  const m1Rec: MockRecord = {
    view: m1,
    audit: [
      entry(m1, "request-sent", 60, "Request sent by email (warnings acknowledged: uppercase-in-address, unknown-contact)", "warning", LENA),
      entry(m1, "link-opened", 50, "Link opened", "success", { kind: "unverified-visitor", id: "anonymous", display: "Unbekannt" }),
      entry(m1, "identity-checked", 49, "Identity verified as Ines Fremd – does not match Eva Brandl", "failure", ines),
      entry(m1, "misdelivery-caught", 49, "Identity mismatch: nothing shown, answer not possible", "failure", ines),
    ],
  };

  const m3 = mk("BT-M3P9", "rejected", 30, { lastProblem: "wrong-patient" });
  const m3Rec: MockRecord = {
    view: m3,
    audit: [
      entry(m3, "request-sent", 30, "Request sent by email", "success", LENA),
      entry(m3, "link-opened", 25, "Link opened", "success", { kind: "unverified-visitor", id: "anonymous", display: "Unbekannt" }),
      entry(m3, "identity-checked", 24, "Identity verified: Eva Brandl (LoA high), physician register ✓", "success", evaVerified),
      entry(m3, "answer-sent", 22, "Answer uploaded: lab-result-max-beispiel.md", "success", evaVerified),
      entry(m3, "misdelivery-caught", 22, "Wrong patient: document is about Max Beispiel (1960-01-01) – not filed", "failure"),
    ],
  };

  const rehab = mk("BT-R2HB", "filed", 15, {
    documentType: "rehab-discharge-report",
    recipient: { displayName: "Sabine Koller", name: { given: ["Sabine"], family: "Koller" }, role: "Entlassungsmanagement", organization: "Reha Waldblick", isPhysician: false, channel: "sms", address: "+43 660 1234567" },
    filedResources: ["DocumentReference/doc-1"],
  });
  const sabine = { kind: "outside-person" as const, id: "GH:mock-bpk-sabine-koller", display: "Sabine Koller (e-ID)" };
  const rehabRec: MockRecord = {
    view: rehab,
    audit: [
      entry(rehab, "request-sent", 15, "Request sent by SMS", "success", LENA),
      entry(rehab, "link-opened", 10, "Link opened", "success", { kind: "unverified-visitor", id: "anonymous", display: "Unbekannt" }),
      entry(rehab, "identity-checked", 9, "Identity verified: Sabine Koller (LoA high)", "success", sabine),
      entry(rehab, "answer-sent", 7, "Answer uploaded: reha-waldblick.md", "success", sabine),
      entry(rehab, "answer-filed", 7, "Filed DocumentReference + Provenance", "success"),
    ],
    summary: {
      kind: "rehab-discharge-report",
      title: "Reha Waldblick: discharge report",
      stay: { start: "2026-09-02", end: "2026-09-23" },
      excerpt: "Orthopaedic rehabilitation after right total knee replacement. Mobile with one crutch, pain well controlled.",
    },
    original: mockOriginal("DocumentReference/doc-1", "reha-waldblick.md", REHAB_ORIGINAL),
  };

  const msg = (minutesAgo: number, severity: ChatMessageView["severity"], body: string, html?: string): ChatMessageView => ({
    id: id(),
    roomId,
    sender: BOT,
    sentAt: iso(minutesAgo),
    body,
    html,
    severity,
  });
  const chat = [
    msg(95, "info", "📨 Anfrage BT-7K2Q an Dr. Eva Brandl (E-Mail) gesendet – Laborbefund für Maria Beispiel."),
    msg(76, "success", "✅ BT-7K2Q: Laborbefund von Dr. Eva Brandl abgelegt. INR 1,0 (0,8–1,2) · aPTT 31 s · Thrombozyten 245 10⁹/L · Fibrinogen 3,1 g/L – alle im Referenzbereich. Identität: ID Austria (simuliert), Ärzteliste ✓"),
    msg(60, "info", "📨 Anfrage BT-M1X4 an Dr. Eva Brandl (E-Mail) gesendet – Laborbefund für Maria Beispiel."),
    msg(49, "warning", "⚠️ BT-M1X4: Jemand anderer als Dr. Eva Brandl hat versucht, die Anfrage zu öffnen (verifiziert als: Ines Fremd). Es wurde nichts angezeigt. Bitte Adresse prüfen: eva.brandl@labor-kanaI.example"),
    msg(30, "info", "📨 Anfrage BT-M3P9 an Dr. Eva Brandl (E-Mail) gesendet – Laborbefund für Maria Beispiel."),
    msg(22, "alert", "🛑 BT-M3P9: Antwort betrifft eine andere Person (Max Beispiel, geb. 01.01.1960) – NICHT abgelegt. Dr. Eva Brandl wurde gebeten, das richtige Dokument zu senden."),
    msg(15, "info", "📨 Anfrage BT-R2HB an Sabine Koller (SMS) gesendet – Reha-Entlassungsbericht für Maria Beispiel."),
    msg(7, "success", "✅ BT-R2HB: Reha-Entlassungsbericht von Sabine Koller abgelegt (Aufenthalt 02.09.–23.09.2026). Identität: ID Austria (simuliert)"),
  ];
  const waiting = mk("BT-W5RT", "sent", 67 * 60, { reminderSentAt: iso(19 * 60) });
  const waitingRec: MockRecord = {
    view: waiting,
    audit: [entry(waiting, "request-sent", 67 * 60, "Request sent by email", "success", LENA), entry(waiting, "reminder-sent", 19 * 60, "Reminder sent with a new link", "success")],
  };
  const expired = mk("BT-X3PD", "expired", 80 * 60, { documentType: "rehab-discharge-report" });
  const expiredRec: MockRecord = {
    view: expired,
    audit: [entry(expired, "request-sent", 80 * 60, "Request sent by email", "success", LENA)],
  };
  const held = mk("BT-H8LD", "held", 5, {
    recipient: { displayName: "Dr. Karin Weiss", name: { prefix: ["Dr."], given: ["Karin"], family: "Weiss" }, role: "Laborärztin", organization: "Labor Dr. Weiss", isPhysician: true, channel: "email", address: "karin.weiss@labor-weiss.example" },
    heldReason: "ai-extracted",
  });
  const karin = { kind: "outside-person" as const, id: "GH:mock-bpk-karin-weiss", display: "Dr. Karin Weiss (e-ID)" };
  const ev = (line: number) => ({ line, text: HELD_SOURCE.split("\n")[line - 1]!.trim() });
  const heldRec: MockRecord = {
    view: held,
    audit: [
      entry(held, "request-sent", 5, "Request sent by email", "success", LENA),
      entry(held, "link-opened", 4, "Link opened", "success", { kind: "unverified-visitor", id: "anonymous", display: "Unbekannt" }),
      entry(held, "identity-checked", 3, "Identity verified: Karin Weiss (LoA high), physician register ✓", "success", karin),
      entry(held, "answer-sent", 2, "Answer uploaded: fax-labor-weiss.txt (read by LLM, held for review)", "warning", karin),
    ],
    review: {
      method: "llm",
      reason: "ai-extracted",
      patient: { given: ["Maria"], family: "Beispiel", birthDate: "1961-03-12", evidence: ev(3) },
      values: [
        { testName: "INR", loinc: "6301-6", value: 2.9, unit: "{INR}", low: 0.8, high: 1.2, evidence: ev(8) },
        { testName: "aPTT", loinc: "14979-9", value: 41, unit: "s", low: 25, high: 37, evidence: ev(9) },
        { testName: "Thrombozyten", loinc: "777-3", value: 38, unit: "10*9/L", low: 150, high: 400, evidence: ev(11) },
        { testName: "Hämoglobin", loinc: "718-7", value: 11.8, unit: "g/dL", low: 12.0, high: 16.0, evidence: ev(12) },
      ],
      sourceText: HELD_SOURCE,
    },
  };
  chat.push(msg(2, "warning", "🟡 BT-H8LD: Antwort von Dr. Karin Weiss wurde von der KI gelesen – bitte Werte prüfen und freigeben."));
  return { records: [filedRec, m1Rec, m3Rec, rehabRec, heldRec, waitingRec, expiredRec], chat };
}

export class MockApi implements Api {
  private records: MockRecord[];
  private chat: ChatMessageView[];

  constructor(
    roomId: string,
    withSamples = true,
    private readonly juryMode = false,
  ) {
    const s = withSamples ? sampleData(roomId) : { records: [], chat: [] };
    this.records = s.records;
    this.chat = s.chat;
  }

  async uiConfig(): Promise<UiConfigResponse> {
    await delay();
    return { juryMode: this.juryMode, llmEnabled: false };
  }

  async me(): Promise<MeResponse> {
    await delay();
    return { matrixUserId: LENA.id, displayName: LENA.display, organization: "Klinikum Beispielstadt" };
  }

  async patients(q: string): Promise<PatientSnapshot[]> {
    await delay();
    const needle = q.trim().toLowerCase();
    return PATIENTS.filter((p) => !needle || `${p.name.given.join(" ")} ${p.name.family}`.toLowerCase().includes(needle));
  }

  async recipientCheck(body: RecipientCheckBody): Promise<RecipientCheckResponse> {
    await delay();
    return { warnings: mockRecipientWarnings(body) };
  }

  async createRequest(body: CreateRequestBody): Promise<CreateRequestResponse> {
    await delay(300);
    const warnings = mockRecipientWarnings(body.recipient);
    if (warnings.length > 0 && !body.acknowledgeWarnings) {
      throw new ApiRequestError(409, "recipient-warnings", "Bitte die Warnungen zur Adresse bestätigen.");
    }
    const patient = PATIENTS.find((p) => p.fhirId === body.patientId);
    if (!patient) throw new ApiRequestError(404, "patient-not-found", "Patient:in nicht gefunden.");
    const parts = body.recipient.displayName.trim().split(/\s+/);
    const prefix = parts.filter((p) => /\.$/.test(p));
    const rest = parts.filter((p) => !/\.$/.test(p));
    const ref = `BT-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const view: DocumentRequestView = {
      id: id(),
      reference: ref,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + REQUEST_TTL_HOURS * 3_600_000).toISOString(),
      status: "sent",
      documentType: body.documentType,
      patient,
      recipient: { ...body.recipient, name: { prefix, given: rest.slice(0, -1), family: rest.at(-1) ?? "" } },
      filedResources: [],
    };
    const rec: MockRecord = { view, audit: [entry(view, "request-sent", 0, `Request sent by ${body.recipient.channel}`, warnings.length ? "warning" : "success", LENA)] };
    this.records.push(rec);
    const docLabel = body.documentType === "lab-result" ? "Laborbefund" : "Reha-Entlassungsbericht";
    this.chat.push({
      id: id(),
      roomId: body.roomId,
      sender: BOT,
      sentAt: new Date().toISOString(),
      severity: "info",
      body: `📨 Anfrage ${ref} an ${body.recipient.displayName} (${body.recipient.channel === "email" ? "E-Mail" : "SMS"}) gesendet – ${docLabel} für ${patient.name.given.join(" ")} ${patient.name.family}.`,
    });
    return { request: view, warnings, ...(this.juryMode ? { juryLink: `${window.location.origin}/r/mock-${ref.toLowerCase()}-demo-token` } : {}) };
  }

  async listRequests(): Promise<DocumentRequestView[]> {
    await delay();
    return [...this.records].map((r) => r.view).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async requestDetail(requestId: string): Promise<RequestDetailResponse> {
    await delay();
    const r = this.records.find((x) => x.view.id === requestId);
    if (!r) throw new ApiRequestError(404, "request-not-found", "Anfrage nicht gefunden.");
    return {
      request: r.view,
      audit: r.audit,
      summary: r.summary,
      ...(r.view.status === "held" && r.review ? { review: r.review } : {}),
      ...(r.view.status === "filed" && r.original ? { original: r.original } : {}),
    };
  }

  async release(requestId: string): Promise<HeldDecisionResponse> {
    return this.decide(requestId, "filed");
  }

  async reject(requestId: string): Promise<HeldDecisionResponse> {
    return this.decide(requestId, "rejected");
  }

  private async decide(requestId: string, status: "filed" | "rejected"): Promise<HeldDecisionResponse> {
    await delay();
    const r = this.records.find((x) => x.view.id === requestId);
    if (!r) throw new ApiRequestError(404, "request-not-found", "Anfrage nicht gefunden.");
    r.view = { ...r.view, status, heldReason: undefined };
    if (status === "filed" && r.review?.values) r.summary = summaryFromReview(r.review.values);
    if (status === "filed" && r.review) r.original = mockOriginal("DiagnosticReport/dr-held", "befund-fax.md", r.review.sourceText);
    return { request: r.view };
  }

  async chatMessages(roomId: string): Promise<ChatMessageView[]> {
    await delay();
    return this.chat.filter((m) => m.roomId === roomId);
  }
}

const MOCK_CRITICAL: Record<string, { low?: number; high?: number; rule: string }> = {
  "6301-6": { high: 2.5, rule: "> 2,5" },
  "777-3": { low: 50, rule: "< 50" },
};

function summaryFromReview(values: NonNullable<HeldReview["values"]>): FiledSummary {
  return {
    kind: "lab-result",
    values: values.map(({ evidence: _e, ...v }) => {
      const c = v.loinc ? MOCK_CRITICAL[v.loinc] : undefined;
      const critical = c && ((c.low !== undefined && v.value < c.low) || (c.high !== undefined && v.value > c.high)) ? { rule: c.rule } : undefined;
      const interpretation = v.low !== undefined && v.value < v.low ? "L" : v.high !== undefined && v.value > v.high ? "H" : "N";
      return { ...v, interpretation, ...(critical ? { critical } : {}) };
    }),
  };
}

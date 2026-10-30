// Test double for the RequestService (lane A-CORE builds the real one). Implements just enough
// behaviour for the portal pages: recipient name match, patient match, document type, expiry.
import type { DocumentRequest, IdentityCheckOutcome, VerifiedIdentity } from "@brieftaube/shared";
import type { AnswerInput, AnswerOutcome, AuthorizedRequestView, PublicRequestView, RequestService } from "../../ports.ts";

export interface FakeRequest {
  id: string;
  token: string;
  view: AuthorizedRequestView;
  recipient: { given: string; family: string };
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").trim();

export function makeFakeRequest(overrides: Partial<FakeRequest> = {}, view: Partial<AuthorizedRequestView> = {}): FakeRequest {
  return {
    id: "req-1",
    token: "tok-eva",
    recipient: { given: "Eva", family: "Brandl" },
    ...overrides,
    view: {
      reference: "BT-7K2Q",
      requesterDisplayName: "Dr. Lena Hofer",
      requesterOrganization: "Klinikum Beispielstadt",
      recipientDisplayName: "Dr. Eva Brandl",
      expiresAt: "2026-11-02T08:05:00.000Z",
      status: "open",
      patient: { name: { given: ["Maria"], family: "Beispiel" }, birthDate: "1961-03-12" },
      documentType: "lab-result",
      note: "Bitte Gerinnung vor dem Eingriff.",
      ...view,
    },
  };
}

export class FakeRequestService implements RequestService {
  readonly calls: { method: string; args: unknown[] }[] = [];
  readonly requests = new Map<string, FakeRequest>();
  /** Force an outcome for the next submitAnswer (e.g. "held"). */
  nextOutcome?: AnswerOutcome;

  constructor(...reqs: FakeRequest[]) {
    for (const r of reqs) this.requests.set(r.token, r);
  }

  private publicView(r: FakeRequest): PublicRequestView {
    const { patient: _p, documentType: _d, note: _n, ...pub } = r.view;
    return pub;
  }

  async openLink(token: string, ...rest: unknown[]) {
    this.calls.push({ method: "openLink", args: [token, ...rest] });
    const r = this.requests.get(token);
    return r ? { requestId: r.id, view: this.publicView(r) } : undefined;
  }

  async completeIdentityCheck(token: string, identity: VerifiedIdentity, ...rest: unknown[]): Promise<IdentityCheckOutcome & { view?: AuthorizedRequestView }> {
    this.calls.push({ method: "completeIdentityCheck", args: [token, identity, ...rest] });
    const r = this.requests.get(token);
    if (!r || r.view.status === "expired") return { ok: false, reason: "expired", identity };
    if (r.view.status === "answered") return { ok: false, reason: "already-answered", identity };
    if (identity.levelOfAssurance !== "high") return { ok: false, reason: "loa-too-low", identity };
    if (norm(identity.name.family) !== norm(r.recipient.family) || norm(identity.name.given[0] ?? "") !== norm(r.recipient.given)) {
      return { ok: false, reason: "name-mismatch", identity };
    }
    return { ok: true, identity, register: { checked: true, listed: true, registerName: "Ärzteliste (simuliert)" }, policy: "eid-high+register", view: r.view };
  }

  async submitAnswer(token: string, identity: VerifiedIdentity, answer: AnswerInput, ...rest: unknown[]): Promise<AnswerOutcome> {
    this.calls.push({ method: "submitAnswer", args: [token, identity, answer, ...rest] });
    const r = this.requests.get(token);
    if (!r) throw new Error("unknown token");
    if (this.nextOutcome) {
      const o = this.nextOutcome;
      this.nextOutcome = undefined;
      return o;
    }
    const p = r.view.patient;
    if (norm(answer.patientFamily) !== norm(p.name.family) || norm(answer.patientGiven.split(/\s+/)[0] ?? "") !== norm(p.name.given[0] ?? "") || answer.patientBirthDate !== p.birthDate) {
      return { result: "rejected", reason: "wrong-patient", messageForResponder: "Das Dokument betrifft eine andere Person. Bitte prüfen Sie Name und Geburtsdatum." };
    }
    if (!answer.content.trim().startsWith("#")) {
      return { result: "rejected", reason: "unreadable", messageForResponder: "Wir konnten das Dokument nicht lesen. Bitte im Standardformat senden." };
    }
    r.view = { ...r.view, status: "answered" };
    return { result: "filed", filedResources: ["DiagnosticReport/dr-1"] };
  }

  private unused = (m: string) => async (): Promise<never> => {
    throw new Error(`FakeRequestService.${m} is not used by the portal`);
  };
  checkRecipient = this.unused("checkRecipient");
  createRequest = this.unused("createRequest");
  listForRoom = this.unused("listForRoom");
  detail = this.unused("detail");
  release = this.unused("release") as unknown as RequestService["release"];
  reject = this.unused("reject") as unknown as RequestService["reject"];
}

export type { DocumentRequest };

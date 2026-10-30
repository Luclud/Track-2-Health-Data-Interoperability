// Server-rendered German pages of the portal. Every interpolated value is escaped by `html`.
import { DOCUMENT_TYPE_LABELS_DE, type IdentityCheckOutcome, type VerifiedIdentity } from "@brieftaube/shared";
import type { AnswerOutcome, AuthorizedRequestView, PublicRequestView } from "../ports.ts";
import type { AssistResult } from "./assist.ts";
import { html, page, type SafeHtml } from "./html.ts";

export interface AnswerForm {
  patientGiven?: string;
  patientFamily?: string;
  patientBirthDate?: string;
  content?: string;
  fileName?: string;
  fileContent?: string;
}
export type AnswerErrors = Partial<Record<"patientGiven" | "patientFamily" | "patientBirthDate" | "document" | "form", string>>;
type Step = 1 | 2 | 3;
type FailReason = Extract<IdentityCheckOutcome, { ok: false }>["reason"];

const dateTime = new Intl.DateTimeFormat("de-AT", { timeZone: "Europe/Vienna", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateTime.format(d);
}
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return y && m && d ? `${d}.${m}.${y}` : isoDate;
}

function steps(current?: Step) {
  if (!current) return "";
  const labels = ["Identität", "Dokument", "Gesendet"];
  return html`<ol class="steps" aria-label="Fortschritt">${labels.map((l, i) => {
    const n = (i + 1) as Step;
    const attrs = n === current ? html` aria-current="step"` : n < current ? html` class="done"` : "";
    return html`<li${attrs}>${n} ${l}${n < current ? html`<span class="visually-hidden"> (erledigt)</span>` : ""}</li>`;
  })}</ol>`;
}

const LOGO = html`<svg class="logo" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 7l9 6 9-6" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;

function layout(title: string, content: SafeHtml, opts: { view?: PublicRequestView; step?: Step } = {}): string {
  const v = opts.view;
  return page({
    title: `${title} – Brieftaube`,
    body: html`<header class="top"><div class="wrap">${LOGO}<span class="brand">Brieftaube · ${v?.requesterOrganization ?? "Sichere Anfrage"}</span>${v ? html`<span class="for">Sichere Anfrage für ${v.recipientDisplayName}</span>` : ""}</div></header>
<main>${steps(opts.step)}${content}
<footer>Brieftaube – sichere Übermittlung von Dokumenten an ${v?.requesterOrganization ?? "das Klinikum"}. Sie benötigen kein Konto und müssen nichts installieren.</footer></main>`,
  });
}

function requestCard(v: PublicRequestView) {
  return html`<div class="card"><dl>
<dt>Von</dt><dd>${v.requesterDisplayName} (${v.requesterOrganization})</dd>
<dt>An</dt><dd>${v.recipientDisplayName}</dd>
<dt>Referenz</dt><dd>${v.reference}</dd>
<dt>Gültig bis</dt><dd>${formatDateTime(v.expiresAt)}</dd>
</dl></div>`;
}

export function landingPage(v: PublicRequestView, loginHref: string): string {
  return layout(
    "Sichere Anfrage",
    html`<h1>${v.requesterDisplayName} hat Ihnen eine sichere Anfrage gesendet</h1>
${requestCard(v)}
<p>Bitte bestätigen Sie Ihre Identität. Erst danach sehen Sie, worum es geht.</p>
<a class="btn" href="${loginHref}">Mit e-ID anmelden (simuliert)</a>
<p class="hint">Sind Sie nicht ${v.recipientDisplayName}? Dann schließen Sie diese Seite bitte und leiten Sie den Link nicht weiter.</p>`,
    { view: v, step: 1 },
  );
}

export function unknownLinkPage(): string {
  return layout("Link ungültig", html`<h1>Dieser Link ist ungültig</h1><p class="notice err">Bitte prüfen Sie, ob Sie den Link vollständig geöffnet haben. Wenden Sie sich sonst an die Person, die Ihnen die Anfrage gesendet hat.</p><p>Haben Sie eine Erinnerung erhalten? Dann wurde dieser Link ersetzt – bitte verwenden Sie den Link aus der neuesten Nachricht.</p>`);
}

export function closedPage(v: PublicRequestView): string {
  const text =
    v.status === "expired"
      ? html`<h1>Diese Anfrage ist abgelaufen</h1><p class="notice warn">Der Link war bis ${formatDateTime(v.expiresAt)} gültig. Bitte wenden Sie sich an ${v.requesterDisplayName} (${v.requesterOrganization}), wenn Sie noch etwas senden möchten.</p>`
      : v.status === "answered"
        ? html`<h1>Diese Anfrage wurde bereits beantwortet</h1><p class="notice ok">Es ist nichts mehr zu tun. Vielen Dank!</p>`
        : html`<h1>Diese Anfrage wurde zurückgezogen</h1><p class="notice warn">${v.requesterDisplayName} benötigt nichts mehr von Ihnen.</p>`;
  return layout("Anfrage geschlossen", html`${text}<div class="card"><dl><dt>Referenz</dt><dd>${v.reference}</dd></dl></div>`, { view: v });
}

export function loginRetryPage(loginHref: string): string {
  return layout(
    "Anmeldung abgebrochen",
    html`<h1>Die Anmeldung hat nicht geklappt</h1><p class="notice warn">Die Anmeldung ist abgelaufen oder wurde in einem anderen Fenster gestartet. Bitte versuchen Sie es noch einmal.</p><a class="btn" href="${loginHref}">Erneut mit e-ID anmelden</a>`,
    { step: 1 },
  );
}

export function identityFailedPage(v: PublicRequestView, reason: FailReason, retryHref?: string): string {
  const body =
    reason === "expired"
      ? html`<h1>Diese Anfrage ist abgelaufen</h1><p class="notice warn">Bitte wenden Sie sich an ${v.requesterDisplayName}.</p>`
      : reason === "already-answered"
        ? html`<h1>Diese Anfrage wurde bereits beantwortet</h1><p class="notice ok">Es ist nichts mehr zu tun.</p>`
        : reason === "loa-too-low"
          ? html`<h1>Diese Anmeldung reicht nicht aus</h1><p class="notice err">Für diese Anfrage ist eine e-ID mit hohem Vertrauensniveau nötig. Die Anfrage wurde nicht angezeigt.</p>`
          : html`<h1>Identität nicht bestätigt</h1><p class="notice err" role="alert">Wir konnten nicht bestätigen, dass Sie ${v.recipientDisplayName} sind. Die Anfrage wurde nicht angezeigt. ${v.requesterDisplayName} wurde informiert.</p>
<p>Wenn Sie diese Nachricht irrtümlich bekommen haben, müssen Sie nichts weiter tun. Bitte leiten Sie den Link nicht weiter.</p>
${retryHref ? html`<a class="btn secondary" href="${retryHref}">Ich bin ${v.recipientDisplayName} – erneut anmelden</a>` : ""}`;
  return layout("Identität nicht bestätigt", body, { view: v, step: 1 });
}

const FIELD_TARGET: Record<keyof AnswerErrors, string> = { patientGiven: "patientGiven", patientFamily: "patientFamily", patientBirthDate: "patientBirthDate", document: "file", form: "file" };

function errorSummary(errors: AnswerErrors) {
  const entries = Object.entries(errors) as [keyof AnswerErrors, string][];
  return html`<div class="notice err" role="alert" id="fehler"><b>Bitte korrigieren Sie:</b><ul>${entries.map(([k, msg]) => html`<li><a href="#${FIELD_TARGET[k]}">${msg}</a></li>`)}</ul></div>`;
}

function fieldError(id: keyof AnswerErrors, errors: AnswerErrors) {
  return errors[id] ? html`<p class="field-error" id="${id}-error">${errors[id]}</p>` : "";
}
function invalid(id: keyof AnswerErrors, errors: AnswerErrors) {
  return errors[id] ? html` aria-invalid="true" aria-describedby="${id}-error"` : "";
}

/** JURY_MODE only: links that re-render the form with a demo document in the textarea. */
export interface DemoLinks { sample: string; wrongPatient: string }

function demoButtons(d: DemoLinks) {
  return html`<div class="demo" role="group" aria-label="Demo-Hilfen (nur Jury-Modus)"><p class="demo-label">Nur für die Vorführung (Demo):</p>
<a class="demo-btn" href="${d.sample}">Beispielbefund einsetzen (Demo)</a>
<a class="demo-btn" href="${d.wrongPatient}">Beispiel: falsche Patientin (Demo)</a></div>`;
}

/** SENDER_ASSIST only: opt-in checkbox; with `result` the ranked list of the sender's archive. */
export interface AssistPanel { on: string; off: string; result?: AssistResult; pickBase?: string; picked?: string; pickError?: boolean }

const IMPORTANCE_DE: Record<AssistResult["items"][number]["importance"], string> = { hoch: "Hoch", mittel: "Mittel", niedrig: "Niedrig", "nicht relevant": "Nicht relevant" };

function assistBlock(v: AuthorizedRequestView, a: AssistPanel) {
  const r = a.result;
  return html`
<div class="assist-opt"><label class="check"><input type="checkbox" id="assist-toggle"${r ? html` checked` : ""} data-on="${a.on}" data-off="${a.off}" onchange="location.href=this.checked?this.dataset.on:this.dataset.off"> KI-Hilfe: passende Dokumente aus meiner Ablage vorschlagen</label>
<p class="hint">Optional. Läuft im Echtbetrieb lokal in Ihrer Praxis – Dokumente verlassen die Praxis erst mit „Sicher senden“.</p>
<noscript><p><a href="${r ? a.off : a.on}">${r ? "KI-Hilfe ausblenden" : "KI-Hilfe öffnen"}</a></p></noscript></div>
${r ? assistList(v, a, r) : ""}`;
}

function assistList(v: AuthorizedRequestView, a: AssistPanel, r: AssistResult) {
  const hidden = r.hiddenOtherPatients;
  return html`<section id="assist" class="assist" aria-labelledby="assist-h">
<h3 id="assist-h">Vorschläge aus Ihrer Ablage</h3>
${r.source === "llm" ? html`<p class="badge llm">KI: ${r.model ?? "LLM"} (Demo über Cloud, nur synthetische Daten)</p>` : html`<p class="badge mock">KI-Vorschlag (Demo, MOCK)</p>`}
<p class="hint">Im Echtbetrieb läuft ein KI-Modell lokal in Ihrer Praxis (z. B. mit Ollama) und durchsucht nur Ihre eigene Ablage. In dieser Demo liegt eine synthetische Beispiel-Ablage auf unserem Server. Die KI wählt nur aus – senden müssen Sie selbst.</p>
<p class="sought"><b>Gesucht für:</b> ${v.note?.trim() || DOCUMENT_TYPE_LABELS_DE[v.documentType]}</p>
${a.picked ? html`<p class="notice ok" role="status">Vorschlag übernommen: ${a.picked}. Bitte prüfen Sie das Dokument und senden Sie es dann.</p>` : ""}
${a.pickError ? html`<p class="notice err" role="alert">Dieses Dokument wurde in Ihrer Ablage nicht gefunden. Es wurde nichts übernommen.</p>` : ""}
<ol class="assist-list">${r.items.map(
    (i) => html`<li class="assist-item imp-${i.importance.replace(" ", "-")}" data-id="${i.id}">
<p class="assist-head"><span class="imp">${IMPORTANCE_DE[i.importance]}</span> <b>${i.title}</b>${i.date ? html` <span class="date">${formatDate(i.date)}</span>` : ""}</p>
<p class="reason">${i.reason}</p>
${i.verified && i.evidence ? html`<p class="evidence">Beleg (Zeile ${i.evidence.line}): <q>${i.evidence.text}</q></p>` : html`<p class="evidence none">nicht belegt</p>`}
<a class="btn secondary assist-pick" href="${a.pickBase ?? ""}${encodeURIComponent(i.id)}#content">Übernehmen<span class="visually-hidden">: ${i.title}${i.date ? html` vom ${formatDate(i.date)}` : ""}</span></a></li>`,
  )}</ol>
${hidden > 0 ? html`<p class="hint">${hidden === 1 ? "1 Dokument einer anderen Person wurde" : `${hidden} Dokumente anderer Personen wurden`} ausgeblendet (Name oder Geburtsdatum passt nicht).</p>` : ""}
</section>`;
}

export function answerPage(v: AuthorizedRequestView, identity: VerifiedIdentity, values: AnswerForm, errors: AnswerErrors = {}, rejected?: Extract<AnswerOutcome, { result: "rejected" }>, demo?: DemoLinks, assist?: AssistPanel): string {
  const label = DOCUMENT_TYPE_LABELS_DE[v.documentType];
  const p = v.patient;
  const who = [...(identity.name.prefix ?? []), ...identity.name.given, identity.name.family].join(" ");
  const hasErrors = Object.keys(errors).length > 0;
  return layout(
    `${label} senden`,
    html`<p class="notice ok">Identität bestätigt: ${who}</p>
${rejected ? html`<div class="notice err" role="alert"><b>Das Dokument wurde nicht übernommen.</b><br>${rejected.messageForResponder}<br>Bitte prüfen Sie das Dokument und senden Sie es erneut.</div>` : ""}
${hasErrors ? errorSummary(errors) : ""}
<h1>${v.requesterDisplayName} bittet um: ${label}</h1>
<div class="card"><dl>
<dt>Patientin / Patient</dt><dd>${[...p.name.given, p.name.family].join(" ")}, geb. ${formatDate(p.birthDate)}</dd>
<dt>Dokument</dt><dd>${label}</dd>
${v.note ? html`<dt>Nachricht von ${v.requesterDisplayName}</dt><dd class="note">${v.note}</dd>` : ""}
<dt>Referenz</dt><dd>${v.reference}</dd>
</dl></div>
<form method="post" enctype="multipart/form-data" novalidate>
<h2>Zu welcher Person gehört das Dokument?</h2>
<p class="hint">Bitte so eintragen, wie es im Dokument steht. Alle Felder sind Pflichtangaben.</p>
<label for="patientGiven">Vorname(n)</label>
<input id="patientGiven" name="patientGiven" type="text" autocomplete="off" required value="${values.patientGiven ?? ""}"${invalid("patientGiven", errors)}>
${fieldError("patientGiven", errors)}
<label for="patientFamily">Nachname</label>
<input id="patientFamily" name="patientFamily" type="text" autocomplete="off" required value="${values.patientFamily ?? ""}"${invalid("patientFamily", errors)}>
${fieldError("patientFamily", errors)}
<label for="patientBirthDate">Geburtsdatum <span class="hint">z. B. 12.03.1961</span></label>
<input id="patientBirthDate" name="patientBirthDate" type="date" required value="${values.patientBirthDate ?? ""}"${invalid("patientBirthDate", errors)}>
${fieldError("patientBirthDate", errors)}
<h2>Dokument</h2>${assist ? assistBlock(v, assist) : ""}
<label for="file">Datei hochladen <span class="hint">.md oder .txt, höchstens 1 MB</span></label>
<input id="file" name="file" type="file" accept=".md,.txt,.markdown,text/markdown,text/plain"${invalid("document", errors)}>
<p class="or">oder</p>
<label for="content">Text einfügen <span class="hint">den ganzen Inhalt des Dokuments, unverändert</span></label>
<textarea id="content" name="content" rows="8"${invalid("document", errors)}>${values.content ?? ""}</textarea>
${fieldError("document", errors)}
${demo ? demoButtons(demo) : ""}
<button class="btn" type="submit">Sicher senden</button>
<p class="hint">Mit „Sicher senden“ geht das Dokument direkt an ${v.requesterDisplayName} (${v.requesterOrganization}).</p>
</form>`,
    { view: v, step: 2 },
  );
}

const DOC_EXT = /\.(md|markdown|txt)$/i;

export function validateAnswer(f: AnswerForm, today = new Date()): AnswerErrors {
  const e: AnswerErrors = {};
  if (!f.patientGiven?.trim()) e.patientGiven = "Bitte geben Sie den Vornamen ein.";
  if (!f.patientFamily?.trim()) e.patientFamily = "Bitte geben Sie den Nachnamen ein.";
  const bd = f.patientBirthDate?.trim() ?? "";
  if (!bd) e.patientBirthDate = "Bitte geben Sie das Geburtsdatum ein.";
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(bd) || Number.isNaN(Date.parse(`${bd}T00:00:00Z`)) || new Date(`${bd}T00:00:00Z`).toISOString().slice(0, 10) !== bd) e.patientBirthDate = "Bitte ein gültiges Datum eingeben.";
  else if (new Date(`${bd}T00:00:00Z`) > today) e.patientBirthDate = "Das Geburtsdatum liegt in der Zukunft.";
  const hasFile = f.fileContent !== undefined && f.fileContent.length > 0;
  const hasText = !!f.content?.trim();
  if (hasFile && f.fileName && !DOC_EXT.test(f.fileName)) e.document = "Bitte eine .md- oder .txt-Datei hochladen.";
  else if (hasFile && f.fileContent!.includes("\u0000")) e.document = "Die Datei ist keine Textdatei. Bitte .md oder .txt verwenden.";
  else if (!hasFile && !hasText) e.document = "Bitte laden Sie eine Datei hoch oder fügen Sie den Text ein.";
  return e;
}

/** Receipt for the sender (V2-RCPT-1). No medical content: no patient, no document type, no values. */
export interface Receipt {
  reference: string;
  receivedAt: string; // ISO 8601
  senderName: string; // verified e-ID name
  sha256: string; // hex, of the received document text
}

function receiptBox(r: Receipt) {
  return html`<section class="receipt" aria-labelledby="receipt-title">
<h2 id="receipt-title">Eingangsbestätigung</h2>
<dl>
<dt>Referenz</dt><dd>${r.reference}</dd>
<dt>Eingegangen am</dt><dd>${formatDateTime(r.receivedAt)} Uhr</dd>
<dt>Absender</dt><dd>${r.senderName} <span class="hint">(mit e-ID bestätigt)</span></dd>
<dt>Prüfsumme (SHA-256)</dt><dd><code>${r.sha256.slice(0, 16)}</code>
<details><summary>Vollständige Prüfsumme</summary><code class="hash">${r.sha256}</code></details></dd>
</dl>
<p class="hint">Mit der Prüfsumme lässt sich später zeigen, dass genau dieses Dokument übermittelt wurde.</p>
<button class="btn secondary no-print" type="button" onclick="window.print()">Bestätigung drucken / als PDF speichern</button>
</section>`;
}

export function resultPage(v: AuthorizedRequestView, outcome: Exclude<AnswerOutcome, { result: "rejected" }>, receipt?: Receipt): string {
  const label = DOCUMENT_TYPE_LABELS_DE[v.documentType];
  const body =
    outcome.result === "filed"
      ? html`<h1>Vielen Dank – gesendet!</h1><p class="notice ok" role="status">Ihr ${label} wurde sicher an ${v.requesterDisplayName} übermittelt und abgelegt.</p>`
      : html`<h1>Vielen Dank – gesendet!</h1><p class="notice" role="status">Ihr ${label} ist bei ${v.requesterDisplayName} angekommen. Er wird noch kurz geprüft, bevor er abgelegt wird. Sie müssen nichts weiter tun.</p>`;
  const tail = receipt ? receiptBox(receipt) : html`<div class="card"><dl><dt>Referenz</dt><dd>${v.reference}</dd></dl></div>`;
  return layout("Gesendet", html`${body}${tail}<p>Sie können dieses Fenster jetzt schließen.</p>`, { view: v, step: 3 });
}

export function errorPage(): string {
  return layout("Fehler", html`<h1>Etwas ist schiefgelaufen</h1><p class="notice err">Bitte versuchen Sie es in ein paar Minuten noch einmal. Ihre Angaben wurden nicht übermittelt.</p>`);
}

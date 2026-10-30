import { useState } from "react";
import { formatValueDe, labNameDe, unitDisplay, type AuditEntry, type DocumentRequestView, type FiledOriginal, type FiledSummary, type RequestDetailResponse } from "@brieftaube/shared";
import type { Api } from "../api/client.ts";
import { CHANNEL_DE, DOC_TYPE_DE, HELD_DE, PROBLEM_DE, STATUS_DE, STEP_DE } from "../labels.ts";
import { formatDate, formatDateTime, formatTime } from "../format.ts";
import { usePolling } from "./usePolling.ts";
import { expiryText, groupRequests } from "./board.ts";
import { HeldReviewPanel } from "./HeldReview.tsx";
import { formatRange } from "./values.ts";

interface Props {
  api: Api;
  roomId: string;
  /** Bumped by the parent after a new request is created, to refresh at once. */
  refreshKey?: unknown;
}

export function StatusChip({ r }: { r: Pick<DocumentRequestView, "status" | "lastProblem"> }) {
  const s = STATUS_DE[r.status];
  const tone = r.lastProblem && r.status !== "filed" ? "alert" : s.tone;
  return <span className={`chip ${tone}`}>{s.label}</span>;
}

export function RequestsPanel({ api, roomId, refreshKey }: Props) {
  const [selected, setSelected] = useState<string | undefined>();
  const list = usePolling(() => api.listRequests(roomId), [api, roomId, refreshKey]);

  if (selected) return <RequestDetail api={api} id={selected} onBack={() => setSelected(undefined)} />;

  const requests = list.data ?? [];
  const groups = groupRequests(requests);
  return (
    <section className="card">
      <h2>Anfragen</h2>
      {list.error && <div className="banner alert">Anfragen konnten nicht geladen werden: {list.error}</div>}
      {!list.data && !list.error && <p className="muted">Laden …</p>}
      {list.data && requests.length === 0 && <p className="muted">Noch keine Anfragen in diesem Raum.</p>}
      {requests.length > 0 && (
        <nav className="board-counts" aria-label="Übersicht">
          {groups.map((g) => (
            <a key={g.id} href={`#group-${g.id}`} className={`board-count g-${g.id} ${g.items.length === 0 ? "zero" : ""}`}>
              <b>{g.items.length}</b> {g.label}
            </a>
          ))}
        </nav>
      )}
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <section key={g.id} id={`group-${g.id}`} className={`board-group g-${g.id}`} aria-label={g.label}>
            <h3>
              {g.label} <span className="count">{g.items.length}</span>
            </h3>
            <ul className="req-list">
              {g.items.map((r) => (
                <li key={r.id} className={r.lastProblem && r.status !== "filed" ? "problem" : ""}>
                  <button type="button" onClick={() => setSelected(r.id)}>
                    <div className="req-head">
                      <b>{r.reference}</b>
                      <StatusChip r={r} />
                    </div>
                    <div>
                      {DOC_TYPE_DE[r.documentType]} · {r.patient.name.family}, {r.patient.name.given.join(" ")}
                    </div>
                    <div className="muted small">
                      an {r.recipient.displayName} ({CHANNEL_DE[r.recipient.channel]}) · {formatDateTime(r.createdAt)}
                    </div>
                    {g.id === "waiting" && (
                      <div className="small waiting-line">
                        ⏳ {expiryText(r)}
                        {r.reminderSentAt && (
                          <span className="reminder" title={`Erinnerung gesendet ${formatDateTime(r.reminderSentAt)}`}>
                            {" "}
                            · 🔔 Erinnerung gesendet
                          </span>
                        )}
                      </div>
                    )}
                    {r.lastProblem && r.status !== "filed" && <div className="problem-text">🛑 {PROBLEM_DE[r.lastProblem]}</div>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </section>
  );
}

function RequestDetail({ api, id, onBack }: { api: Api; id: string; onBack: () => void }) {
  const detail = usePolling(() => api.requestDetail(id), [api, id]);
  const [busy, setBusy] = useState(false);

  async function decide(kind: "release" | "reject") {
    setBusy(true);
    try {
      await (kind === "release" ? api.release(id) : api.reject(id));
      detail.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <button type="button" className="link back" onClick={onBack}>
        ← Alle Anfragen
      </button>
      {detail.error && <div className="banner alert">Details konnten nicht geladen werden: {detail.error}</div>}
      {!detail.data && !detail.error && <p className="muted">Laden …</p>}
      {detail.data && <DetailBody d={detail.data} busy={busy} onDecide={decide} />}
    </section>
  );
}

function DetailBody({ d, busy, onDecide }: { d: RequestDetailResponse; busy: boolean; onDecide: (k: "release" | "reject") => void }) {
  const r = d.request;
  return (
    <>
      <div className="req-head">
        <h2>
          {r.reference} · {DOC_TYPE_DE[r.documentType]}
        </h2>
        <StatusChip r={r} />
      </div>
      <dl className="facts">
        <dt>Patient:in</dt>
        <dd>
          {r.patient.name.family}, {r.patient.name.given.join(" ")} <span className="muted">· geb. {formatDate(r.patient.birthDate)}</span>
        </dd>
        <dt>Empfänger:in</dt>
        <dd>
          {r.recipient.displayName}
          {r.recipient.organization && <span className="muted"> · {r.recipient.organization}</span>}
          <div className="muted small">
            {CHANNEL_DE[r.recipient.channel]}: {r.recipient.address}
          </div>
        </dd>
      </dl>

      {r.lastProblem && r.status !== "filed" && (
        <div className="banner alert" role="alert">
          🛑 {PROBLEM_DE[r.lastProblem]}
        </div>
      )}

      {r.status === "held" && (
        <div className="banner warning">
          <div>
            <b>Antwort wartet auf Ihre Freigabe.</b>
            {r.heldReason && <> {HELD_DE[r.heldReason]}.</>}
          </div>
          <div className="actions">
            <button type="button" className="secondary" disabled={busy} onClick={() => onDecide("reject")}>
              Ablehnen
            </button>
            <button type="button" className="primary" disabled={busy} onClick={() => onDecide("release")}>
              Freigeben und ablegen
            </button>
          </div>
        </div>
      )}

      {r.status === "held" && d.review && <HeldReviewPanel review={d.review} />}

      {d.summary && <Summary s={d.summary} />}

      {d.original && <Original o={d.original} filed={r.filedResources} />}

      <h3>Verlauf</h3>
      <Timeline audit={d.audit} />
    </>
  );
}

function Summary({ s }: { s: FiledSummary }) {
  if (s.kind === "lab-result") {
    return (
      <>
        <h3>Abgelegte Werte</h3>
        <div className="table-scroll">
          <table className="lab">
            <thead>
              <tr>
                <th>Wert</th>
                <th className="num">Ergebnis</th>
                <th className="num">Referenz</th>
              </tr>
            </thead>
            <tbody>
              {s.values.map((v) => (
                <tr key={v.testName} className={v.critical ? "critical" : v.interpretation !== "N" ? "flag" : ""} title={v.critical ? `Kritischer Wert (Grenze ${v.critical.rule})` : undefined}>
                  <td>
                    {v.critical && (
                      <span className="crit-icon" aria-label="Kritischer Wert">
                        🚨{" "}
                      </span>
                    )}
                    {labNameDe(v.loinc, v.testName)}
                    {v.critical && <div className="crit-rule">Kritisch: {v.critical.rule}</div>}
                  </td>
                  <td className="num">
                    <b>{formatValueDe(v.value, v.low, v.high)}</b> {unitDisplay(v.unit)}
                    {v.interpretation !== "N" && <span className={`flag-badge ${v.interpretation}`}>{v.interpretation === "H" ? "↑ H" : "↓ L"}</span>}
                  </td>
                  <td className="num muted">{formatRange(v.low, v.high, v.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {s.conclusion && <p className="small">{s.conclusion}</p>}
      </>
    );
  }
  return (
    <>
      <h3>{s.title}</h3>
      {s.stay && (
        <p className="muted small">
          Aufenthalt {formatDate(s.stay.start)} – {formatDate(s.stay.end)}
        </p>
      )}
      <blockquote className="excerpt">{s.excerpt}</blockquote>
    </>
  );
}

/** "DiagnosticReport · 4 × Observation · Provenance" */
function fhirLine(refs: string[]): string {
  const counts = new Map<string, number>();
  for (const ref of refs) {
    const type = ref.split("/")[0] ?? ref;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts].map(([type, n]) => (n > 1 ? `${n} × ${type}` : type)).join(" · ");
}

function Original({ o, filed }: { o: FiledOriginal; filed: string[] }) {
  const lines = o.text.split(/\r?\n/);
  const name = o.fileName ?? "dokument.md";
  return (
    <>
      <h3>Originaldokument</h3>
      <details className="original">
        <summary>
          📄 <b>{name}</b> <span className="muted small">· wie empfangen · SHA-256 {o.sha256.slice(0, 12)}…</span>
        </summary>
        <ol className="source">
          {lines.map((text, i) => (
            <li key={i}>
              <span className="ln" aria-hidden>
                {i + 1}
              </span>
              <code>{text || " "}</code>
            </li>
          ))}
        </ol>
        <div className="original-foot">
          <span className="muted small">Abgelegt in FHIR: {fhirLine(filed)} · Original in {o.storedIn.split("/")[0]}</span>
          <a className="link" download={name} href={`data:${o.contentType};charset=utf-8,${encodeURIComponent(o.text)}`}>
            Original herunterladen
          </a>
        </div>
      </details>
    </>
  );
}

function Timeline({ audit }: { audit: AuditEntry[] }) {
  if (audit.length === 0) return <p className="muted">Noch keine Einträge.</p>;
  return (
    <ol className="timeline">
      {audit.map((a) => {
        const misdelivery = typeof a.details?.misdelivery === "string" ? (a.details.misdelivery as keyof typeof PROBLEM_DE) : undefined;
        return (
          <li key={a.id} className={`outcome-${a.outcome}`} title={a.what}>
            <span className="icon" aria-hidden>
              {a.outcome === "failure" && a.step !== "misdelivery-caught" ? "⚠️" : STEP_DE[a.step].icon}
            </span>
            <div>
              <div>
                <b>{STEP_DE[a.step].label}</b>
                {a.outcome === "failure" && a.step !== "misdelivery-caught" && <span className="chip alert">fehlgeschlagen</span>}
              </div>
              <div className="muted small">
                {formatTime(a.at)} · {a.actor.kind === "unverified-visitor" ? "noch nicht identifiziert" : a.actor.display}
              </div>
              {misdelivery && PROBLEM_DE[misdelivery] && <div className="problem-text">{PROBLEM_DE[misdelivery]}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

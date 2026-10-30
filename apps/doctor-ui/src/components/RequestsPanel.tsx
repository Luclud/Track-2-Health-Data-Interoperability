import { useState } from "react";
import type { AuditEntry, DocumentRequestView, FiledSummary, RequestDetailResponse } from "@brieftaube/shared";
import type { Api } from "../api/client.ts";
import { CHANNEL_DE, DOC_TYPE_DE, HELD_DE, PROBLEM_DE, STATUS_DE, STEP_DE } from "../labels.ts";
import { formatDate, formatDateTime, formatTime } from "../format.ts";
import { usePolling } from "./usePolling.ts";

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
  return (
    <section className="card">
      <h2>Anfragen</h2>
      {list.error && <div className="banner alert">Anfragen konnten nicht geladen werden: {list.error}</div>}
      {!list.data && !list.error && <p className="muted">Laden …</p>}
      {list.data && requests.length === 0 && <p className="muted">Noch keine Anfragen in diesem Raum.</p>}
      <ul className="req-list">
        {requests.map((r) => (
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
              {r.lastProblem && r.status !== "filed" && <div className="problem-text">🛑 {PROBLEM_DE[r.lastProblem]}</div>}
            </button>
          </li>
        ))}
      </ul>
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

      {d.summary && <Summary s={d.summary} />}

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
              <tr key={v.testName} className={v.interpretation !== "N" ? "flag" : ""}>
                <td>{v.testName}</td>
                <td className="num">
                  <b>{v.value.toLocaleString("de-AT")}</b> {v.unit}
                  {v.interpretation !== "N" && <span className={`flag-badge ${v.interpretation}`}>{v.interpretation === "H" ? "↑ H" : "↓ L"}</span>}
                </td>
                <td className="num muted">{range(v.low, v.high)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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

function range(low?: number, high?: number): string {
  const f = (n: number) => n.toLocaleString("de-AT");
  if (low !== undefined && high !== undefined) return `${f(low)}–${f(high)}`;
  if (high !== undefined) return `< ${f(high)}`;
  if (low !== undefined) return `> ${f(low)}`;
  return "";
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
                {formatTime(a.at)} · {a.actor.display}
              </div>
              {misdelivery && PROBLEM_DE[misdelivery] && <div className="problem-text">{PROBLEM_DE[misdelivery]}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

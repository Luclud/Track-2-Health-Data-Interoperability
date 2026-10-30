import { useEffect, useMemo, useState } from "react";
import type { Channel, DocumentRequestView, DocumentType, PatientSnapshot, RecipientWarning } from "@brieftaube/shared";
import type { Api } from "../api/client.ts";
import { ApiRequestError } from "../api/client.ts";
import { CHANNEL_DE, DOC_TYPE_DE } from "../labels.ts";
import { formatDate } from "../format.ts";

interface Props {
  api: Api;
  roomId: string;
  onCreated: (r: DocumentRequestView) => void;
}

interface RecipientForm {
  displayName: string;
  role: string;
  organization: string;
  isPhysician: boolean;
  channel: Channel;
  address: string;
}

const EMPTY_RECIPIENT: RecipientForm = { displayName: "", role: "", organization: "", isPhysician: true, channel: "email", address: "" };

export function NewRequestForm({ api, roomId, onCreated }: Props) {
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<PatientSnapshot[]>([]);
  const [patient, setPatient] = useState<PatientSnapshot | undefined>();
  const [documentType, setDocumentType] = useState<DocumentType>("lab-result");
  const [note, setNote] = useState("");
  const [rcp, setRcp] = useState<RecipientForm>(EMPTY_RECIPIENT);
  const [warnings, setWarnings] = useState<RecipientWarning[]>([]);
  const [checkedKey, setCheckedKey] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [sent, setSent] = useState<DocumentRequestView | undefined>();

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      api.patients(query).then((p) => !cancelled && setPatients(p)).catch((e: unknown) => !cancelled && setError(String((e as Error).message)));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [api, query]);

  const recipientKey = `${rcp.channel}|${rcp.address}|${rcp.displayName}`;
  const warningsStale = checkedKey !== recipientKey;

  async function runCheck(): Promise<RecipientWarning[]> {
    if (!rcp.address.trim()) {
      setWarnings([]);
      return [];
    }
    const res = await api.recipientCheck({ channel: rcp.channel, address: rcp.address.trim(), displayName: rcp.displayName.trim() });
    setWarnings(res.warnings);
    setCheckedKey(recipientKey);
    return res.warnings;
  }

  function update<K extends keyof RecipientForm>(key: K, value: RecipientForm[K]) {
    setRcp((r) => ({ ...r, [key]: value }));
    setConfirming(false);
  }

  const missing = useMemo(() => {
    const m: string[] = [];
    if (!patient) m.push("Patient:in");
    if (!rcp.displayName.trim()) m.push("Name der Empfänger:in");
    if (!rcp.organization.trim()) m.push("Einrichtung");
    if (!rcp.address.trim()) m.push(rcp.channel === "email" ? "E-Mail-Adresse" : "Mobilnummer");
    return m;
  }, [patient, rcp]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (missing.length > 0 || !patient) {
      setError(`Bitte ausfüllen: ${missing.join(", ")}.`);
      return;
    }
    setBusy(true);
    try {
      const current = warningsStale ? await runCheck() : warnings;
      if (current.length > 0 && !confirming) {
        setConfirming(true);
        return;
      }
      const res = await api.createRequest({
        patientId: patient.fhirId,
        documentType,
        note: note.trim() || undefined,
        roomId,
        recipient: { ...rcp, displayName: rcp.displayName.trim(), address: rcp.address.trim(), role: rcp.role.trim(), organization: rcp.organization.trim() },
        acknowledgeWarnings: current.length > 0,
      });
      setSent(res.request);
      onCreated(res.request);
      setRcp(EMPTY_RECIPIENT);
      setNote("");
      setWarnings([]);
      setConfirming(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : `Senden fehlgeschlagen: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" onSubmit={submit} noValidate>
      <h2>Dokument anfordern</h2>

      {sent && (
        <div className="banner success" role="status">
          Anfrage <b>{sent.reference}</b> an {sent.recipient.displayName} gesendet. Den Status sehen Sie unter „Anfragen“.
        </div>
      )}

      <fieldset>
        <legend>Patient:in</legend>
        {patient ? (
          <div className="selected-patient">
            <div>
              <b>{patient.name.family}, {patient.name.given.join(" ")}</b>
              <span className="muted"> · geb. {formatDate(patient.birthDate)}</span>
            </div>
            <button type="button" className="link" onClick={() => setPatient(undefined)}>
              ändern
            </button>
          </div>
        ) : (
          <>
            <label className="sr-only" htmlFor="patient-search">Patient:in suchen</label>
            <input id="patient-search" type="search" placeholder="Name suchen …" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
            <ul className="picker" role="listbox" aria-label="Patient:innen">
              {patients.map((p) => (
                <li key={p.fhirId}>
                  <button type="button" role="option" aria-selected={false} onClick={() => setPatient(p)}>
                    <b>{p.name.family}, {p.name.given.join(" ")}</b>
                    <span className="muted">geb. {formatDate(p.birthDate)}</span>
                  </button>
                </li>
              ))}
              {patients.length === 0 && <li className="muted empty">Keine Treffer</li>}
            </ul>
          </>
        )}
      </fieldset>

      <fieldset>
        <legend>Dokument</legend>
        <div className="segmented" role="radiogroup" aria-label="Dokumentart">
          {(Object.keys(DOC_TYPE_DE) as DocumentType[]).map((t) => (
            <label key={t} className={documentType === t ? "on" : ""}>
              <input type="radio" name="documentType" value={t} checked={documentType === t} onChange={() => setDocumentType(t)} />
              {DOC_TYPE_DE[t]}
            </label>
          ))}
        </div>
        <label htmlFor="note">Notiz <span className="muted">(optional)</span></label>
        <textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="z. B. Gerinnung vor OP am 28.10." />
        <p className="hint">Die Notiz sieht die Empfänger:in erst nach erfolgreicher Identitätsprüfung – nie in E-Mail oder SMS.</p>
      </fieldset>

      <fieldset>
        <legend>Empfänger:in</legend>
        <label htmlFor="rcp-name">Name</label>
        <input id="rcp-name" value={rcp.displayName} onChange={(e) => update("displayName", e.target.value)} onBlur={() => void runCheck().catch(() => undefined)} placeholder="Dr. Eva Brandl" />
        <div className="row">
          <div>
            <label htmlFor="rcp-role">Funktion</label>
            <input id="rcp-role" value={rcp.role} onChange={(e) => update("role", e.target.value)} placeholder="Laborärztin" />
          </div>
          <div>
            <label htmlFor="rcp-org">Einrichtung</label>
            <input id="rcp-org" value={rcp.organization} onChange={(e) => update("organization", e.target.value)} placeholder="Labor Kanalstraße" />
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={rcp.isPhysician} onChange={(e) => update("isPhysician", e.target.checked)} />
          Ist Ärztin / Arzt <span className="muted">(Abgleich mit der Ärzteliste)</span>
        </label>
        <div className="segmented" role="radiogroup" aria-label="Kanal">
          {(Object.keys(CHANNEL_DE) as Channel[]).map((c) => (
            <label key={c} className={rcp.channel === c ? "on" : ""}>
              <input type="radio" name="channel" value={c} checked={rcp.channel === c} onChange={() => update("channel", c)} />
              {CHANNEL_DE[c]}
            </label>
          ))}
        </div>
        <label htmlFor="rcp-address">{rcp.channel === "email" ? "E-Mail-Adresse" : "Mobilnummer"}</label>
        <input
          id="rcp-address"
          type={rcp.channel === "email" ? "email" : "tel"}
          inputMode={rcp.channel === "email" ? "email" : "tel"}
          value={rcp.address}
          onChange={(e) => update("address", e.target.value)}
          onBlur={() => void runCheck().catch(() => undefined)}
          placeholder={rcp.channel === "email" ? "eva.brandl@labor-kanal.example" : "+43 660 1234567"}
          spellCheck={false}
          autoCapitalize="off"
          className={!warningsStale && warnings.length > 0 ? "warn" : ""}
        />
        {!warningsStale && warnings.length > 0 && (
          <ul className="warnings" aria-live="polite">
            {warnings.map((w) => (
              <li key={w.code}>⚠️ {w.message}</li>
            ))}
          </ul>
        )}
        <p className="hint">E-Mail / SMS enthalten nur einen Link – keine Patientendaten, keine Dokumentart.</p>
      </fieldset>

      {error && <div className="banner alert" role="alert">{error}</div>}

      <div className="actions">
        {confirming ? (
          <>
            <button type="button" className="secondary" onClick={() => setConfirming(false)} disabled={busy}>
              Adresse korrigieren
            </button>
            <button type="submit" className="danger" disabled={busy}>
              {busy ? "Senden …" : "Trotzdem senden"}
            </button>
          </>
        ) : (
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Senden …" : "Anfrage senden"}
          </button>
        )}
      </div>
      {confirming && <p className="hint warn-text">Es gibt Warnungen zur Adresse. Bitte prüfen Sie sie, bevor Sie trotzdem senden.</p>}
    </form>
  );
}


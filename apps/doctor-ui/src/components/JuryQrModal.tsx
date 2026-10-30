import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

interface Props {
  link: string;
  reference: string;
  recipientName: string;
  onClose: () => void;
}

/** Jury mode only: shows the recipient's link as a QR code so a judge can open it on their own phone. */
export function JuryQrModal({ link, reference, recipientName, onClose }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [qrError, setQrError] = useState(false);

  useEffect(() => {
    if (!canvas.current) return;
    QRCode.toCanvas(canvas.current, link, { width: 260, margin: 2, errorCorrectionLevel: "M" }).catch(() => setQrError(true));
  }, [link]);

  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal jury-qr" role="dialog" aria-modal="true" aria-labelledby="jury-qr-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 id="jury-qr-title">Link für {recipientName}</h2>
          <span className="chip warning">Jury-Modus</span>
        </div>
        <p className="muted small">Anfrage {reference} · mit der Handykamera scannen</p>
        <div className="qr-box">{qrError ? <p className="banner alert">QR-Code konnte nicht erstellt werden.</p> : <canvas ref={canvas} aria-label="QR-Code mit dem Link" />}</div>
        <p className="qr-link">
          <a href={link} target="_blank" rel="noreferrer">{link}</a>
        </p>
        <p className="banner warning small">Nur Jury-Modus: Im echten Betrieb geht dieser Link ausschließlich per E-Mail/SMS an die Empfängerin.</p>
        <div className="actions">
          <button ref={closeBtn} type="button" className="primary" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}

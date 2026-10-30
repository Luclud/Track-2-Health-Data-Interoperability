import { useEffect, useRef, useState } from "react";
import { formatValueDe, labNameDe, unitDisplay, type HeldReason, type HeldReview } from "@brieftaube/shared";
import { formatDate } from "../format.ts";
import { formatRange } from "./values.ts";

export const HELD_BADGE_DE: Record<HeldReason, string> = {
  "ai-extracted": "KI-gelesen – bitte prüfen",
  "not-in-register": "Nicht in der Ärzteliste – bitte prüfen",
  unreadable: "Nicht sicher lesbar – bitte prüfen",
};

/** Held answer: what was read (left) next to the received document with line numbers (right). */
export function HeldReviewPanel({ review }: { review: HeldReview }) {
  const [active, setActive] = useState<number | undefined>();
  const lineRefs = useRef<(HTMLLIElement | null)[]>([]);
  const lines = review.sourceText.split(/\r?\n/);
  const evidenceLines = new Set([review.patient.evidence?.line, ...(review.values ?? []).map((v) => v.evidence.line)].filter((n): n is number => n !== undefined));

  useEffect(() => {
    if (active === undefined) return;
    lineRefs.current[active - 1]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active]);

  const pick = (line: number | undefined) => line !== undefined && setActive(line);
  const rowProps = (line: number | undefined) =>
    line === undefined
      ? {}
      : {
          tabIndex: 0,
          role: "button",
          "aria-pressed": active === line,
          title: `Zeile ${line} im Original zeigen`,
          onClick: () => pick(line),
          onKeyDown: (e: React.KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick(line)),
        };

  const p = review.patient;
  return (
    <div className="review">
      <div className="review-head">
        <span className="chip warning review-badge">{HELD_BADGE_DE[review.reason]}</span>
        {review.method === "llm" && review.reason !== "ai-extracted" && <span className="chip info">KI-gelesen</span>}
        <span className="muted small">Wert antippen → Fundstelle im Original</span>
      </div>
      <div className="review-panes">
        <section className="review-pane" aria-label="Gelesene Werte">
          <h3>Gelesen</h3>
          <table className="lab review-values">
            <tbody>
              <tr className={`pick ${active !== undefined && active === p.evidence?.line ? "active" : ""}`} {...rowProps(p.evidence?.line)}>
                <td>Patient:in</td>
                <td className="num" colSpan={2}>
                  <b>
                    {p.family}, {p.given.join(" ")}
                  </b>
                  {p.birthDate && <span className="muted"> · geb. {formatDate(p.birthDate)}</span>}
                </td>
              </tr>
            </tbody>
          </table>
          {review.values && review.values.length > 0 && (
            <div className="table-scroll">
              <table className="lab review-values">
                <thead>
                  <tr>
                    <th>Wert</th>
                    <th className="num">Ergebnis</th>
                    <th className="num">Referenz</th>
                  </tr>
                </thead>
                <tbody>
                  {review.values.map((v, i) => {
                    const out = (v.low !== undefined && v.value < v.low) || (v.high !== undefined && v.value > v.high);
                    return (
                      <tr key={`${v.testName}-${i}`} className={`pick ${out ? "flag" : ""} ${active === v.evidence.line ? "active" : ""}`} {...rowProps(v.evidence.line)}>
                        <td>
                          {labNameDe(v.loinc, v.testName)}
                          <div className="muted small">Zeile {v.evidence.line}</div>
                        </td>
                        <td className="num">
                          <b>{formatValueDe(v.value, v.low, v.high)}</b> {unitDisplay(v.unit)}
                        </td>
                        <td className="num muted">{formatRange(v.low, v.high, v.value)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {review.excerpt && <blockquote className="excerpt">{review.excerpt}</blockquote>}
        </section>
        <section className="review-pane" aria-label="Originaldokument">
          <h3>Original</h3>
          <ol className="source">
            {lines.map((text, i) => {
              const n = i + 1;
              return (
                <li key={n} ref={(el) => (lineRefs.current[i] = el)} className={`${evidenceLines.has(n) ? "ev" : ""} ${active === n ? "active" : ""}`}>
                  <span className="ln" aria-hidden>
                    {n}
                  </span>
                  <code>{text || " "}</code>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </div>
  );
}

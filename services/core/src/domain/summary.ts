// Filed summary for GET /api/requests/:id (lab values table / rehab excerpt), read back from the FHIR store.
import type { DocumentRequest, FiledSummary } from "@brieftaube/shared";
import type { DiagnosticReport, DocumentReference, Observation } from "fhir/r4.js";
import { SYSTEMS } from "@brieftaube/shared";
import type { FhirStore } from "../ports.ts";
import { type CriticalLimits, criticalFor } from "./critical.ts";

const EXCERPT_MAX = 300;

function idOf(refs: string[], type: string): string | undefined {
  return refs.find((r) => r.startsWith(`${type}/`))?.slice(type.length + 1);
}

export function rehabExcerpt(markdown: string): string {
  const section = /^##[^\n]*\n([\s\S]*?)(?=^##|$(?![\s\S]))/m.exec(markdown)?.[1] ?? markdown;
  const text = section.replace(/\s+/g, " ").trim();
  return text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX - 1).trimEnd()}…` : text;
}

export async function filedSummary(fhir: FhirStore, r: DocumentRequest, limits: CriticalLimits = {}): Promise<FiledSummary | undefined> {
  if (r.status !== "filed") return undefined;
  if (r.documentType === "lab-result") {
    const reportId = idOf(r.filedResources, "DiagnosticReport");
    const report = reportId ? await fhir.read<DiagnosticReport>("DiagnosticReport", reportId) : undefined;
    const obsIds = r.filedResources.filter((x) => x.startsWith("Observation/")).map((x) => x.slice("Observation/".length));
    const observations = await Promise.all(obsIds.map((id) => fhir.read<Observation>("Observation", id)));
    const values = observations.flatMap((o) => {
      const q = o?.valueQuantity;
      if (!o || q?.value === undefined) return [];
      const range = o.referenceRange?.[0];
      const code = o.interpretation?.[0]?.coding?.[0]?.code;
      const v: Extract<FiledSummary, { kind: "lab-result" }>["values"][number] = {
        testName: o.code.text ?? o.code.coding?.[0]?.code ?? "",
        value: q.value,
        // UCUM annotations like "{INR}" are codes, not units a doctor reads.
        unit: /^\{.*\}$/.test(q.unit ?? "") ? "" : (q.unit ?? ""),
        interpretation: code === "H" || code === "L" ? code : "N",
      };
      const loinc = o.code.coding?.find((c) => c.system === SYSTEMS.loinc)?.code;
      if (loinc) v.loinc = loinc;
      const critical = criticalFor(limits, loinc, q.value, q.code);
      if (critical) v.critical = critical;
      if (range?.low?.value !== undefined) v.low = range.low.value;
      if (range?.high?.value !== undefined) v.high = range.high.value;
      return [v];
    });
    if (!values.length) return undefined;
    const s: FiledSummary = { kind: "lab-result", values };
    if (report?.conclusion) s.conclusion = report.conclusion;
    return s;
  }
  const docId = idOf(r.filedResources, "DocumentReference");
  const ref = docId ? await fhir.read<DocumentReference>("DocumentReference", docId) : undefined;
  if (!ref) return undefined;
  const data = ref.content[0]?.attachment.data;
  const s: FiledSummary = {
    kind: "rehab-discharge-report",
    title: ref.description ?? "Entlassungsbericht",
    excerpt: data ? rehabExcerpt(Buffer.from(data, "base64").toString("utf8")) : "",
  };
  const p = ref.context?.period;
  if (p?.start && p.end) s.stay = { start: p.start, end: p.end };
  return s;
}

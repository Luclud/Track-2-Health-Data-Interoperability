// TEST-5: the four challenge metrics from REAL runs, printed and written to docs/METRICS.md.
//   npm run e2e && npm run e2e:ui && npm run metrics
// Inputs (each one is optional; a missing input shows up as "not measured", never as a pass):
//   out/e2e-results.json        TEST-3 API scenario run: misdeliveries caught, audit steps, filed FHIR references
//   out/ui-timing.json          TEST-4 Playwright run: seconds from opening the email to "gesendet"
//   out/validation-summary.json TEST-1 validator summary (refreshed here after exporting the filed resources)
//   docs/AI-EVAL.md             V2-AI-3 AI evaluation report (npm run ai:eval), summarised in one "KI-Auswertung" line
// Filed resources are read from HAPI into out/fhir/ so the validator checks what the run really produced.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AUDIT_STEPS, EXTRA_AUDIT_STEPS } from "@brieftaube/shared";

export interface E2eResults {
  at?: string;
  R1?: { filed?: boolean; filedResources?: string[]; auditSteps?: string[]; secondsFromLoginToFiled?: number };
  R2?: { filed?: boolean; filedResources?: string[]; secondsFromLoginToFiled?: number };
  M1?: { caught?: boolean };
  M2?: { caught?: boolean };
  M3?: { caught?: boolean };
}
export interface UiTiming {
  at?: string;
  /** Opening the Mailpit message to the "gesendet" page, phone viewport, scripted user. */
  secondsEmailToSent?: number;
  installs?: number;
  accounts?: number;
}
export interface ValidationSummary {
  files?: number;
  errors?: number;
  warnings?: number;
}
export interface MetricRow {
  metric: string;
  target: string;
  result: string;
  pass: boolean | undefined;
  source: string;
}

const NOT_MEASURED = "not measured";

export function computeMetrics(i: { e2e?: E2eResults; ui?: UiTiming; validation?: ValidationSummary; filedFiles?: number }): MetricRow[] {
  const rows: MetricRow[] = [];

  const v = i.validation;
  rows.push(
    v?.errors === undefined
      ? { metric: "FHIR validation errors", target: "0", result: NOT_MEASURED, pass: undefined, source: "npm run validate:fhir" }
      : {
          metric: "FHIR validation errors",
          target: "0",
          result: `${v.errors} (${v.files ?? "?"} files, ${i.filedFiles ?? 0} of them filed by the scenario run; ${v.warnings ?? 0} warnings)`,
          pass: v.errors === 0,
          source: "HL7 validator on fhir-examples/ + out/fhir/",
        },
  );

  const secs = i.ui?.secondsEmailToSent;
  const installs = i.ui?.installs ?? 0;
  const accounts = i.ui?.accounts ?? 0;
  rows.push(
    secs === undefined
      ? {
          metric: "Outside person: installs / accounts / time",
          target: "0 / 0 / < 2 min",
          result: `${installs} / ${accounts} / ${NOT_MEASURED}`,
          pass: undefined,
          source: "Playwright UI run (out/ui-timing.json) missing",
        }
      : {
          metric: "Outside person: installs / accounts / time",
          target: "0 / 0 / < 2 min",
          result: `${installs} / ${accounts} / ${secs.toFixed(1)} s`,
          pass: installs === 0 && accounts === 0 && secs < 120,
          source: "Playwright, phone viewport, email opened → \"gesendet\"",
        },
  );

  const e = i.e2e;
  const caught = e ? [e.M1, e.M2, e.M3].filter((m) => m?.caught === true).length : undefined;
  rows.push({
    metric: "Misdeliveries caught",
    target: "3 of 3",
    result: caught === undefined ? NOT_MEASURED : `${caught} of 3 (M1 ${e?.M1?.caught ? "✓" : "✗"}, M2 ${e?.M2?.caught ? "✓" : "✗"}, M3 ${e?.M3?.caught ? "✓" : "✗"})`,
    pass: caught === undefined ? undefined : caught === 3,
    source: "npm run e2e (scenario/misdelivery.md)",
  });

  // Only the six challenge steps count; v2 extras like `reminder-sent` are ignored.
  const steps = e?.R1?.auditSteps;
  const covered = steps ? AUDIT_STEPS.filter((s) => steps.includes(s)).length : undefined;
  const missing = steps ? AUDIT_STEPS.filter((s) => !steps.includes(s)) : [];
  rows.push({
    metric: "Audit coverage",
    target: `${AUDIT_STEPS.length} of ${AUDIT_STEPS.length}`,
    result: covered === undefined ? NOT_MEASURED : `${covered} of ${AUDIT_STEPS.length}${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`,
    pass: covered === undefined ? undefined : covered === AUDIT_STEPS.length,
    source: "npm run e2e, request 1 audit trail (who/what/when asserted per entry)",
  });
  return rows;
}

/** One-line summary of docs/AI-EVAL.md (V2-AI-3), or a hint that it has not been generated. */
export function aiEvalLine(report: string | undefined): string {
  const link = "[docs/AI-EVAL.md](AI-EVAL.md)";
  if (report === undefined) return `**KI-Auswertung:** not run yet (\`npm run ai:eval\` writes ${link}).`;
  const title = /^#\s+(.+)$/m.exec(report)?.[1]?.trim() ?? "";
  const mock = /\bMOCK\b/.test(title);
  const unsupported = /Werte ohne Beleg im Original abgelegt:\s*(\d+)/.exec(report)?.[1];
  return [
    `**KI-Auswertung:** ${link}${mock ? " (MOCK model, not a real result)" : ""}`,
    unsupported === undefined ? "" : ` – Werte ohne Beleg im Original abgelegt: ${unsupported}`,
    ".",
  ].join("");
}

const mark = (p: boolean | undefined) => (p === undefined ? "–" : p ? "✅" : "❌");

export function renderMarkdown(
  rows: MetricRow[],
  meta: { generatedAt: string; e2eAt?: string; uiAt?: string; extra?: string[]; aiEval?: string },
): string {
  return [
    "# Metrics on the challenge scenario",
    "",
    `Generated by \`npm run metrics\` at ${meta.generatedAt} from real runs (API e2e: ${meta.e2eAt ?? "none"}; UI e2e: ${meta.uiAt ?? "none"}).`,
    "Values marked \"not measured\" had no run output; they are not counted as passing.",
    "",
    "| Metric | Target | Result | | Measured by |",
    "|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.metric} | ${r.target} | ${r.result} | ${mark(r.pass)} | ${r.source} |`),
    "",
    aiEvalLine(meta.aiEval),
    "",
    "## How it is measured",
    "",
    "- **FHIR validation errors:** every resource the scenario run filed is read back from HAPI into `out/fhir/` and validated together with `fhir-examples/` by the HL7 validator (`scripts/validate-fhir.ts`, JSON report). Any error or fatal issue counts.",
    "- **Installs / accounts:** the outside person only opens a link in the browser they already have and signs in with ID Austria (simulated), which they already have. No app, no Brieftaube account, no password. The UI test drives exactly this path.",
    "- **Time:** Playwright, phone viewport (Pixel 7), from opening the Mailpit message to the \"gesendet\" page, at scripted speed. A human needs reading time on top of that.",
    "- **Misdeliveries caught:** M1 (wrong address), M2 (forwarded link) and M3 (wrong patient) from `scenario/misdelivery.md`. A case counts as caught only if nothing is filed, no patient data is shown to the wrong person, the audit records it and Dr. Hofer gets a chat message.",
    `- **Audit coverage:** the six steps of \`AUDIT_STEPS\` (${AUDIT_STEPS.join(", ")}) appear in the request-1 audit trail, each with who/what/when. Extra v2 steps (${EXTRA_AUDIT_STEPS.join(", ")}) are logged but not counted.`,
    ...(meta.extra?.length ? ["", "## Notes", "", ...meta.extra.map((x) => `- ${x}`)] : []),
    "",
  ].join("\n");
}

const readJson = <T>(f: string): T | undefined => (existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as T) : undefined);

async function exportFiled(refs: string[], notes: string[]): Promise<number> {
  const base = process.env.FHIR_BASE_URL ?? "http://localhost:8090/fhir";
  mkdirSync("out/fhir", { recursive: true });
  let n = 0;
  for (const ref of refs) {
    try {
      const res = await fetch(`${base}/${ref}`, { headers: { accept: "application/fhir+json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const r = (await res.json()) as { meta?: unknown };
      delete r.meta; // server-assigned versionId/lastUpdated/source are not part of what we built
      writeFileSync(`out/fhir/${ref.replace("/", "-")}.json`, JSON.stringify(r, null, 2));
      n++;
    } catch (err) {
      notes.push(`Could not export ${ref} from ${base}: ${(err as Error).message}`);
    }
  }
  return n;
}

async function main() {
  const notes: string[] = [];
  const e2e = readJson<E2eResults>("out/e2e-results.json");
  const ui = readJson<UiTiming>("out/ui-timing.json");
  const refs = [...(e2e?.R1?.filedResources ?? []), ...(e2e?.R2?.filedResources ?? [])];
  const filedFiles = refs.length ? await exportFiled(refs, notes) : 0;

  if (!process.argv.includes("--no-validate")) {
    const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/validate-fhir.ts"], { stdio: "inherit" });
    if (run.status !== 0) notes.push("The validator run exited non-zero; see out/validation-report.json.");
  }
  const validation = readJson<ValidationSummary>("out/validation-summary.json");
  if (e2e?.R1?.secondsFromLoginToFiled !== undefined) {
    notes.push(`API-level (no rendering): request 1 took ${e2e.R1.secondsFromLoginToFiled.toFixed(1)} s from e-ID login to filed.`);
  }

  const rows = computeMetrics({ e2e, ui, validation, filedFiles });
  const aiEval = existsSync("docs/AI-EVAL.md") ? readFileSync("docs/AI-EVAL.md", "utf8") : undefined;
  const md = renderMarkdown(rows, { generatedAt: new Date().toISOString(), e2eAt: e2e?.at, uiAt: ui?.at, extra: notes, aiEval });
  writeFileSync("docs/METRICS.md", md);
  console.log(`\n${rows.map((r) => `${mark(r.pass)} ${r.metric}: ${r.result} (target ${r.target})`).join("\n")}\n${aiEvalLine(aiEval)}\nWrote docs/METRICS.md`);
  process.exit(rows.some((r) => r.pass === false) ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.dirname, "metrics.ts")) await main();

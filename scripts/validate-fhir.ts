// Runs the official HL7 FHIR validator on every JSON file in the given folders and fails on any error.
// Usage: npm run validate:fhir                 (fhir-examples/ and out/fhir/ if it exists)
//        npm run validate:fhir -- some/dir file.json
// Needs Java 17+. Downloads validator_cli.jar into .cache/ on first run (override with FHIR_VALIDATOR_JAR,
// pin another release with FHIR_VALIDATOR_VERSION). Set FHIR_TX=n/a to validate offline (no terminology server).
// The result is read from the validator's JSON report (OperationOutcome per file), not from its console text.
// Owner: Tester (task TEST-1). The metric "FHIR validation: 0 errors" is measured with this script.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export const VALIDATOR_VERSION = process.env.FHIR_VALIDATOR_VERSION ?? "7.0.3";
const JAR_URL = `https://github.com/hapifhir/org.hl7.fhir.core/releases/download/${VALIDATOR_VERSION}/validator_cli.jar`;
const jar = resolve(process.env.FHIR_VALIDATOR_JAR ?? `.cache/validator_cli-${VALIDATOR_VERSION}.jar`);

interface Issue {
  severity: "fatal" | "error" | "warning" | "information";
  code?: string;
  details?: { text?: string };
  diagnostics?: string;
  expression?: string[];
  location?: string[];
}
interface OperationOutcome {
  resourceType: "OperationOutcome";
  issue?: Issue[];
  extension?: { url: string; valueString?: string }[];
}
interface FileResult {
  file: string;
  errors: number;
  warnings: number;
  information: number;
  issues: { severity: string; where: string; message: string }[];
}

function ensureJar(): void {
  if (existsSync(jar)) return;
  mkdirSync(resolve(".cache"), { recursive: true });
  console.log(`Downloading FHIR validator ${VALIDATOR_VERSION} to ${jar} ...`);
  const tmp = `${jar}.part`;
  execFileSync("curl", ["-sSfL", "--retry", "3", "-o", tmp, JAR_URL], { stdio: "inherit" });
  renameSync(tmp, jar);
}

function collect(paths: string[]): string[] {
  const files: string[] = [];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p)) if (f.endsWith(".json")) files.push(join(p, f));
    } else files.push(p);
  }
  return [...new Set(files)].sort();
}

/** The validator writes one OperationOutcome for a single file and a Bundle of them for several. */
export function outcomesFromReport(report: unknown): OperationOutcome[] {
  const r = report as { resourceType?: string; entry?: { resource?: OperationOutcome }[] };
  if (r?.resourceType === "OperationOutcome") return [r as OperationOutcome];
  if (r?.resourceType === "Bundle") return (r.entry ?? []).map((e) => e.resource).filter((x): x is OperationOutcome => x?.resourceType === "OperationOutcome");
  return [];
}

export function summarise(oo: OperationOutcome): FileResult {
  const fileExt = oo.extension?.find((e) => e.url === "http://hl7.org/fhir/StructureDefinition/operationoutcome-file");
  const issues = oo.issue ?? [];
  const count = (...s: Issue["severity"][]) => issues.filter((i) => s.includes(i.severity)).length;
  return {
    file: fileExt?.valueString ?? "?",
    errors: count("error", "fatal"),
    warnings: count("warning"),
    information: count("information"),
    issues: issues.map((i) => ({
      severity: i.severity,
      where: i.expression?.[0] ?? i.location?.[0] ?? "",
      message: i.details?.text ?? i.diagnostics ?? i.code ?? "",
    })),
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const targets = collect(args.length ? args : ["fhir-examples", "out/fhir"]);
  if (targets.length === 0) {
    console.error("No FHIR JSON files found.");
    process.exit(1);
  }

  ensureJar();
  mkdirSync("out", { recursive: true });
  const report = resolve("out/validation-report.json");
  rmSync(report, { force: true });

  // One JVM run for all files (much faster than one run per file).
  const run = spawnSync(
    "java",
    ["-jar", jar, ...targets, "-version", "4.0", "-output", report, ...(process.env.FHIR_TX ? ["-tx", process.env.FHIR_TX] : [])],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );

  if (!existsSync(report)) {
    process.stdout.write((run.stdout ?? "").split("\n").slice(-80).join("\n"));
    process.stderr.write(run.stderr ?? "");
    console.error(`\nValidator produced no report (exit ${run.status}${run.error ? `, ${run.error.message}` : ""}).`);
    process.exit(1);
  }

  const results = outcomesFromReport(JSON.parse(readFileSync(report, "utf8"))).map(summarise);
  for (const r of results) {
    const name = relative(process.cwd(), r.file) || r.file;
    console.log(`${r.errors ? "FAIL" : "ok  "} ${name}  (${r.errors} error(s), ${r.warnings} warning(s))`);
    for (const i of r.issues) if (i.severity === "error" || i.severity === "fatal") console.log(`       ${i.severity.toUpperCase()} ${i.where}: ${i.message}`);
    if (process.env.FHIR_SHOW_WARNINGS) for (const i of r.issues) if (i.severity === "warning") console.log(`       warning ${i.where}: ${i.message}`);
  }

  const errors = results.reduce((n, r) => n + r.errors, 0);
  const warnings = results.reduce((n, r) => n + r.warnings, 0);
  const missing = targets.length - results.length;
  const summary = {
    validatorVersion: VALIDATOR_VERSION,
    files: targets.length,
    reported: results.length,
    errors,
    warnings,
    exitCode: run.status,
    at: new Date().toISOString(),
    perFile: results.map(({ issues: _issues, ...rest }) => ({ ...rest, file: relative(process.cwd(), rest.file) || rest.file })),
  };
  writeFileSync("out/validation-summary.json", JSON.stringify(summary, null, 2));
  console.log(`\nValidated ${targets.length} file(s): ${errors} error(s), ${warnings} warning(s). Report: ${relative(process.cwd(), report)}`);
  if (missing > 0) console.error(`${missing} file(s) missing from the validator report.`);
  process.exit(errors === 0 && missing === 0 && run.status === 0 ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.dirname, "validate-fhir.ts")) main();

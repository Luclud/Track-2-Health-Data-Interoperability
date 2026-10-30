// Runs the official HL7 FHIR validator on every JSON file in the given folders and fails on any error.
// Usage: npm run validate:fhir                 (fhir-examples/ and out/fhir/ if it exists)
//        npm run validate:fhir -- some/dir file.json
// Needs Java 17+. Downloads validator_cli.jar into .cache/ on first run (override with FHIR_VALIDATOR_JAR).
// Owner: Account A, Tester (task TEST-1). The metric "FHIR validation: 0 errors" is measured with this script.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const JAR_URL = "https://github.com/hapifhir/org.hl7.fhir.core/releases/latest/download/validator_cli.jar";
const jar = resolve(process.env.FHIR_VALIDATOR_JAR ?? ".cache/validator_cli.jar");

function ensureJar(): void {
  if (existsSync(jar)) return;
  mkdirSync(resolve(".cache"), { recursive: true });
  console.log(`Downloading FHIR validator to ${jar} ...`);
  execFileSync("curl", ["-sSfL", "-o", jar, JAR_URL], { stdio: "inherit" });
}

function collect(paths: string[]): string[] {
  const files: string[] = [];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p)) if (f.endsWith(".json")) files.push(join(p, f));
    } else files.push(p);
  }
  return files.sort();
}

const args = process.argv.slice(2);
const targets = collect(args.length ? args : ["fhir-examples", "out/fhir"]);
if (targets.length === 0) {
  console.error("No FHIR JSON files found.");
  process.exit(1);
}

ensureJar();
mkdirSync("out", { recursive: true });
const report = resolve("out/validation-report.json");

// One JVM run for all files (much faster than one run per file).
const run = spawnSync(
  "java",
  ["-jar", jar, ...targets, "-version", "4.0", "-output", report, ...(process.env.FHIR_TX === "n/a" ? ["-tx", "n/a"] : [])],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
process.stdout.write(run.stdout.split("\n").filter((l) => /Error|error|WARNING|Success|\*FAILURE\*|Information/.test(l)).slice(-200).join("\n") + "\n");

const errorLines = (run.stdout + run.stderr).split("\n").filter((l) => /^\s*Error @/.test(l));
const summary = { files: targets.length, errors: errorLines.length, exitCode: run.status, at: new Date().toISOString() };
writeFileSync("out/validation-summary.json", JSON.stringify(summary, null, 2));
console.log(`\nValidated ${targets.length} file(s): ${errorLines.length} error(s). Report: ${report}`);
process.exit(errorLines.length === 0 && run.status === 0 ? 0 : 1);

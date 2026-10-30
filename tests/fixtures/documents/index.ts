// Loader for the document fixtures (TEST-2). See README.md in this folder.
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ParsedDocument } from "@brieftaube/shared";

export type FixtureExpectation =
  | { ok: true; document: ParsedDocument; expectedInterpretation?: ("N" | "H" | "L")[]; patientMatchesMaria?: boolean }
  | { ok: false; llmDocument?: ParsedDocument };

export interface DocumentFixture {
  name: string;
  /** Path of the .md file, relative to the repo root */
  file: string;
  content: string;
  expected: FixtureExpectation & { $note?: string };
}

const HERE = import.meta.dirname;
const REPO = resolve(HERE, "../../..");

function withMarkdown(exp: FixtureExpectation, content: string): FixtureExpectation {
  const fill = (d: ParsedDocument | undefined) => (d?.kind === "rehab-discharge-report" ? { ...d, markdown: content } : d);
  return exp.ok ? { ...exp, document: fill(exp.document)! } : { ...exp, ...(exp.llmDocument ? { llmDocument: fill(exp.llmDocument)! } : {}) };
}

function load(expectedPath: string, mdPath: string, name: string): DocumentFixture {
  const content = readFileSync(mdPath, "utf8");
  const raw = JSON.parse(readFileSync(expectedPath, "utf8")) as FixtureExpectation & { $note?: string; $source?: string };
  return { name, file: mdPath.slice(REPO.length + 1), content, expected: withMarkdown(raw, content) as DocumentFixture["expected"] };
}

/** Variant fixtures (tests/fixtures/documents/*.md). Pass `{ includeScenario: true }` to add the 3 scenario documents. */
export function loadDocumentFixtures(opts: { includeScenario?: boolean } = {}): DocumentFixture[] {
  const out: DocumentFixture[] = [];
  for (const f of readdirSync(HERE).filter((x) => x.endsWith(".md") && x !== "README.md").sort()) {
    const name = f.replace(/\.md$/, "");
    out.push(load(join(HERE, `${name}.expected.json`), join(HERE, f), name));
  }
  if (opts.includeScenario) {
    const dir = join(HERE, "scenario");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".expected.json")).sort()) {
      const raw = JSON.parse(readFileSync(join(dir, f), "utf8")) as { $source: string };
      out.push(load(join(dir, f), join(REPO, raw.$source), `scenario/${f.replace(/\.expected\.json$/, "")}`));
    }
  }
  return out;
}

export function fixture(name: string): DocumentFixture {
  const f = loadDocumentFixtures({ includeScenario: true }).find((x) => x.name === name);
  if (!f) throw new Error(`No document fixture named ${name}`);
  return f;
}

// V2-AI-3: how well does the LLM fallback read our documents, and does verification catch made-up values?
//   npm run ai:eval                      (LLM_PROVIDER unset/none/mock → offline MOCK run)
//   LLM_PROVIDER=anthropic LLM_API_KEY=… npm run ai:eval
// The deterministic parser is skipped: every document goes through llmParse (model + verification).
// Writes docs/AI-EVAL.md.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ParsedDocument, ParsedLabValue } from "@brieftaube/shared";
import { config } from "../services/core/src/config.ts";
import { MockLlmClient, createLlmClient, llmParse } from "../services/core/src/llm/index.ts";
import { verifyLlmDocument, numbersIn } from "../services/core/src/llm/verify.ts";
import { foldText } from "../services/core/src/parser/index.ts";
import { quantity } from "../services/core/src/fhir/util.ts";
import type { LlmClient } from "../services/core/src/ports.ts";
import { loadDocumentFixtures } from "../tests/fixtures/documents/index.ts";

const DEFAULT_MODEL: Record<string, string> = { anthropic: "claude-sonnet-5-5", perplexity: "sonar-pro" };
const mock = config.llmProvider === "none" || config.llmProvider === "mock";
const provider = mock ? "mock" : config.llmProvider;
const model = mock ? "Erwartungswerte aus den Fixtures" : config.llmModel || DEFAULT_MODEL[provider] || "(nicht gesetzt)";

interface Row {
  name: string;
  file: string;
  kind: string;
  expectedValues: number;
  correct: number;
  wrong: number;
  rejected: boolean;
  patient: boolean | undefined;
  unsupportedFiled: number;
  trapRejected: boolean;
  note?: string;
}

const unitCode = (v: ParsedLabValue) => quantity(v.value, v.unitText, v.loinc).code ?? v.unitText;
const sameValue = (a: ParsedLabValue, b: ParsedLabValue) =>
  a.value === b.value && a.referenceLow === b.referenceLow && a.referenceHigh === b.referenceHigh && unitCode(a) === unitCode(b);
const samePatient = (a: ParsedDocument, b: ParsedDocument) =>
  foldText(a.patient.name.family) === foldText(b.patient.name.family) &&
  foldText(a.patient.name.given[0] ?? "") === foldText(b.patient.name.given[0] ?? "") &&
  a.patient.birthDate === b.patient.birthDate;

function numberNotIn(source: string): number {
  const nums = new Set(numbersIn(source));
  let n = 987.6;
  while (nums.has(n)) n = Math.round((n + 1.1) * 10) / 10;
  return n;
}

/** The model output with one value replaced by a number that is not in the source (rehab: the birth year). */
function trap(output: unknown, source: string): unknown {
  const o = structuredClone(output) as Record<string, any>; // any: untrusted model JSON
  if (Array.isArray(o.values) && o.values.length) o.values[0].value = numberNotIn(source);
  else if (o.patient && typeof o.patient.birthDate === "string") {
    const nums = new Set(numbersIn(source));
    let y = Number(o.patient.birthDate.slice(0, 4)) + 1;
    while (nums.has(y)) y++;
    o.patient.birthDate = `${y}${o.patient.birthDate.slice(4)}`;
  }
  return o;
}

class RecordingClient implements LlmClient {
  readonly enabled = true;
  last: unknown;
  constructor(private readonly inner: LlmClient) {}
  async completeJson(p: Parameters<LlmClient["completeJson"]>[0]): Promise<unknown> {
    this.last = undefined;
    this.last = await this.inner.completeJson(p);
    return this.last;
  }
}

const fixtures = loadDocumentFixtures({ includeScenario: true });
const real = mock ? undefined : createLlmClient(config);
const rows: Row[] = [];

for (const f of fixtures) {
  const expected = f.expected.ok ? f.expected.document : f.expected.llmDocument;
  if (!expected) continue;
  const client = new RecordingClient(real ?? new MockLlmClient(expected));
  const result = await llmParse(client, f.content);
  const exp = expected.kind === "lab-result" ? expected.values : [];
  const row: Row = { name: f.name, file: f.file, kind: expected.kind, expectedValues: exp.length, correct: 0, wrong: 0, rejected: !result.ok, patient: undefined, unsupportedFiled: 0, trapRejected: false };
  const got = result.ok ? result.document : undefined;
  if (got) {
    row.patient = samePatient(got, expected) && got.kind === expected.kind;
    if (got.kind === "lab-result") {
      const nums = numbersIn(f.content);
      for (const v of got.values) {
        const e = exp.find((x) => x.loinc === v.loinc);
        if (e && sameValue(v, e)) row.correct++;
        else row.wrong++;
        if (!nums.includes(v.value)) row.unsupportedFiled++;
      }
      row.wrong += exp.filter((e) => !got.values.some((v) => v.loinc === e.loinc)).length;
    }
  } else {
    row.rejected = true;
    row.note = result.ok ? "kein Dokument" : result.problems.slice(0, 2).join("; ");
  }
  const output = client.last ?? expected;
  row.trapRejected = !verifyLlmDocument(f.content, trap(output, f.content)).ok;
  rows.push(row);
  console.log(`${row.name}: ${row.rejected ? "rejected" : `${row.correct}/${row.expectedValues} correct`}, trap ${row.trapRejected ? "rejected" : "NOT rejected"}`);
}

const sum = (k: "correct" | "wrong" | "expectedValues" | "unsupportedFiled") => rows.reduce((a, r) => a + r[k], 0);
const yes = (b: boolean | undefined) => (b === undefined ? "–" : b ? "ja" : "nein");
const date = new Intl.DateTimeFormat("de-AT", { timeZone: "Europe/Vienna", dateStyle: "long", timeStyle: "short" }).format(new Date());
const md = `# KI-Auswertung${mock ? " – MOCK (kein echtes Modell)" : ""}

${mock ? "> **MOCK:** Das \"Modell\" gibt die Erwartungswerte zurück. Dieser Bericht prüft nur die Messung und die Verifikation, **nicht** die Lesequalität eines echten Modells. Echter Lauf: \`LLM_PROVIDER=anthropic LLM_API_KEY=… npm run ai:eval\`.\n\n" : ""}- Anbieter: ${provider}
- Modell: ${model}
- Datum: ${date}
- Weg: nur KI (deterministischer Parser übersprungen), danach Verifikation gegen den Originaltext
- Dokumente: ${rows.length}

| Dokument | Art | Werte richtig | Werte falsch | Von Verifikation abgelehnt | Patient richtig | Falle (erfundener Wert) abgelehnt |
|---|---|---|---|---|---|---|
${rows.map((r) => `| \`${r.file}\` | ${r.kind === "lab-result" ? "Labor" : "Reha"} | ${r.kind === "lab-result" ? `${r.correct}/${r.expectedValues}` : "–"} | ${r.kind === "lab-result" ? r.wrong : "–"} | ${r.rejected ? `ja${r.note ? ` (${r.note.replace(/\|/g, "\\|")})` : ""}` : "nein"} | ${yes(r.patient)} | ${r.trapRejected ? "ja" : "**nein**"} |`).join("\n")}

## Summe

- Werte richtig: ${sum("correct")} von ${sum("expectedValues")}
- Werte falsch: ${sum("wrong")}
- Dokumente von der Verifikation abgelehnt: ${rows.filter((r) => r.rejected).length} von ${rows.length}
- Patient richtig: ${rows.filter((r) => r.patient).length} von ${rows.filter((r) => !r.rejected).length} angenommenen Dokumenten
- Falle abgelehnt: ${rows.filter((r) => r.trapRejected).length} von ${rows.length}
- Werte ohne Beleg im Original abgelegt: ${sum("unsupportedFiled")}

KI-gelesene Dokumente werden nie automatisch abgelegt: Sie warten auf die Freigabe durch Dr. Hofer (mit Beleg-Zeile je Wert).
`;
writeFileSync(resolve(import.meta.dirname, "../docs/AI-EVAL.md"), md);
console.log("Wrote docs/AI-EVAL.md");
const failed = rows.some((r) => !r.trapRejected) || sum("unsupportedFiled") > 0;
process.exit(failed ? 1 : 0);

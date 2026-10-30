# Document fixtures (TEST-2)

Jury-like variants of the scenario documents for the parser (CORE-1), the patient check (CORE-5) and the LLM fallback (CORE-9).
Each `<name>.md` has a `<name>.expected.json`. `scenario/*.expected.json` holds the expected result for the three files in `scenario/documents/` (path in `$source`).

Use the loader, which joins everything for you:

```ts
import { loadDocumentFixtures } from "../../../../tests/fixtures/documents/index.ts";
for (const f of loadDocumentFixtures()) {
  const r = parser.parse(f.content);
  expect(r.ok).toBe(f.expected.ok);
  if (f.expected.ok) expect(r.document).toEqual(f.expected.document);
}
```

## expected.json

| Field | Meaning |
|---|---|
| `ok` | what `DocumentParser.parse()` must return in `ok` |
| `document` | the exact `ParsedDocument` (when `ok: true`). For rehab reports, `markdown` is left out of the JSON; the loader sets it to the raw file content |
| `llmDocument` | (`ok: false` only) what a correct LLM extraction looks like, for `LLM_PROVIDER=mock`. Passes the DESIGN.md §3 checks |
| `expectedInterpretation` | N/H/L per value, in table order, for the FHIR builder |
| `patientMatchesMaria` | `false` if the document is about someone other than the scenario patient (it must be rejected for her requests) |
| `$note` | what the fixture tests |

## Conventions the expectations use (DESIGN.md §3)

- Dates use Europe/Vienna with the right offset (`+02:00` CEST, `+01:00` CET; in 2026 DST ends on 25 October), always with seconds.
- Strings are trimmed; `\r` never appears in parsed values.
- `unitText` is written exactly as in the document (`""` if empty); UCUM mapping is done by the FHIR builder.
- Range `<B` gives only `referenceHigh`, `>A` gives only `referenceLow`; `A to B`, `A - B` and `A–B` give both.
- `Validated by: Dr. Eva Brandl, lab physician` gives name `{given:["Eva"], family:"Brandl", prefix:["Dr."]}` and role `lab physician`. The role is the first comma-separated part after the name only: `Dr. Anna Weber, medical director, Reha Waldblick` gives role `medical director` (matches the CORE-1 parser).
- `requestedBy` is the raw text after `Requested by:`, and is absent if that line is missing.
- `conclusion` is the paragraph after the table.

| Fixture | Tests |
|---|---|
| lab-donaustadt-crp-hb-creatinine | other lab/physician, CRP 1988-5, Hb 718-7, creatinine 2160-0, H+L values, `<5`, `A - B`, `A–B`, 10^12/L, CET |
| lab-german-month-names | `März`, `Jänner`, next year |
| lab-without-requested-by | optional line missing, µmol/L |
| lab-crlf-line-endings | `\r\n` everywhere |
| lab-extra-blank-lines | blank lines, padded cells, alignment row `:---` |
| lab-columns-reordered | columns matched by header name, `%` |
| rehab-seeblick-cross-month | other clinic, `28 September to 19 October 2026`, `Mag.` title |
| rehab-cross-year-stay | `21 December 2026 to 11 January 2027` |
| lab-different-patient-martina | same family + birth date as Maria, other first name, so it must be rejected |
| free-text-letter-not-in-format | German letter, parser `ok:false`, LLM path |

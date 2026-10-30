# FHIR R4 mapping

**Golden examples** (the exact target shape) are in `fhir-examples/`. Builders in `services/core/src/fhir/` must produce the same structure; tests compare against them ignoring `fullUrl` uuids, timestamps of the run and base64 data of other documents.

All resources must pass `java -jar validator_cli.jar <file> -version 4.0` with **0 errors** (`npm run validate:fhir`). Warnings are acceptable but should be minimised.

## Rules that keep the validator happy

- Do **not** put `display` on LOINC codings (wrong displays are validation issues); use `code.text` for the human label.
- Use only standard elements, no custom extensions.
- UCUM `system` + `code` only for units we map (see DESIGN.md §3). Unknown unit → `{ value, unit }` only.
- `Provenance.recorded` is an instant: full date-time with seconds and offset.
- Narrative `div` must be XHTML with `xmlns="http://www.w3.org/1999/xhtml"` and escaped text.
- Transaction bundles: `fullUrl` = `urn:uuid:<uuid>`, references between new resources use those urns; Practitioner/Organization use conditional create (`ifNoneExist` on identifier) so repeated answers don't duplicate them.

## Resources

### Seeded (scripts/seed.ts)
| Resource | id | Notes |
|---|---|---|
| Patient | `maria-beispiel` (configurable `SCENARIO_PATIENT_ID`) | from `scenario/patient.json` |
| Practitioner | `lena-hofer` | identifier `urn:brieftaube:matrix-user` = `@lena.hofer:klinikum.example` |
| Organization | `klinikum-beispielstadt` | |

### At request time
| Resource | Golden | Notes |
|---|---|---|
| Task | `task-requested.json` | id = lowercase reference (`bt-7k2q`), status `requested`, intent `order`, code `fulfill`, `for` Patient, `requester` Practitioner/lena-hofer, `owner.display` recipient, `input` requested document type, `note` = doctor's note |

### Lab result (`lab-result-transaction.json`)
| Resource | Key fields |
|---|---|
| Practitioner (sender = validator) | identifier bPK (eID) + register number; name with prefix; telecom email |
| Organization (lab) | identifier `urn:brieftaube:organization` slug |
| Observation × n | status final; category laboratory; code LOINC + text; subject; effective = sample taken; issued = reported; performer [Practitioner, Organization]; valueQuantity UCUM; referenceRange low/high/text; interpretation N/H/L computed from range |
| DiagnosticReport | category LAB (v2-0074); code LOINC `11502-2` (Laboratory report) + text = document title; result → Observations; resultsInterpreter = validator; conclusion; presentedForm = original Markdown (base64) |
| Provenance | target = DiagnosticReport + Observations; occurred = answer sent; recorded = filed; policy `urn:brieftaube:identity-policy:eid-high+register`; activity CREATE; agents: author (validated by), informant (verified sender), assembler (Brieftaube); entity source = uploaded file name + sha256; signature (Verification Signature, `when` = identity check time, `who` = verified sender); narrative explains the identity check in words |
| Task (PUT) | status `completed`, owner = Practitioner, output → DiagnosticReport |

### Rehab discharge report (`rehab-report-transaction.json`)
| Resource | Key fields |
|---|---|
| Practitioner (author, from document) | identifier `urn:brieftaube:document-author` = `<org-slug>/<name-slug>`; not identity-checked |
| Practitioner (sender, verified) | identifier bPK; telecom phone |
| Organization (rehab clinic) | |
| DocumentReference | status current; docStatus final; type LOINC `18842-5` (Discharge summary) + text; subject; date; author [author Practitioner, Organization]; description; content.attachment Markdown base64 + title; context.period = stay |
| Provenance | policy `…:eid-high`; agents: author = Dr. Leitner, informant = Stefan Kern (verified), assembler; signature who = Stefan Kern |
| Task (PUT) | completed, output → DocumentReference |

### Optional (P3)
- MedicationStatement per discharge medication (rivaroxaban, paracetamol, pantoprazole) with `derivedFrom` → DocumentReference. Only if everything else is green.

### Audit
| Resource | Golden |
|---|---|
| AuditEvent | `auditevent-identity-checked.json`, `auditevent-misdelivery-identity.json` — type DCM 110100, subtype `urn:brieftaube:audit-step|<step>`, outcome 0 success / 4 failure, agent.who with bPK identifier or display, entity → Task (+ Patient where appropriate) |

## Wrong patient

Nothing is filed for the requested patient. The Task gets `businessStatus.text = "misdelivery: wrong-patient"` (status stays `requested`). The other patient's data is not stored anywhere (only sha256 + reason in the audit).

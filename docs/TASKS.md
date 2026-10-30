# Task board

Read `AGENTS.md` first. Work top to bottom inside your lane; P0 before P1 before P2. One task = one branch = one PR (`<task-id>-short-name`, e.g. `CORE-1-parser`). Tick the box in this file **in your PR** when the task is done.

**Global definition of done** for every task:
- `npm run check` passes (typecheck + unit tests + FHIR validation).
- The task's acceptance criteria are met and covered by tests where stated.
- Only files in your lane were changed (plus this file's checkbox).
- PR description: what was done, what was decided without asking, what is still missing.

All lanes run in ONE Devin account under one coordinator (`docs/agents/coordinator.md`). The lane names A-/B- are historical; ignore the account letters.

---

## BOOT — Coordinator, before anything else (≤ 20 min)

- [x] **BOOT-1 Install and go green.** Run `npm install`, `npm run typecheck`, `npm test`. Fix only trivial type errors in the skeleton (the initial commit was written without being able to run npm). Commit `package-lock.json`. Run `npm run validate:fhir` on `fhir-examples/`; if the golden examples have validator **errors**, fix the examples (keep the structure, change only what the validator complains about) and note every change in the PR and in `docs/FHIR-MAPPING.md`. Merge to `main`.
  - Acceptance: `main` has `package-lock.json`; `npm run check` is green on `main`; CI workflow green.
  - Dev Matrix starts INFRA-1 in parallel but does **not** commit `package-lock.json` until BOOT-1 is merged.

---

## Lane A-CORE — Dev Core (account A)
Owns: `services/core/src/{domain,parser,fhir,llm,audit,api,db}/**`

- [ ] **CORE-1 (P0) Deterministic parser.** `parser/` implements `DocumentParser` per DESIGN.md §3 (dates in Europe/Vienna via luxon, units → UCUM mapping, ranges, German + English month names, header-name based table columns).
  - Tests: the 3 scenario documents parse to exactly the expected values; plus ≥ 6 variant fixtures from `tests/fixtures/documents/` (A-TEST provides them; until then write your own in `parser/__fixtures__`). Malformed input never throws.
- [ ] **CORE-2 (P0) FHIR builders.** `fhir/build-lab.ts`, `fhir/build-rehab.ts`, `fhir/build-task.ts`, `fhir/build-audit-event.ts`, `fhir/build-provenance.ts`: pure functions from (request, parsed document, identity check result, timestamps) → transaction `Bundle`. Must match `fhir-examples/` (test: build from the scenario docs with the golden timestamps and deep-compare after removing uuids). Interpretation N/H/L from the range. LOINC check digit util.
  - Also write every built resource to `out/fhir/<name>.json` in a test so `npm run validate:fhir` validates real builder output (0 errors).
- [ ] **CORE-3 (P0) Repository + RequestService core.** `db/` SQLite repository (better-sqlite3, `DATA_DIR/brieftaube.db`, JSON column + token hash index). `domain/`: createRequest (reference `BT-` + 4 chars Crockford base32, token 32 bytes base64url, sha256 stored, expiry), Task created on FHIR, notification via `email`/`sms` sender with the DESIGN.md §4 templates passed through `assertNotificationIsClean`, chat message, audit `request-sent`. openLink (audit `link-opened`). State machine per ARCHITECTURE.md.
  - Tests with in-memory fakes (no Docker): full happy path for both requests using fake eID identities.
- [ ] **CORE-4 (P0) Identity policy.** `domain/identity.ts`: name parsing of the doctor's input, `matchesRecipient`, policy per document type, register lookup via `PhysicianRegister`. completeIdentityCheck → audits `identity-checked` (+ `misdelivery-caught` identity-mismatch + Matrix ⚠ on failure).
  - Tests: Eva Brandl ok; Thomas Gruber (M2) and Ines Fremd (M1) fail; title/diacritics/case variants ok; not-in-register → later `held`.
- [ ] **CORE-5 (P0) Answer handling + patient check.** submitAnswer: audit `answer-sent`; parse (→ LLM fallback if enabled); compare form fields AND parsed patient with the request (DESIGN.md §2); compare document type; on mismatch audit `misdelivery-caught`, Task businessStatus, Matrix 🛑, return rejected with a German message for the responder; on success build bundle, `fhir.transaction`, update request, audit `answer-filed`, Matrix ✅ summary.
  - Tests: M3 with `lab-result-max-beispiel.md` (form says Max, and also form says Maria but document is Max) → rejected, nothing sent to FHIR store fake.
- [ ] **CORE-6 (P0) HAPI client.** `fhir/store.ts` with fetch, `application/fhir+json`, errors include OperationOutcome text. Transaction returns response bundle; map `urn:uuid` → created ids for `filedResources`.
- [ ] **CORE-7 (P0) Audit log.** `audit/`: SQLite table + append `DATA_DIR/audit.jsonl` + FHIR AuditEvent via builder (best effort, errors logged not thrown).
- [ ] **CORE-8 (P0) REST API.** `api/routes.ts` exactly per `packages/shared/src/api.ts`; auth middleware for `AUTH_MODE=dev|matrix` (OpenID userinfo at Synapse; allowed users = `*:klinikum.example`; requester profile from Matrix display name + Practitioner lookup by identifier, fallback to seed values).
  - Tests: Fastify `inject` tests for every endpoint with fakes.
- [ ] **CORE-9 (P1) LLM fallback.** `llm/`: providers `anthropic` (Messages API), `perplexity` and `openai-compatible` (chat completions with `response_format: json_schema`), `mock` (returns fixture JSON), `none`. JSON schema in `llm/schema.ts`. Verification per DESIGN.md §3; verified results → `held` (`ai-extracted`).
  - Tests with `mock`: hallucinated value is rejected; correct extraction becomes `held`.
- [ ] **CORE-10 (P1) Recipient check.** `checkRecipient`: uppercase, confusables, mixed scripts, unknown contact, name-not-in-address. `labor-kanaI.example` must warn.
- [ ] **CORE-11 (P2) Held answers.** release/reject endpoints + service; release files exactly what was held (keep the parsed doc in the DB until decided).
- [ ] **CORE-12 (P3) Extras.** MedicationStatements from the rehab report; 2-line AI summary of the rehab report in the Matrix ✅ message when an LLM is configured (clearly marked "KI-Zusammenfassung").

## Lane A-TEST — Tester (account A)
Owns: `tests/**`, `scripts/validate-fhir.ts`, `scripts/metrics.ts`, `.github/workflows/**`

- [ ] **TEST-1 (P0, first) Validation pipeline.** Make `npm run validate:fhir` robust (parse the validator's JSON output instead of text if easier), cache the jar in CI, fail on any error. Confirm golden examples pass (with BOOT-1).
- [ ] **TEST-2 (P0) Document fixtures.** `tests/fixtures/documents/`: ≥ 8 jury-like variants in the scenario format: another lab (other physician, other LOINC codes e.g. CRP 1988-5, Hb 718-7, creatinine 2160-0, with H/L values), German month names, missing "Requested by", CRLF line endings, extra blank lines, a rehab report from another clinic with a cross-month stay, a document for a different patient, a document that is not in the format at all (for the LLM path). Add `*.expected.json` with the expected parse result for each.
- [ ] **TEST-3 (P0) API scenario e2e** (`tests/e2e/scenario.e2e.ts`, runs against the stack): request 1 by email (read link from Mailpit API), request 2 by SMS (`/api/dev/sms`), M1, M2, M3 exactly as in `scenario/misdelivery.md`, drive the mock eID over HTTP. Assert: FHIR server has 4 Observations with the right LOINC codes + DiagnosticReport + Provenance for Maria; DocumentReference for request 2; nothing for Max; audit has all six steps with who/what/when; email and SMS bodies pass the privacy guard; Matrix (or in-memory chat) got the messages.
- [ ] **TEST-4 (P1) UI e2e** (Playwright, `tests/e2e/ui/`): outside person flow in a phone-sized viewport from the Mailpit message to "gesendet"; record the duration; doctor UI standalone mode creates a request.
- [ ] **TEST-5 (P1) Metrics.** `scripts/metrics.ts` writes `docs/METRICS.md` with the four challenge metrics from real runs.
- [ ] **TEST-6 (P1) CI e2e job.** GitHub Actions job that starts the compose stack, seeds, starts core, runs TEST-3. May be non-required if it is slow/flaky; document.

## Lane B-MATRIX — Dev Matrix + infra (account B)
Owns: `infra/**`, `scripts/seed.ts`, `services/core/src/chat/**`, `apps/doctor-ui/**`

- [ ] **INFRA-1 (P0, first) Stack up.** `npm run stack:up` brings Synapse, Element, HAPI, Mailpit up healthy on a fresh machine (mirror images). Fix `infra/synapse/*` as needed. Document gotchas in `docs/RUNBOOK.md`.
- [x] **INFRA-2 (P0) Seed.** Implement `scripts/seed.ts` per its header comment (idempotent). Writes `data/runtime.json`. Core reads `runtime.json` at startup if env vars are empty (add the read in `chat/` — do not edit `config.ts`; ask the coordinator if you must).
- [ ] **MATRIX-2 (P0) MatrixNotifier.** Post `m.room.message` with `body` + `format: org.matrix.custom.html` + `formatted_body` as the bot. Retries once. In `CHAT_MODE=memory` the in-memory notifier stays.
- [ ] **UI-1 (P0) Doctor UI – new request.** React app: patient picker (`/api/patients`), document type, note, recipient (name, role, organization, physician yes/no, channel email/SMS, address). Calls `/api/recipient-check` on blur and shows warnings; sending with warnings needs a second click ("trotzdem senden"). German UI, clean clinical look, fits a narrow widget panel (≥ 320 px).
- [ ] **UI-2 (P0) Doctor UI – requests list.** Status per request with the audit timeline (icons per step), filed summary (lab table with H/L highlighting / rehab excerpt), problems highlighted (identity mismatch, wrong patient). Polls every 3 s.
- [ ] **UI-3 (P0) Two modes.** Widget mode: `matrix-widget-api` (`WidgetApi`, request OpenID credentials, send them as Bearer). Standalone mode (`?mode=standalone`): no Element; left = simulated room timeline from `/api/chat/messages`, right = the same panels; auth `X-Dev-User`. Must be usable for the demo website tomorrow without extra work.
- [ ] **UI-4 (P1) Element integration check.** After seed, logging into Element as lena.hofer shows the room with the widget pinned, no extra clicks except a possible one-time widget permission. Screenshot in `docs/screenshots/`.
- [ ] **INFRA-3 (P2) One-command demo.** `scripts/demo.sh`: stack up → seed → ui build → start core with `CHAT_MODE=matrix MAIL_MODE=smtp AUTH_MODE=matrix`; prints all URLs.
- [ ] **BOT-1 (P3)** `!brieftaube status` command in the room lists open requests.

## Lane B-OUTSIDE — Dev Outside (account B)
Owns: `services/core/src/{portal,eid,notify,register}/**` (except `notify/privacy.ts`, which is done — do not weaken it)

- [ ] **OUT-1 (P0) Email + SMS.** `SmtpSender` with nodemailer → Mailpit. SMS simulator page `/dev/sms`: phone-frame look, list newest first, links clickable. Senders must call `assertNotificationIsClean` defensively as well (belt and braces).
- [ ] **OUT-2 (P0) Mock ID Austria + register.** `/mock-eid/authorize?state&redirect_uri&login_hint` page: clearly labelled "Simulierte e-ID (Platzhalter für ID Austria)" — **do not copy ID Austria's logo or branding**; persona buttons from `infra/mock-eid-personas.json` + "andere Person" form (given, family, birth date). POST → one-time code → redirect. `exchangeCode` returns `VerifiedIdentity` (LoA high, fake bPK `GH:mock-bpk-<slug>`). `MockPhysicianRegister` reads `infra/mock-register.json` (match family + first given; birth date if present).
- [ ] **OUT-3 (P0) Portal.** German, mobile-first, server-rendered HTML (escaped template literals, no SPA), one CSS file, big buttons. Pages per `portal/routes.ts`. Signed session cookie after eID. Form: patient given name, family name, birth date (`<input type=date>`), file upload (.md/.txt) **or** textarea, send. Result pages for filed / held / rejected (rejected = friendly explanation + allow a corrected upload) / identity failed / expired / already answered. Uses only `deps.requests` and `deps.eid`.
  - Target: a new person finishes request 1 in < 2 min, 0 installs, 0 accounts.
- [ ] **OUT-4 (P1) Polish.** Progress indicator (1 Identität → 2 Dokument → 3 Gesendet), accessible labels, clear "für Dr. Eva Brandl" header, error states. Lighthouse-ish sanity on a phone viewport.

## Lane B-REVIEW — Reviewer (account B, short sessions on demand)
- [ ] **REV-n** Review each PR against: acceptance criteria, `AGENTS.md` rules, DESIGN.md (privacy rule in notifications, nothing shown before identity check, nothing filed on mismatch), FHIR validity, tests present. Comment with must-fix / nice-to-have. Approve when must-fix is empty. Do not push code to others' branches.

---

## Final integration — coordinator, from ~07:00

- [ ] **INT-1** On `main`: full stack, seed, `npm run e2e` green for R1, R2, M1–M3.
- [ ] **INT-2** `npm run metrics` → `docs/METRICS.md`.
- [ ] **INT-3** README "How to run" verified on a clean clone.
- [ ] **INT-4** `docs/MORNING-REPORT.md`: what works, what doesn't, known issues, exact demo commands.

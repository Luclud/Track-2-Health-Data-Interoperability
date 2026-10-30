# Task board — v2 add-ons

Read `AGENTS.md` first (including the **v2 rules** at its top). v1 is finished and frozen on `main`; everything here is built on the branch **`v2-addons`**.

**Why v2:** 12 teams build the same flow. v2 doesn't add breadth, it proves the three jury questions better than anyone else:
1. *Execution* — a judge becomes the outside person live, on their own phone (JURY).
2. *Technical quality and AI* — every AI-read value shows where it came from, and we publish a measured AI accuracy report (AI).
3. *Clinical approach and impact* — the doctor sees useful data, critical values are alerted, the process looks like something a clinic would run (CRIT, UI, REM, RCPT).

Out of scope: photo/scan input, OCR, new document types, real ID Austria, real email/SMS.

**Global definition of done** (same as v1): `npm run check` green, acceptance criteria met and tested, only own-lane files changed (plus your checkbox here), PR description with what / decisions / still missing. **PR base is always `v2-addons`.**

Time plan (Europe/Vienna): start ~06:00 · all P0 merged by ~08:30 · P1 by ~09:30 · **feature freeze 09:45** · integration and report by ~11:00.

---

## V2-BOOT — Coordinator, before the lanes start (≤ 30 min)

- [x] **V2-BOOT-1 Contracts + CI.** One PR titled `contract: v2`, merged into `v2-addons` before any lane starts (Dev UI may start V2-JURY-3 in parallel, it needs no contract).
  - CI already runs on `push` to `v2-addons` (done in the planning commit) — nothing to do.
  - `packages/shared/src/format.ts` (+ unit tests, export from the package index). Pure functions used by core and UI:
    - `formatValueDe(value, refLow?, refHigh?)` → German decimal comma; decimals = max(decimals of value, low, high) as written in numbers (INR 1 with range 0.8–1.2 → `"1,0"`, fibrinogen 3.1 → `"3,1"`, platelets 245 → `"245"`).
    - `unitDisplay(ucum)` → human unit: `10*9/L` → `10⁹/L`, `10*12/L` → `10¹²/L`, `{INR}`/annotations → `""`, otherwise unchanged.
    - `labNameDe(loinc, fallback)` → German name for known codes, else the fallback: 6301-6 INR · 14979-9 aPTT · 777-3 Thrombozyten · 3255-7 Fibrinogen · 718-7 Hämoglobin · 2160-0 Kreatinin · 1988-5 CRP · 2823-3 Kalium · 2951-2 Natrium · 6690-2 Leukozyten. FHIR `code.text` is **not** changed (stays as in the document); this is display only.
  - `packages/shared/src/api.ts`:
    - `FiledSummary` lab value gets `loinc?: string` and `critical?: { rule: string }` (e.g. `rule: "< 50"`).
    - `CreateRequestResponse.juryLink?: string` — set **only** when `JURY_MODE=true`.
    - `RequestDetailResponse.review?: HeldReview` (only while status is `held`):
      ```ts
      export interface HeldReview {
        method: "deterministic" | "llm";
        reason: HeldReason;
        patient: { given: string[]; family: string; birthDate?: string; evidence?: Evidence };
        values?: { testName: string; loinc?: string; value: number; unit: string; low?: number; high?: number; evidence: Evidence }[]; // lab
        excerpt?: string;      // rehab
        sourceText: string;    // the received document, as received
      }
      export interface Evidence { line: number; text: string } // 1-based line in sourceText that contains the value
      ```
    - `GET /api/ui-config` → `{ juryMode: boolean; llmEnabled: boolean }` (no auth needed; add the route in `api/routes.ts` in this contract PR).
  - `packages/shared/src/domain.ts`: `DocumentRequestView.reminderSentAt?: string`.
  - `packages/shared/src/audit.ts`: add step `"reminder-sent"` (extra, not one of the six challenge steps — make sure `scripts/metrics.ts` still checks exactly the six named steps).
  - `services/core/src/config.ts` + `.env.example`: `JURY_MODE` (default `false`), `REMINDER_BEFORE_EXPIRY_MINUTES` (default `1440`), `SCHEDULER_INTERVAL_SECONDS` (default `60`, `0` = off), `CRITICAL_VALUES_FILE` (default `infra/critical-values.json`).
  - `services/core/src/scheduler/index.ts`: `startScheduler(deps): () => void` stub that does nothing yet (Dev Outside fills it); start it in `server.ts`/`container.ts`, stop on close.
  - In `JURY_MODE` the core logs a loud startup warning: "JURY_MODE: Links werden auch an die Arzt-Oberfläche zurückgegeben. Nur für Demos."
  - Acceptance: `npm run check` green; all existing tests unchanged and green.

---

## Lane CORE — Dev Core
Owns: `services/core/src/{domain,parser,fhir,llm,audit,api,db}/**`, `infra/critical-values.json`, `scripts/ai-eval.ts`

- [ ] **V2-CRIT-1 (P0) Critical values.** `infra/critical-values.json` keyed by LOINC: `{ "777-3": { "low": 50, "high": 1000, "unit": "10*9/L" }, ... }` with a top-level `"note": "Demo-Grenzwerte (Panikwerte). Jede Klinik legt ihre eigenen fest."`. Start with: INR 6301-6 high 4.5 · aPTT 14979-9 high 100 s · Thrombozyten 777-3 low 50 / high 1000 10*9/L · Fibrinogen 3255-7 low 1.0 g/L · Hämoglobin 718-7 low 7 g/dL (convert if the fixture uses g/L) · Kalium 2823-3 low 2.8 / high 6.2 mmol/L · Kreatinin 2160-0 high 4.0 mg/dL. Only compare when the unit matches (after normalising); unknown unit → not critical, no crash.
  - On filing a lab result with ≥ 1 critical value: **before** the ✅ message post a separate Matrix message, severity `alert`: `🚨 Kritischer Wert – <Ref>: Thrombozyten 38 10⁹/L (kritisch < 50). Bitte zeitnah prüfen.` (one line per critical value, `@lena.hofer` mention in `html` if the request has a Matrix requester). Add the critical flag to `FiledSummary` (`critical.rule`). Record the critical values in the `answer-filed` audit details.
  - Tests: platelets 38 → alert + summary flag; scenario Maria → no alert; unit mismatch → no alert.
- [ ] **V2-CRIT-2 (P0) Useful ✅ message.** `chatFiled` gets an `html` version: small table Test (via `labNameDe`) · Wert (`formatValueDe`) · Einheit (`unitDisplay`) · Referenz · Flag (↑ / ↓ / 🚨). Plain `body` keeps one line per value. Rehab: unchanged plus the existing KI-Zusammenfassung if configured. Also return `loinc` in `FiledSummary`.
  - Tests: Maria → table contains `INR` `1,0`, `Thrombozyten` `245` `10⁹/L`; no English test names in `html`.
- [x] **V2-AI-1 (P0) Evidence for held answers.** When an answer is held (`ai-extracted` or `not-in-register`), store what is needed and return `RequestDetailResponse.review` (contract above): for each value the 1-based line of `sourceText` that literally contains it (reuse the number matching in `llm/verify.ts`, prefer the line that also contains the test name or LOINC); patient evidence likewise. Deterministic parses get evidence too (the table row).
  - Tests: `free-text-letter-not-in-format.md` via mock LLM → every value has evidence whose `text` contains the number; the evidence `line` points to that text in `sourceText`.
- [x] **V2-AI-2 (P0) Real-model readiness.** Anthropic provider: default model `claude-sonnet-5-5` (replace the old hard-coded name; `LLM_MODEL` still overrides), 20 s timeout, one retry on 429/5xx/timeout, any failure → the existing friendly "could not read" path, never filed, never a crash. Same timeout/retry for openai-compatible. If the session has a real `LLM_API_KEY` secret, run request 1 with a non-standard document end-to-end once and note the result in the PR; never print the key.
- [x] **V2-AI-3 (P0) AI evaluation report.** `scripts/ai-eval.ts` + npm script `ai:eval`: forces the LLM path (skips the deterministic parser) for every document in `tests/fixtures/documents/` and `scenario/documents/` that has an `*.expected.json`; compares with the expectation; then a **hallucination trap**: for each document, take the model output, change one value to a number that is not in the source, and assert that verification rejects it. Writes `docs/AI-EVAL.md`: provider + model, date, per document (values correct / wrong / rejected by verification, patient correct), totals, and the line "Werte ohne Beleg im Original abgelegt: 0". With `LLM_PROVIDER=mock` it still runs and the report says **MOCK** in the title so nobody mistakes it for a real result.
  - Acceptance: `npm run ai:eval` works offline with mock; with a real key it produces the real report.

## Lane OUTSIDE — Dev Outside
Owns: `services/core/src/{portal,eid,notify,register,scheduler}/**` (except `notify/privacy.ts` — do not weaken it)

- [x] **V2-JURY-2 (P0) Portal on a judge's phone.** Check the whole outside flow works behind an https tunnel (`PUBLIC_BASE_URL=https://…`): eID redirect, callback, signed cookies (`secure` already follows the base URL), absolute links. Mock eID page: the "andere Person" form must be comfortable on a 360 px phone (big inputs, date picker, name prefilled? **no** — the judge types their own name). Only when `JURY_MODE=true`, the answer page shows two small demo buttons under the textarea: `Beispielbefund einsetzen (Demo)` (fills the textarea with the scenario lab result for the requested patient) and `Beispiel: falsche Patientin (Demo)` (fills the Max Beispiel document, to trigger M3 live). Clearly labelled "Demo", hidden when `JURY_MODE` is off.
  - Tests: buttons absent by default, present in jury mode; the inserted text parses to the requested patient / the wrong one.
- [x] **V2-RCPT-1 (P1) Receipt for the sender.** Result pages for filed and held show an "Eingangsbestätigung" box: Referenz, eingegangen am (Vienna time), Absender (verified e-ID name), Prüfsumme SHA-256 of the received document (first 16 hex chars, full value in a `<details>`), and a `Bestätigung drucken / als PDF speichern` button (`window.print()` with a print stylesheet that shows only the receipt). No medical content in the receipt.
  - Tests: hash equals sha256 of the submitted text; button present.
- [ ] **V2-REM-1 (P1) Reminders and active expiry.** Fill `startScheduler`: every `SCHEDULER_INTERVAL_SECONDS`:
  - For requests in `sent | opened | identity-failed` with `now ≥ expiresAt − REMINDER_BEFORE_EXPIRY_MINUTES` and no `reminderSentAt`: **rotate the link token** (new token, new hash, old link now shows the "abgelaufen/ersetzt" page), send a reminder through the same channel with a privacy-clean template (`Erinnerung: … Ref. … gültig bis …`, goes through `assertNotificationIsClean`), set `reminderSentAt`, audit `reminder-sent`, Matrix info `🔔 Erinnerung an <Name> gesendet (<Ref>)`.
  - Due requests become `expired` actively (not only on read) and Matrix gets one `⌛ <Ref> abgelaufen – keine Antwort von <Name>.` message.
  - Needs an `expireIfDue`/`listOpen` hook in the domain: ask Dev Core / the coordinator under "Requests for other lanes" or add a small method in your own module using the repository port.
  - Tests with a fake clock: reminder sent once; old token invalid, new one works; privacy guard passes; expiry message once.

## Lane UI — Dev UI + Matrix + infra
Owns: `apps/doctor-ui/**`, `services/core/src/chat/**`, `infra/**` (except `infra/critical-values.json`), `scripts/demo.sh`, `scripts/jury.sh`, `docs/JURY-DEMO.md`

- [x] **V2-JURY-3 (P0, start immediately) Tunnel script.** `scripts/jury.sh`: like `demo.sh` (stack up → seed → ui build), then starts a Cloudflare quick tunnel to `:3000` (`cloudflared tunnel --url http://localhost:3000`; if `cloudflared` is missing, download the static binary for the OS/arch into `~/.cache/brieftaube/` — print the manual install command if that fails), reads the `https://….trycloudflare.com` URL from its output, starts core with `PUBLIC_BASE_URL=<that URL> JURY_MODE=true CHAT_MODE=matrix AUTH_MODE=matrix MAIL_MODE=smtp`, prints all URLs and a terminal QR of the base URL (`npx qrcode-terminal` or similar, optional). Flag `--lan`: no tunnel, `PUBLIC_BASE_URL=http://<LAN IP>:3000` (for a phone on the same Wi-Fi / hotspot). Ctrl-C stops core and the tunnel.
  - `docs/JURY-DEMO.md`: 1-page pitch script — before the pitch (start, test once with your own phone), during (ask the judge's name → Jury-Schnellauswahl → QR → judge answers → Element shows ✅ table; optional second judge uses the "falsche Patientin" button → 🛑), fallbacks (tunnel down → `--lan` with phone hotspot → pre-recorded video).
  - If the Devin machine cannot reach Cloudflare, test the `--lan` path and document that the tunnel path is untested.
- [x] **V2-JURY-1 (P0) QR in the doctor UI.** Read `GET /api/ui-config`. When `juryMode`: a `Jury-Schnellauswahl` button in the new-request form (patient Maria Beispiel, Laborbefund, channel email, address `jury@demo.example`, focus on the recipient name field). After sending, if the response has `juryLink`, show a modal with a big QR code (add `qrcode` as a doctor-ui dependency, render to canvas/SVG), the link as text, and the note `Nur Jury-Modus: Im echten Betrieb geht dieser Link ausschließlich per E-Mail/SMS an die Empfängerin.` Works in the widget and standalone.
- [x] **V2-UI-1 (P0) Readable values + held review.** Use `@brieftaube/shared` format helpers everywhere values appear (requests list, detail, standalone timeline): German test names, `1,0`, `10⁹/L`; critical rows red with 🚨 and the rule as tooltip/subtitle. Held detail: badge `KI-gelesen – bitte prüfen` (or `Nicht in der Ärzteliste – bitte prüfen`), two panes (stacked on narrow widths): extracted values / original document (`review.sourceText`, monospace, line numbers); tapping a value highlights and scrolls to its evidence line. Existing release/reject buttons stay.
- [ ] **V2-UI-2 (P1) Status board.** Requests panel grouped with counters: `Zur Prüfung` (held) · `Wartet auf Antwort` (sent/opened/verified/identity-failed, with "läuft ab in 5 h" and 🔔 if `reminderSentAt`) · `Problem` (rejected, expired) · `Abgelegt`. Problem and Zur Prüfung on top. `!brieftaube status` in the room uses the same groups (P2).

## Lane TEST — Tester
Owns: `tests/**`, `scripts/metrics.ts`, `scripts/validate-fhir.ts`, `.github/workflows/**` (after V2-BOOT), `docs/METRICS.md`

- [x] **V2-TEST-1 (P0, first) New fixtures.** In `tests/fixtures/documents/` with `*.expected.json`: (a) `lab-critical-platelets-inr.md` standard format, platelets 38 and INR 5.2 for Maria; (b) `lab-prose-letter-de.md` German prose letter ("Die Thrombozyten lagen bei 245 G/l …", decimal commas, German date) — LLM path; (c) `lab-bullet-list-de.md` values as a bullet list with German names — LLM path; (d) `rehab-other-headings.md` rehab report from another clinic with different headings. Same synthetic patient data as the scenario.
- [x] **V2-TEST-2 (P0) e2e for v2.** Extend `tests/e2e/` (keep all v1 tests): critical fixture → 🚨 message before ✅ and `critical` in summary; held review has evidence for every value (mock LLM in e2e); jury mode returns `juryLink`, default mode doesn't; demo buttons only in jury mode; receipt hash correct; reminder with `REMINDER_BEFORE_EXPIRY_MINUTES` large and `SCHEDULER_INTERVAL_SECONDS=1` → new link works, old link doesn't, SMS/email pass the privacy guard. UI e2e: QR modal visible in jury mode; lab table shows `1,0` and `10⁹/L`.
- [ ] **V2-TEST-3 (P1) Metrics.** `npm run metrics` on `v2-addons` still reports the four challenge metrics (six audit steps by name, `reminder-sent` not counted), plus a short "KI-Auswertung" line linking `docs/AI-EVAL.md`. Regenerate `docs/METRICS.md`.
- [ ] **V2-TEST-2 (P0) e2e for v2.** Extend `tests/e2e/` (keep all v1 tests): critical fixture → 🚨 message before ✅ and `critical` in summary; held review has evidence for every value (mock LLM in e2e); jury mode returns `juryLink`, default mode doesn't; demo buttons only in jury mode; receipt hash correct; reminder with `REMINDER_BEFORE_EXPIRY_MINUTES` large and `SCHEDULER_INTERVAL_SECONDS=1` → new link works, old link doesn't, SMS/email pass the privacy guard. UI e2e: QR modal visible in jury mode; lab table shows `1,0` and `10⁹/L`.
- [x] **V2-TEST-3 (P1) Metrics.** `npm run metrics` on `v2-addons` still reports the four challenge metrics (six audit steps by name, `reminder-sent` not counted), plus a short "KI-Auswertung" line linking `docs/AI-EVAL.md`. Regenerate `docs/METRICS.md`.

---

## Final integration — coordinator, from 09:45

- [ ] **V2-INT-1** On `v2-addons`: full stack, seed, `npm run e2e` + `npm run e2e:ui` green (v1 + v2 tests), both Element and standalone paths.
- [ ] **V2-INT-2** `npm run ai:eval` (real model if a key is available, else mock) and `npm run metrics`.
- [ ] **V2-INT-3** Try `scripts/jury.sh` (tunnel) and `scripts/jury.sh --lan`; note what worked.
- [ ] **V2-INT-4** README: section "Neu in v2 / New in v2" (what, why, how to run jury mode), update "What works and what doesn't" honestly. `docs/V2-REPORT.md`: what works (exact commands), what doesn't, known issues, metric + AI-eval results, open PRs.
- [ ] **V2-INT-5** Open (do **not** merge) a PR `v2-addons → main` titled `v2 add-ons (review before merge)` with the report as description. A human decides in the morning.

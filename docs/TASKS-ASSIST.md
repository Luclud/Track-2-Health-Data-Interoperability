# Task board — KI-Hilfe für Absender (sender assist)

Read `AGENTS.md` first. This is a **small add-on for the demo video**, built by **one agent** on the branch **`assist`** (created from `v2-addons`). It overrides the v2 rules only where stated here.

## Why

Today the sending doctor (lab, rehab clinic, GP) has to find the right document in their own archive by hand. With this add-on, a sender who **opts in** ticks a checkbox in the upload form and gets help: an AI goes through their local archive, lists the documents by importance for *this* request (e.g. "Unterschenkelfraktur links – Gerinnung vor OP") and says why. The doctor picks one; only that one is sent.

**Product story (say it this way in UI and docs):** in real use the model runs **locally at the sender** (e.g. Ollama on the practice PC), so no document leaves the practice before the doctor presses „Sicher senden“. **For the prototype** the archive is a synthetic demo folder on our server and the ranking comes from a precomputed mock, or from Claude if an API key is configured. The UI says so honestly.

It's a prototype for a 2-minute video: **fake what you can, but the click path must really work end to end** (checkbox → ranked list → pick → form filled → „Sicher senden“ → filed, ✅ in Matrix).

## Rules for this add-on

- Branch `assist` (already exists, contains this file). Work **directly on `assist`**, push often. At the end open **one PR `assist → v2-addons`** and **never merge it** — a human decides. Never touch `main`, `v1-frozen`, `v2-addons` directly.
- You are the only agent: you may change any file you need, including `services/core/src/config.ts` and `.env.example` (normally contract-frozen). Keep changes small.
- All existing tests stay green (`npm run check`, and `npm run e2e:ui` if you can run it). The normal upload flow without the checkbox must behave exactly as before.
- Privacy rule unchanged: the panel exists only after a successful e-ID check (same session check as the answer page). Emails/SMS are not touched.
- No new dependencies. No client-side framework: the portal is server-rendered HTML; a few lines of inline JS are fine, but everything must also work via plain links.
- **Hard stop 14:00 Europe/Vienna.** Whatever state you are in: push, open the PR (draft if not green), write the status in the PR description, stop.

---

## ASSIST-1 (P0) Demo archive + ranking

Files: `scenario/sender-archive/**`, `services/core/src/portal/assist.ts` (+ `assist.test.ts`).

- `scenario/sender-archive/`: synthetic documents in the same Markdown format as `scenario/documents/` (English content like the existing documents), each with a `Patient:` line:
  1. `labor-gerinnung-2026-10-22.md` — copy of `scenario/documents/lab-result-maria-beispiel.md` (the one that must win for a lab request).
  2. `labor-gerinnung-2024-03-05.md` — older clotting panel, same format, different values and dates.
  3. `labor-blutbild-2026-09-14.md` — blood count (haemoglobin, leukocytes, platelets), same format.
  4. `rehab-entlassungsbericht.md` — copy of `scenario/documents/rehab-report-maria-beispiel.md` (wins for a rehab request).
  5. `rechnung-2026-10.md` — an invoice, no medical values.
  6. `labor-andere-patientin.md` — lab report of **Erika Musterfrau, born 2 February 1975** (other patient).
  7. `labor-namensgleich.md` — lab report with the request patient's name but birth date **1 January 1990** (namesake).
  Documents 1–5 are "own patient" documents: when loading, set their `Patient:` line to the request's patient (reuse `withPatient`/`englishDate` from `portal/demo.ts`, export them if needed), so the demo works for any seeded or jury patient. Document 7 gets the request patient's name with the 1990 birth date.
- `ranking.mock.json` in the same folder, keyed by document type (`lab-result`, `rehab-discharge-report`): for each document an `importance` (`hoch` | `mittel` | `niedrig` | `nicht relevant`), a one-sentence German `reason`, and an `evidence` string that literally occurs in that document. Lab request: 1 hoch (current clotting values before surgery), 2 mittel (older baseline), 3 mittel/niedrig, 4 niedrig, 5 nicht relevant. Rehab request: 4 hoch, others lower.
- `assist.ts` exports `rankArchive(view, llm?, opts?) → Promise<AssistResult>`:
  ```ts
  interface AssistItem { id: string; title: string; date?: string; importance: "hoch" | "mittel" | "niedrig" | "nicht relevant"; reason: string; evidence?: { line: number; text: string }; verified: boolean }
  interface AssistResult { source: "mock" | "llm"; model?: string; items: AssistItem[]; hiddenOtherPatients: number }
  ```
  1. **Patient filter without AI:** a document whose `Patient:` line doesn't match the request patient's given name, family name **and** birth date is removed and only counted in `hiddenOtherPatients` (documents 6 and 7). Reuse the matching helpers in `portal/demo.ts` / `llm/verify.ts`.
  2. **Ranking:** if an LLM is configured (`config.llmProvider` is `anthropic`, `perplexity` or `openai-compatible`), ask it once with the request's document type, the doctor's `note` and the remaining documents; JSON schema = `{ items: [{ id, importance, reason, evidence }] }`, reasons in German. Use the existing `LlmClient.completeJson({ system, user, jsonSchema, schemaName })` (`services/core/src/ports.ts`) from the container — no new client code. `MockLlmClient` doesn't count as a configured LLM here: use the mock file. Timeout 20 s; on error, timeout or invalid output → fall back to the mock (`source: "mock"`). Without an LLM → mock.
  3. **Evidence check:** `evidence` must literally occur in the document; set `evidence.line` (1-based) and `verified: true`, else drop the evidence and set `verified: false`.
  4. Sort by importance, then date (newest first). Cache the result per request id in memory (so the video doesn't wait twice).
- Tests (no network): mock ranking for a lab request puts document 1 first; documents 6 and 7 never appear, `hiddenOtherPatients === 2`; works for another patient name (jury patient); fake LLM with a wrong evidence string → `verified: false`; fake LLM that throws → `source: "mock"`.

## ASSIST-2 (P0) Checkbox and panel in the upload form

Files: `services/core/src/portal/{views.ts,routes.ts,portal.css}`, `services/core/src/config.ts`, `.env.example`, `scripts/demo.sh`, `scripts/jury.sh`.

- Config `SENDER_ASSIST` (default `false` in `config.ts`; `.env.example`, `scripts/demo.sh` and `scripts/jury.sh` set it to `true`). When `false` the answer page is byte-for-byte as before (test it).
- In the „Dokument“ section of `answerPage`, above the file input, a checkbox **„KI-Hilfe: passende Dokumente aus meiner Ablage vorschlagen“** with the hint „Optional. Läuft im Echtbetrieb lokal in Ihrer Praxis – Dokumente verlassen die Praxis erst mit „Sicher senden“.“ Ticking it navigates to `GET /r/:token/answer?assist=1#assist` (inline `onchange`; also a `<noscript>` link).
- `GET /r/:token/answer?assist=1` (same session check as the answer page; without session → same behaviour as today) renders the page with the checkbox ticked and a panel `#assist`:
  - Header line with a badge: `source: "llm"` → „KI: <model> (Demo über Cloud, nur synthetische Daten)“; `source: "mock"` → „KI-Vorschlag (Demo, MOCK)“. Below, small: „Im Echtbetrieb: lokales Modell, z. B. Ollama, auf dem Praxis-Rechner.“
  - The request's note, if any: „Gesucht für: <note>“.
  - One row per item: importance badge (hoch = strong colour, nicht relevant = grey), title + date, reason, the evidence line in a quote style (or „nicht belegt“ if `verified: false`), and a link **„Übernehmen“** → `?assist=1&pick=<id>#content`.
  - Footer: „<n> Dokumente anderer Patient:innen ausgeblendet – werden nie angezeigt oder gesendet.“ (only if n > 0).
  - Loading takes up to 20 s with a real LLM: render the page directly (server-side await is fine), no spinner needed.
- `?assist=1&pick=<id>`: page rendered with patient fields prefilled from the request (like the jury demo buttons do), the textarea filled with that document's content, and a notice „Vorschlag übernommen: <title>. Bitte prüfen Sie das Dokument und senden Sie es dann.“ Unknown id → panel with an error line, nothing filled. The doctor still presses „Sicher senden“ — **nothing is sent automatically**. All existing checks (patient match, document type, FHIR) run unchanged on submit.
- Phone-friendly (the jury opens it on a phone): rows stack, no horizontal scroll.
- Tests (`portal.test.ts` style): checkbox absent when `SENDER_ASSIST=false`; present when true; `?assist=1` without session shows no patient data; with session shows document 1 first and the hidden count 2; `pick=<doc 1>` fills the textarea; submitting that form files the result (status `filed`).

## ASSIST-3 (P1) Video path test + docs

Files: `tests/e2e/ui/assist.spec.ts`, `docs/JURY-DEMO.md`, `README.md`.

- Playwright (phone viewport, like `outside-person.spec.ts`): open the link → e-ID → tick the checkbox → document 1 is first → „Übernehmen“ → „Sicher senden“ → „gesendet“ page. Skip with a clear message if `SENDER_ASSIST` isn't on.
- `README.md`: a short section „Optional: KI-Hilfe für Absender“ (5–8 lines: what it does, opt-in, real use = local model, prototype = mock/Claude on synthetic data, the patient filter).
- `docs/JURY-DEMO.md`: a 20-second video beat: Dr. Hofer requests the lab result with the note „Unterschenkelfraktur links, OP geplant – bitte aktuelle Gerinnung“ → the lab doctor ticks KI-Hilfe → sees the ranked list and „2 Dokumente anderer Patient:innen ausgeblendet“ → Übernehmen → Sicher senden → ✅ in Matrix.

## ASSIST-4 (P2, only if everything above is green before 13:30) Doctor sees it was assisted

- Hidden field `assisted=1` on a form prefilled via `pick`; recorded as `senderAssist: true` in the `answer-filed` audit details (no file list, no titles) and one extra line in the ✅ Matrix message: „Absender hat die KI-Hilfe genutzt; Auswahl vom Absender bestätigt.“ Skip if it needs more than ~15 min.

---

## Definition of done

`npm run check` green · ASSIST-1 and ASSIST-2 acceptance met with tests · normal flow unchanged · PR `assist → v2-addons` open with: what works, what is faked (archive on server, mock ranking), decisions, still missing, and the exact commands to run the demo with and without a Claude key.

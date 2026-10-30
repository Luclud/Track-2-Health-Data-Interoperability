# Brieftaube 🕊️

**Secure document requests from the PGK/Matrix network to people outside it — answered in the browser, filed as FHIR R4.**

AIM Austria Hackathon 2026 · Track 2: Health Data Interoperability. All data in this repository is synthetic.

> Status: **v1 complete** (see [`docs/MORNING-REPORT.md`](docs/MORNING-REPORT.md)), **v2 add-ons** on top (see [Neu in v2](#neu-in-v2--new-in-v2) and [`docs/V2-REPORT.md`](docs/V2-REPORT.md)).

## The problem

Dr. Lena Hofer works inside PGK, a closed document network on Matrix. The lab, the rehab clinic and the patient are outside it. Today their results arrive by fax or unencrypted email and someone types them in by hand.

## What Brieftaube does

1. Dr. Hofer requests a document from a **widget in her Matrix room** (Element Web).
2. The outside person gets a **neutral email or SMS** — no patient name, no birth date, no document type — with a single-use link.
3. They **prove who they are with ID Austria** (simulated) in the browser. No account, nothing to install.
4. Only then do they see which patient and which document is requested, and answer with a short form plus the file.
5. Brieftaube checks that the **answer is about the right patient**, turns it into **FHIR R4** (Observations with LOINC codes, DiagnosticReport or DocumentReference, Provenance), stores it on the FHIR server and **tells Dr. Hofer in Matrix**.
6. Every step is **audited**; misdeliveries (wrong address, forwarded email, wrong patient) are caught and reported.

## Neu in v2 / New in v2

v2 answers three questions a jury asks after the v1 demo. Plan and acceptance criteria: [`docs/TASKS-V2.md`](docs/TASKS-V2.md); results: [`docs/V2-REPORT.md`](docs/V2-REPORT.md).

**1. "Can I be the outside person, on my own phone, now?"**
- `scripts/jury.sh` starts everything plus a Cloudflare quick tunnel, so the outside portal has a public `https://….trycloudflare.com` URL. `scripts/jury.sh --lan` uses `http://<LAN IP>:3000` instead (phone on the same Wi-Fi or the laptop's hotspot). Step-by-step guide and fallbacks: [`docs/JURY-DEMO.md`](docs/JURY-DEMO.md).
- With `JURY_MODE=true` (set by `jury.sh`, off by default): `Jury-Schnellauswahl` in the request form, and after sending a **QR code** of the link in the doctor UI (in normal operation the link only goes out by email/SMS). The answer page shows two labelled demo buttons (`Beispielbefund einsetzen (Demo)`, `Beispiel: falsche Patientin (Demo)` to trigger M3 live). The simulated ID Austria page is comfortable on a 360 px phone; the judge types their own name.

**2. "Why should I trust values an AI read?"**
- Held answers (AI-read, or sender not in the physician register) show **evidence**: every extracted value is linked to the line of the original document that contains it, side by side in the doctor UI.
- `npm run ai:eval` forces the AI path on every fixture with an expectation, compares the result and runs a **hallucination trap** (one value changed to a number that is not in the source must be rejected). Report: [`docs/AI-EVAL.md`](docs/AI-EVAL.md). Real run: `LLM_PROVIDER=anthropic LLM_API_KEY=… npm run ai:eval`; without a key the report is titled **MOCK**.
- Anthropic provider defaults to `claude-sonnet-5-5`, with a 20 s timeout and one retry; any failure ends in the friendly "could not read" path and is never filed.

**3. "Does this help on a ward?"**
- **Critical values:** `infra/critical-values.json` (demo panic limits per LOINC, each clinic sets its own) → a 🚨 message in the room before the ✅ message.
- **Readable values:** the ✅ message has a table (German test names, `1,0`, `10⁹/L`, reference range, ↑ ↓ 🚨), the doctor UI uses the same formatting.
- **Status board:** `Problem` · `Zur Prüfung` · `Wartet auf Antwort` (with "läuft ab in …" and 🔔 after a reminder) · `Abgelegt`, with counters; `!brieftaube status` uses the same groups.
- **Reminders and expiry:** one reminder before the link expires, with a new link (the old one stops working) and an extended deadline; expired requests are closed actively. Notifications still pass the privacy guard. Settings: `REMINDER_BEFORE_EXPIRY_MINUTES`, `SCHEDULER_INTERVAL_SECONDS`.
- **Eingangsbestätigung:** the sender gets a printable receipt (reference, time, verified sender, SHA-256 of the document), without medical content.

Jury mode in short: `scripts/jury.sh` (or `scripts/jury.sh --lan`), open the printed doctor URL on the laptop, press `Jury-Schnellauswahl`, enter the judge's name, send, let the judge scan the QR code.

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the diagram, ports, lifecycle and state machine.

| Component | What | Tech |
|---|---|---|
| Doctor UI | Matrix widget (inside Element) and standalone website from one codebase | React, Vite, matrix-widget-api |
| Brieftaube core | Request service, outside portal, mock ID Austria, SMS simulator, parser, FHIR builders, audit | Node 22, TypeScript, Fastify, SQLite |
| Matrix | Closed network `klinikum.example` | Synapse, Element Web |
| FHIR server | Filed resources, Task, AuditEvent | HAPI FHIR R4 |
| Email (test) | Catches all mail | Mailpit |
| LLM (optional) | Fallback reader for documents the deterministic parser can't read; output verified, never auto-filed | Anthropic / Perplexity / any OpenAI-compatible or clinic-hosted model |

Every external product sits behind an interface in `services/core/src/ports.ts` and can be replaced (e.g. FTAPI for mail, real ID Austria for the eID, any FHIR server).

## How to run

Requirements: Docker, Node 22, Java 17+ (only for the FHIR validator).

```bash
cp .env.example .env
npm install
npm run stack:up                 # Synapse :8008, Element :8080, HAPI :8090, Mailpit :8025
bash infra/wait-for-stack.sh     # waits until all four answer (first start pulls images)
npm run seed                     # creates Dr. Hofer, the bot, the room with the widget, the patient
npm run ui:build
CHAT_MODE=matrix AUTH_MODE=matrix npm start   # core on :3000 (Element widget path)
```

One command for the same: `scripts/demo.sh`. For the standalone website without Element, `CHAT_MODE=matrix npm start` (default `AUTH_MODE=dev`) is enough; `CHAT_MODE=memory` works without Synapse.

- Element: http://localhost:8080 — user `lena.hofer`, password `demo-lena-2026`
- Standalone doctor website: http://localhost:3000/widget/?mode=standalone
- Mailpit: http://localhost:8025 · SMS simulator: http://localhost:3000/dev/sms · HAPI: http://localhost:8090/fhir

Checks: `npm run check` (typecheck, unit tests, HL7 validation) · `npm run e2e` (full scenario against the stack, core with `AUTH_MODE=dev`) · `npx playwright install --with-deps chromium && npm run e2e:ui` (phone-sized outside-person flow + standalone doctor UI) · `npm run metrics` (writes [`docs/METRICS.md`](docs/METRICS.md)).

## Your design (challenge questions)

1. **How does an outside person prove who they are if they are in no directory?**
   Two factors: possession of a single-use, expiring link sent to the one contact Dr. Hofer knows, **and** an eID login (ID Austria, simulated) whose verified name must match the person Dr. Hofer named. Physicians are additionally checked against the physician register (simulated Ärzteliste). Nothing about the patient is shown before this check passes.
2. **Which identity check do you require for each type of document and why?**
   Lab result: eID (level of assurance high) + name match + physician register, because lab values drive immediate clinical decisions and are validated by a physician who can be checked publicly. Rehab discharge report: eID (high) + name match; the sender is a discharge manager (not in a physician register), and the authoring physician is recorded from the document as author. Details: [`docs/DESIGN.md`](docs/DESIGN.md) §1.
3. **Which FHIR resources do you create and how do they reference each other and the patient?**
   A `Task` per request. Lab result: `Observation`s (LOINC, UCUM, reference range, interpretation) referenced by a `DiagnosticReport` (original attached), with `Practitioner` and `Organization` as performer. Rehab report: `DocumentReference` with the Markdown attached, author `Practitioner` + `Organization`. Always one `Provenance` targeting all filed resources: author, verified sender, our service, the identity check as signature and policy. `AuditEvent`s for the six steps. Everything references `Patient/maria-beispiel`. Details and golden examples: [`docs/FHIR-MAPPING.md`](docs/FHIR-MAPPING.md), [`fhir-examples/`](fhir-examples/).
4. **How do you notice a misdelivery?**
   Wrong or forwarded address: the verified eID name doesn't match the named recipient → nothing shown, nothing accepted, Dr. Hofer warned (plus a pre-send warning for suspicious addresses such as `labor-kanaI`). Wrong patient: the patient name and birth date in the form **and** in the document must both match the request → otherwise not filed, Dr. Hofer alerted in Matrix. Wrong document type is rejected too.
5. **Where does your service run?**
   At the clinic, next to its own Matrix homeserver. Each clinic can run its own instance; the data stays with whoever produced it, and no third party sees patient data. The outside side needs only a browser.

## Metrics on the scenario

Generated by `npm run metrics` from real runs of `npm run e2e` and `npm run e2e:ui` on `v2-addons` (details: [`docs/METRICS.md`](docs/METRICS.md)).

| Metric | Target | Result |
|---|---|---|
| FHIR validation errors | 0 | **0** (HL7 validator; every resource the scenario filed, read back from HAPI, plus the golden examples) |
| Outside person: installs / accounts / time | 0 / 0 / < 2 min | **0 / 0 / 0.4 s** at scripted speed (Playwright, phone viewport; a human adds reading time) |
| Misdeliveries caught | 3 of 3 | **3 of 3** (M1 wrong address, M2 forwarded link, M3 wrong patient) |
| Audit coverage | 6 of 6 | **6 of 6** (who / what / when per step, also mirrored as FHIR `AuditEvent`) |

## What works and what doesn't

**Works (covered by `npm run e2e` / `npm run e2e:ui` against the real stack):**
- Request 1 by email and request 2 by SMS from the doctor UI (Element widget or standalone website); notifications contain no patient data (privacy guard on every email/SMS).
- Outside person: link → ID Austria login (simulated) → answer form → "gesendet", on a phone, without installing anything or creating an account.
- Lab result filed as `DiagnosticReport` + 4 `Observation`s (LOINC, UCUM, reference ranges, H/L) + `Provenance`; rehab report filed as `DocumentReference`; both mirrored to HAPI; 0 validator errors.
- M1 (pre-send address warning + eID name mismatch), M2 (forwarded link → blocked, nothing shown), M3 (wrong patient in form or document → not filed); Dr. Hofer is alerted in the Matrix room each time.
- Physicians not in the (simulated) register and AI-read documents are **held**, not filed, until Dr. Hofer releases or rejects them (API `POST /api/requests/:id/release|reject`).
- Doctor auth: Matrix OpenID token from the widget verified at Synapse (`AUTH_MODE=matrix`), or `X-Dev-User` for the standalone demo (`AUTH_MODE=dev`).
- Six-step audit trail (SQLite + `data/audit.jsonl` + FHIR `AuditEvent`), `!brieftaube status` bot command.
- v2 (also covered by `npm run e2e` / `npm run e2e:ui`): critical-value 🚨 message, values table in the ✅ message, evidence for held answers, jury link only in jury mode, demo buttons only in jury mode, receipt with correct SHA-256, reminder with link rotation (new link works, old one doesn't), QR modal, German value formatting, status board.
- `scripts/jury.sh` (tunnel) and `scripts/jury.sh --lan` were run on a Linux VM: the jury link used the public `https://….trycloudflare.com` URL (or the LAN IP) and the outside portal loaded through it.

**Doesn't / simulated:**
- ID Austria, the physician register (Ärzteliste), email delivery (Mailpit) and SMS (simulator page) are simulated; no real external service is called.
- The LLM fallback for documents outside the standard format is implemented and unit-tested with a mock provider, but was not run against a real LLM (no key configured). Without a key, such documents are rejected with a friendly message.
- The Element path needs a one-time widget permission click; the standalone website needs none.
- The AI evaluation in [`docs/AI-EVAL.md`](docs/AI-EVAL.md) is a **MOCK** run (no LLM key was available): it proves the measurement and the verification, not the reading quality of a real model.
- The jury flow was not tried on a physical phone in this run. Quick tunnels have no uptime guarantee and a fresh `trycloudflare.com` name can take ~30 s to resolve; `--lan` is the fallback.
- `jury.sh` starts the core with `AUTH_MODE=matrix`; `npm run e2e` expects the default core (`npm run dev`, `AUTH_MODE=dev`).

## Repository map

```
apps/doctor-ui/        React widget + standalone website
services/core/         Fastify service (api, portal, eid, notify, chat, domain, parser, fhir, llm, audit, db)
packages/shared/       Contracts shared by UI, core and tests
infra/                 docker-compose, Synapse/Element config, mock register + eID personas
fhir-examples/         Golden FHIR resources (target shapes, validated)
scenario/              Challenge scenario (patient, documents, misdelivery tests)
tests/                 Fixtures, e2e (API + Playwright)
scripts/               seed, FHIR validation, metrics
docs/                  Plan, architecture, design, FHIR mapping, tasks, agent prompts
```

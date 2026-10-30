# Brieftaube 🕊️

**Secure document requests from the PGK/Matrix network to people outside it — answered in the browser, filed as FHIR R4.**

AIM Austria Hackathon 2026 · Track 2: Health Data Interoperability. All data in this repository is synthetic.

> Status: **v1 under construction.** The plan, contracts and golden FHIR examples are in place; the implementation is being built from `docs/TASKS.md`. Sections marked _(TBD)_ are filled in when the features land.

## The problem

Dr. Lena Hofer works inside PGK, a closed document network on Matrix. The lab, the rehab clinic and the patient are outside it. Today their results arrive by fax or unencrypted email and someone types them in by hand.

## What Brieftaube does

1. Dr. Hofer requests a document from a **widget in her Matrix room** (Element Web).
2. The outside person gets a **neutral email or SMS** — no patient name, no birth date, no document type — with a single-use link.
3. They **prove who they are with ID Austria** (simulated) in the browser. No account, nothing to install.
4. Only then do they see which patient and which document is requested, and answer with a short form plus the file.
5. Brieftaube checks that the **answer is about the right patient**, turns it into **FHIR R4** (Observations with LOINC codes, DiagnosticReport or DocumentReference, Provenance), stores it on the FHIR server and **tells Dr. Hofer in Matrix**.
6. Every step is **audited**; misdeliveries (wrong address, forwarded email, wrong patient) are caught and reported.

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
npm run stack:up        # Synapse :8008, Element :8080, HAPI :8090, Mailpit :8025
npm run seed            # creates Dr. Hofer, the bot, the room with the widget, the patient
npm run ui:build
CHAT_MODE=matrix npm start   # core on :3000
```

- Element: http://localhost:8080 — user `lena.hofer`, password `demo-lena-2026`
- Standalone doctor website: http://localhost:3000/widget/?mode=standalone
- Mailpit: http://localhost:8025 · SMS simulator: http://localhost:3000/dev/sms · HAPI: http://localhost:8090/fhir

Checks: `npm run check` (typecheck, unit tests, HL7 validation) · `npm run e2e` (full scenario against the stack) · `npm run metrics`.

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

## Metrics on the scenario _(TBD — generated by `npm run metrics`, see `docs/METRICS.md`)_

| Metric | Target | Result |
|---|---|---|
| FHIR validation errors | 0 | _TBD_ |
| Outside person: installs / accounts / time | 0 / 0 / < 2 min | _TBD_ |
| Misdeliveries caught | 3 of 3 | _TBD_ |
| Audit coverage | 6 of 6 | _TBD_ |

## What works and what doesn't _(TBD)_

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

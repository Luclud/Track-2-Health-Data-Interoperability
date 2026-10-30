# Brieftaube: from secure requests to a patient-controlled network

> **Pitch:** Brieftaube gets outside lab results and rehab reports safely into the chart, and shows why the next step is a network where the patient, not another doctor, releases records.

AIM Healthcare Hackathon 2026, Vienna · Track 2, case by FTAPI · **All data is synthetic.**
**Built** = working, tested · **Simulated** = stand-in service · **Vision** = not built.

## The problem

Dr. Lena Hofer works inside PGK, the closed Matrix network in FTAPI's case brief (Matrix is an open standard for secure messaging). Labs, rehab clinics and patients are outside it, so results still come by fax or plain email and are typed in by hand, although Austria has been [phasing out fax for health data since 2025](https://aekwien.at/documents/d/wien/241128_bmsgpk_rechtliche-rahmenbedingungen-der-faxablose).

- Only about 10% of family doctors in Europe share clinical information digitally with other providers ([European Commission, EHDS impact assessment, 2022](https://health.ec.europa.eu/system/files/2022-05/ehealth_ehds_2022ia_4_en.pdf)).

## What we built: Brieftaube in 6 steps

1. **Built:** Dr. Hofer requests a document from a widget in her Matrix room.
2. **Built:** the lab (email) or rehab clinic (SMS) gets a neutral link: no patient name, birth date or document type. Delivery is **Simulated**.
3. **Simulated:** they prove who they are with ID Austria in the browser. No install, no account.
4. **Built:** only then do they see the request and answer with a form plus the file.
5. **Built:** Brieftaube checks the patient and files the answer as FHIR R4 (the standard health-data format) with Provenance (a record of who sent it and how they were checked). It notifies Dr. Hofer in Matrix, with a values table and critical-value alerts.
6. **Built:** every step is audited; a wrong address, forwarded link or wrong patient is caught and nothing is filed.

Also **Built:** jury mode with QR code, evidence lines for AI-read values, status board, reminders, SHA-256 receipt, and *KI-Hilfe für Absender* (AI pre-fills the answer; a human still presses "Sicher senden").

## Results

| Metric | Target | Result |
|---|---|---|
| FHIR validation errors | 0 | **0** |
| Outside person: installs / accounts / time | 0 / 0 / < 2 min | **0 / 0 / 0.4 s** at scripted speed (a human adds reading time) |
| Misdeliveries caught | 3 of 3 | **3 of 3** |
| Audit coverage | 6 of 6 steps | **6 of 6** |
| AI reading, real Claude run (30 Oct, 17 documents) | none | **49/51** values correct · **17/17** patients right · **17/17** hallucination traps rejected · **0** values filed without evidence |

Sources: [METRICS.md](METRICS.md) (its MOCK footnote predates the real AI run) and [AI-EVAL.md](AI-EVAL.md).

## What works and what doesn't

- **Built and tested:** unit tests, HL7 validation and end-to-end suites against the real stack (Synapse, HAPI FHIR, Mailpit).
- **Built, with limits:** the AI reader. Its automatic check rejects invented numbers but missed the 2 misread ones, so AI-read answers are never filed automatically: Dr. Hofer checks each value against its evidence line before release.
- **Simulated:** ID Austria, the physician register, email and SMS.
- **Not done:** a test on a physical phone.
- **The real gap:** the sending doctor still has to find, approve and press send.

## Why this is only step one

Every request still lands on another doctor, unpaid, and Austrian hospital doctors already [report spending 39% of their working time on administration](https://aerztekammer.at/documents/d/content-pool/250324_pk-unterlage_spitalsarzteumfrage-2025). Under the [EHDS](https://health.ec.europa.eu/ehealth-digital-health-and-care/european-health-data-space-regulation-ehds_en), patient summaries and ePrescriptions must be exchangeable EU-wide from 2029, and lab results, images and discharge reports from 2031. Patients can restrict access and see who looked. The **[Brieftaube Network](VISION.md)** (Vision) removes the asking: records stay on a secure box in each practice, a Matrix address book knows where documents are but never what is in them, and the patient grants access through patient-set access permissions.

Designed to plug into: FTAPI, [secunet-class](https://www.secunet.com/en/products-consulting/secunet-konnektor) hardware, ID Austria / [EUDI Wallet](https://eur-lex.europa.eu/eli/reg/2024/1183/oj) and, via MCP, clinical AI such as Tandem Health's [CE-marked AI scribe (company statement)](https://tandemhealth.ai/resources/news/tandem-s-ai-scribe-is-now-mdr-class-iia-certified).

## How to run

Full stack (Docker, Node 22, Java 17+): [README](../README.md#how-to-run) or `scripts/demo.sh`; judge on their own phone: `scripts/jury.sh` ([JURY-DEMO.md](JURY-DEMO.md)).

Docker-free preview (Node 22, demo data):

```bash
npm install
npm run ui:dev   # doctor UI: http://localhost:5173/widget/?mode=standalone&mock=1&jury=1
npx tsx services/core/src/portal/__fakes__/dev-server.ts   # outside portal: http://localhost:3100/r/tok-eva
```

## Data ethics

- **Synthetic only:** every patient, document, physician and e-ID persona is invented, and only synthetic documents reached Claude.
- **No patient data in notifications:** a privacy guard checks every email and SMS; the link reveals nothing before the e-ID check.
- **Nothing filed on doubt:** wrong patient or failed identity check means not filed; AI-read answers wait for Dr. Hofer.
- **Audit trail:** six steps with who, what and when, also as FHIR `AuditEvent`; the sender's receipt holds a hash, no medical content.

## Team and video

- Team Brieftaube: Jonathan Kalmbach, Victoria Beneder, Luca Ludwig, Arton Deskaj, Lorenz Pichler, Áron Barnabás Turán
- Video: `<link>`

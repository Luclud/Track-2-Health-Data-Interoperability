# Architecture

Brieftaube runs **at the clinic**, next to the clinic's own Matrix homeserver. Every clinic in the network can run its own instance; data stays with whoever produced it until it is requested, and the filed copy lives on the requesting clinic's FHIR server.

## Components

```
 Klinikum Beispielstadt (one docker compose on one laptop)
 ┌────────────────────────────────────────────────────────────────────────────┐
 │                                                                            │
 │  Element Web :8080 ──── Synapse :8008 (klinikum.example, closed network)   │
 │     │  room "Anfragen – Dr. Hofer"         ▲                               │
 │     │  └─ widget iframe                    │ bot posts status messages     │
 │     ▼                                      │                               │
 │  Doctor UI (React)  ──/api──►  Brieftaube core :3000 (Node, Fastify)       │
 │  /widget/  (also standalone              │  ├─ RequestService (state machine, policies)
 │   website: ?mode=standalone)             │  ├─ parser + LLM fallback (verified)
 │                                          │  ├─ FHIR builders + HAPI client ──► HAPI FHIR :8090
 │                                          │  ├─ audit log (SQLite + JSONL + AuditEvent)
 │                                          │  ├─ notify: SMTP ──► Mailpit :8025/:1025
 │                                          │  │          SMS  ──► /dev/sms (simulator page)
 │                                          │  ├─ mock ID Austria  /mock-eid/*
 │                                          │  └─ portal for outside people  /r/:token
 └──────────────────────────────────────────┼─────────────────────────────────┘
                                            │ link in email / SMS (no patient data)
                                    Outside person's browser (no account, no install)
```

| Component | Built by us? | Replaceable by |
|---|---|---|
| Synapse + Element Web | no (open source) | any Matrix homeserver/client, e.g. the PGK client |
| Doctor UI (Matrix widget) | yes | — |
| Brieftaube core | yes | — |
| HAPI FHIR | no | any FHIR R4 server (`FhirStore` interface) |
| Mailpit | no (test only) | any SMTP relay, FTAPI SecuMails (`MessageSender`) |
| SMS simulator | yes (test only) | any SMS gateway (`MessageSender`) |
| Mock ID Austria | yes (simulation) | real ID Austria / eIDAS OIDC (`IdentityProvider`) |
| Mock physician register | yes (simulation) | ÖÄK Ärzteliste lookup (`PhysicianRegister`) |
| LLM fallback | provider of choice | Anthropic, Perplexity, any OpenAI-compatible or clinic-hosted model (`LlmClient`) |

All seams are in `services/core/src/ports.ts`.

## Ports

| Port | Service |
|---|---|
| 3000 | Brieftaube core (API, portal, mock eID, SMS simulator, doctor UI at /widget/) |
| 5173 | Doctor UI dev server (Vite, optional) |
| 8008 | Synapse |
| 8080 | Element Web |
| 8090 | HAPI FHIR (`/fhir`) |
| 8025 | Mailpit UI + API |
| 1025 | Mailpit SMTP |

## Request lifecycle

```
Dr. Hofer (widget)        core                         outside person                FHIR / Matrix
     │ recipient-check ───►│ warnings (confusables, unknown contact)
     │ create request ────►│ Task(requested) ─────────────────────────────────────────► HAPI
     │                     │ token (32 bytes, only sha256 stored), ref BT-XXXX
     │                     │ email/SMS (no patient, no birth date, no doc type) ──► inbox
     │                     │ audit: request-sent                                  Matrix: "Anfrage BT-XXXX gesendet"
     │                     │◄──── GET /r/:token ───────────── opens link
     │                     │ audit: link-opened (unverified visitor)
     │                     │ shows only: requester, clinic, "for <recipient name>", reference
     │                     │──── redirect ──► mock ID Austria ── login ──► callback
     │                     │ identity policy: name match (+ register for physicians), LoA high
     │                     │ audit: identity-checked (success | failure)
     │        mismatch ──► │ audit: misdelivery-caught (identity-mismatch)        Matrix: ⚠ "Jemand anderer als … hat versucht …"
     │                     │ success: show patient name, birth date, document type, note
     │                     │◄──── POST answer (form: patient name, birth date, file/text)
     │                     │ audit: answer-sent
     │                     │ parse (deterministic → LLM fallback, verified)
     │                     │ patient check (form AND document vs request), doc type check
     │   wrong patient ──► │ audit: misdelivery-caught (wrong-patient), nothing filed   Matrix: 🛑 "Falscher Patient …"
     │                     │ build transaction bundle + Provenance → HAPI
     │                     │ audit: answer-filed                                  Matrix: ✅ summary (values)
```

## State machine (`RequestStatus`)

```
sent ──open──► opened ──eID ok──► verified ──answer ok──► filed
  │              │  └─eID mismatch─► identity-failed ──(right person opens)──► verified
  │              │                                  verified ──wrong patient/type──► rejected ──(corrected answer)──► filed
  │              │                                  verified ──AI-read / not in register──► held ──doctor release──► filed
  └── after REQUEST_TTL_HOURS ──► expired                                    held ──doctor reject──► rejected
```

Rules:
- A request is answered at most once successfully. After `filed`, the link shows "already answered".
- `identity-failed` and `rejected` keep the request open for the right person / a corrected answer until it expires.
- Content of rejected answers is **not stored** (only sha256, size and reason) — data minimisation.

## Security notes (prototype level)

- Token: 32 random bytes, base64url, only the sha256 is stored; valid 72 h; bound to the request.
- Portal session after eID: signed, HTTP-only cookie containing request id + verified identity; 30 min.
- Raw IP addresses are never stored, only a salted sha256.
- Doctor API auth: Matrix OpenID token from the widget (verified at Synapse) — or `X-Dev-User` in `AUTH_MODE=dev`.
- No end-to-end encryption and plain HTTP on localhost: explicitly allowed by the challenge for the prototype.

# Plan

## Goal for v1 (by ~09:30 Fri, deadline ~15:00)

The whole scenario works end to end on one laptop: request 1 (lab result by email) and request 2 (rehab report by SMS) filed as valid FHIR, M1–M3 caught, six audit steps logged, Dr. Hofer informed in Matrix. The idea and the presentation matter more than completeness: anything that breaks may be mocked, as long as the README says so honestly.

## Decisions (with the team, 30 Oct, 01:00–03:00)

| Topic | Decision |
|---|---|
| Name | Brieftaube (may change) |
| Doctor side | Real Synapse + Element Web, our UI as a Matrix widget. Same React app has a standalone mode as demo website / fallback. |
| Identity | eID (simulated ID Austria) for every outside person + name match; lab result additionally physician register. Patient match on form + document. |
| Answer format | Form (patient name, birth date) + file upload or pasted text. |
| Where it runs | At the clinic, next to its homeserver. Pitch: every clinic runs its own instance. |
| Stack | TypeScript everywhere: Fastify, SQLite, React/Vite, HAPI, Mailpit, Playwright, Vitest. |
| Parsing | Deterministic parser; LLM only as verified fallback (provider-agnostic, Anthropic/Perplexity/any). AI output never filed automatically. |
| Demo | One laptop, docker compose. Mock what doesn't work. |
| Agents | One Devin account at a time (only one can be connected). One coordinator runs Dev Core, Dev Matrix, Dev Outside, Tester and short Reviewer sessions. Second account = reserve budget, takes over via docs/HANDOFF.md. Planning and final review in Claude. |
| Patient as answerer | Not in v1 (maybe v2 / pitch only). |
| Pitch story | Ski accident patient journey (ER → surgery → family doctor → MRI → rehab → home), prepared on Friday once v1 works. |

## Timeline (Europe/Vienna)

| Time | What |
|---|---|
| 03:30 | Coordinator starts Dev Matrix (INFRA-1), does BOOT-1 itself. |
| 04:00 | BOOT-1 merged; Dev Core, Dev Outside, Tester started. |
| ~05:30–06:30 | Likely budget handoff to account 2 (human switches the connection). |
| 06:30 | All P0 merged (target). |
| 07:00 | Integration on `main`, e2e, metrics. P1 only if green. |
| 08:30 | Feature stop. |
| 09:15 | `docs/MORNING-REPORT.md` written, all sessions stopped. |
| 09:30 | Team: `docs/MORNING-CHECKLIST.md`, then fix / mock / cut, pitch, video. |
| ~15:00 | Submission: video ≤ 2 min, public repo, metric results. |

## Risks and fallbacks

| Risk | Fallback |
|---|---|
| Synapse/Element widget trouble | Standalone mode of the doctor UI (`CHAT_MODE=memory`) — same flow, simulated room timeline. |
| HAPI won't start | Public test server `https://hapi.fhir.org/baseR4` with `SCENARIO_PATIENT_ID=brieftaube-maria-beispiel`. |
| Validator errors late | Golden examples are the reference; builders are tested against them. |
| Agent budget runs out | P0 order in TASKS.md; coordinators stop P2/P3 at ~70 ACUs. |
| Lockfile conflicts between agents | Only BOOT-1 creates it; dependency changes in their own PR. |
| Budget of account 1 runs out at night | Coordinator writes docs/HANDOFF.md at ~75 ACUs; human switches to account 2 and restarts the same prompt. |

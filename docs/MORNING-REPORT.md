# Morning report (coordinator, night of 29→30 October 2026)

All tasks in `docs/TASKS.md` are on `main`. Each one was merged only after its PR CI was green. `main` passes `npm run check` (203 unit tests, 0 HL7 validator errors). On a clean clone with Docker volumes wiped, `npm run e2e` passes 21/21 (6 scenario + 15 jury robustness) and `npm run e2e:ui` passes 2/2. The handoff (STEP 5) was not triggered, because usage stayed well below about 60% of the weekly limit.

## Demo commands (exact)

```bash
cp .env.example .env
npm install
npm run stack:up                 # Synapse :8008, Element :8080, HAPI :8090, Mailpit :8025
bash infra/wait-for-stack.sh     # first start pulls images
npm run seed
npm run ui:build                 # BEFORE starting core, else /widget shows "Doctor UI not built"
```

Then start core in one of these ways:

| Path | Command | Open |
|---|---|---|
| Standalone website (simplest for the jury) | `CHAT_MODE=memory npm start` (the `.env` default) | http://localhost:3000/widget/?mode=standalone |
| Standalone + real Matrix room | `CHAT_MODE=matrix npm start` | standalone URL above; bot messages appear in Element |
| Element widget | `CHAT_MODE=matrix AUTH_MODE=matrix npm start` | http://localhost:8080, log in as `lena.hofer` / `demo-lena-2026`, open the room, allow the widget once |

The outside person's link comes from Mailpit (http://localhost:8025) or from the SMS simulator (http://localhost:3000/dev/sms). FHIR data is at http://localhost:8090/fhir. `scripts/demo.sh` runs the whole sequence in one command.

Run the checks with `npm run check`, `npm run e2e` (core with `AUTH_MODE=dev`; use `E2E_AUTH=matrix npm run e2e` against `AUTH_MODE=matrix`), `npx playwright install --with-deps chromium && npm run e2e:ui`, and `npm run metrics`.

## Metrics (`docs/METRICS.md`)

| Metric | Target | Result |
|---|---|---|
| FHIR validation errors | 0 | **0** |
| Outside person: installs / accounts / time | 0 / 0 / < 2 min | **0 / 0 / 0.6 s** (scripted, phone viewport) |
| Misdeliveries caught | 3 of 3 | **3 of 3** (M1, M2, M3) |
| Audit coverage | 6 of 6 | **6 of 6** |

## What works

The details are in the "What works and what doesn't" section of the README. In short:

- Both scenario requests work end to end: email to the lab and SMS to the rehab clinic. Notifications contain no patient data.
- The outside person never needs an install or an account: e-ID (simulated), then the answer form, then "gesendet". The UI works on a phone and on a laptop.
- The lab result is filed as DiagnosticReport + Observations + Provenance. The rehab report is filed as DocumentReference + MedicationStatements + Provenance. Both are mirrored to HAPI with 0 validator errors.
- The doctor's request detail now shows the filed lab values table or the rehab excerpt. I fixed this tonight in [#38](https://github.com/Luclud/Track-2-Health-Data-Interoperability/pull/38) and [#39](https://github.com/Luclud/Track-2-Health-Data-Interoperability/pull/39).
- M1 is caught twice, by the address warning before sending and by the e-ID name mismatch. M2 (forwarded link) and M3 (wrong patient) are caught too. Nothing is filed for any of them, and each one produces a Matrix alert and an audit entry.
- Answers are held for release or rejection when the sender is not in the register or the document was read by the AI.
- Jury robustness ([#35](https://github.com/Luclud/Track-2-Health-Data-Interoperability/pull/35)) is covered:
  - a new lab physician who is not in the register is held, then filed after release;
  - a new rehab sender from another clinic is filed;
  - every document in `tests/fixtures/documents` is handled;
  - a document for the wrong patient (Martina) is not filed;
  - a free-text letter is rejected when no LLM is configured;
  - a stranger's e-ID is blocked and sees nothing.
- Doctor auth works with a Matrix OpenID token checked at Synapse (`AUTH_MODE=matrix`) and with the `X-Dev-User` dev mode.
- The doctor UI, portal and mock e-ID were polished ([#37](https://github.com/Luclud/Track-2-Health-Data-Interoperability/pull/37)). Screenshots for laptop and phone are in `docs/screenshots/`.

## What doesn't / simulated

- ID Austria, the Ärzteliste register, email delivery (Mailpit) and SMS (simulator) are simulated.
- The LLM fallback is only unit-tested with `LLM_PROVIDER=mock`. It has never run against a real model, because no key is configured. Without a key, documents that are not in the standard format are rejected, and no document text leaves the machine.

## Known issues / demo gotchas

- **Register persists until restart.** The mock e-ID "Andere Person" with "in Ärzteliste aufnehmen" stays in the in-memory register until core restarts. A second "not in register" demo with the same name would then be filed directly instead of held, so restart core or use a new name.
- **Two Node versions on the VM.** Interactive (`tty`) shells pick up Node 24, and `better-sqlite3` was built for Node 22, which gives a `NODE_MODULE_VERSION` error. Start core from a Node 22 shell, or run `npm rebuild better-sqlite3`.
- **Build the UI first.** If core starts before `npm run ui:build`, `/widget/` returns 503 until core restarts.
- **Summary depends on HAPI.** The request detail summary is read back from HAPI. If HAPI is down, the detail view still works but shows no values table.
- **Mixed language in the values table.** Test names and the conclusion appear in English exactly as written in the document, and values are shown without trailing zeros ("1" instead of "1,0"). The surrounding UI text is German.
- **Widget permission click.** The Element widget asks for a one-time permission click.

## PRs merged tonight

The main ones are [#2](https://github.com/Luclud/Track-2-Health-Data-Interoperability/pull/2) (BOOT-1), the lane PRs up to [#28](https://github.com/Luclud/Track-2-Health-Data-Interoperability/pull/28), CORE-9..12 ([#29](https://github.com/Luclud/Track-2-Health-Data-Interoperability/pull/29)–[#32](https://github.com/Luclud/Track-2-Health-Data-Interoperability/pull/32)), tests [#18](https://github.com/Luclud/Track-2-Health-Data-Interoperability/pull/18), [#20](https://github.com/Luclud/Track-2-Health-Data-Interoperability/pull/20), [#22](https://github.com/Luclud/Track-2-Health-Data-Interoperability/pull/22), [#24](https://github.com/Luclud/Track-2-Health-Data-Interoperability/pull/24), [#34](https://github.com/Luclud/Track-2-Health-Data-Interoperability/pull/34) and [#35](https://github.com/Luclud/Track-2-Health-Data-Interoperability/pull/35), integration [#36](https://github.com/Luclud/Track-2-Health-Data-Interoperability/pull/36), polish [#37](https://github.com/Luclud/Track-2-Health-Data-Interoperability/pull/37), and the summary fix in [#38](https://github.com/Luclud/Track-2-Health-Data-Interoperability/pull/38) and [#39](https://github.com/Luclud/Track-2-Health-Data-Interoperability/pull/39). Issue [#33](https://github.com/Luclud/Track-2-Health-Data-Interoperability/issues/33) (M1 recipient warning) is fixed and closed.

**Open PRs: none. Open issues: none.**

**Decision:** I stopped before 08:30. Every task in `docs/TASKS.md` was merged and green, and the rule against new features left nothing else to do. Stopping early saves the remaining weekly budget for the team.

All child sessions were terminated at the end of the night.

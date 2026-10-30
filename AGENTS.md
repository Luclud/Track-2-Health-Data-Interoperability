# Rules for coding agents (read fully before you start)

You are building **Brieftaube** for the AIM Austria hackathon, Track 2 (health data interoperability). The challenge is in `scenario/` and summarised in `README.md`. The plan is in `docs/`:

1. `docs/TASKS.md` — your lane and tasks, acceptance criteria. **Start here.**
2. `docs/DESIGN.md` — behaviour rules (identity, misdelivery, parsing, notifications, audit, messages).
3. `docs/ARCHITECTURE.md` — components, ports, lifecycle, state machine.
4. `docs/FHIR-MAPPING.md` + `fhir-examples/` — exact FHIR target shapes.
5. `packages/shared/src/*` and `services/core/src/ports.ts` — contracts.

## Working rules

1. **Never wait for a human.** Nobody answers at night. If something is unclear, choose the option that best fits `docs/DESIGN.md`, write the decision in your PR description under "Decisions", and continue. Never end a session with a question.
2. **Stay in your lane.** Only edit files your lane owns (see `docs/TASKS.md`). Need a change elsewhere? Write it in your PR under "Requests for other lanes" and work around it with a local adapter.
3. **Contracts are frozen.** `packages/shared/src/**`, `services/core/src/ports.ts`, `services/core/src/config.ts`, `services/core/src/container.ts`, `services/core/src/server.ts` are changed only by a coordinator, in a separate small PR titled `contract: ...`.
4. **One task per branch and PR.** Branch `<TASK-ID>-<short-name>` from the latest `main`. Rebase on `main` before opening/merging. Small PRs (< ~600 changed lines) merge faster and conflict less.
5. **Green before PR.** `npm run check` must pass locally. Add tests with every behaviour you add. Tests must run without Docker, network or API keys (use the in-memory fakes); only `tests/e2e/**` may need the running stack.
6. **Lockfile.** Do not add dependencies unless really needed. If you must, add them in your own PR and run `npm install` from the repo root. On a `package-lock.json` conflict: take `main`'s version, re-run `npm install`, commit.
7. **Privacy rule is sacred.** Emails/SMS never contain patient name, birth date, document type or medical words — every notification goes through `assertNotificationIsClean` (`services/core/src/notify/privacy.ts`). Nothing about the patient is shown before a successful identity check. Nothing is filed on a mismatch.
8. **Synthetic data only.** Never send real email or SMS. Never call real external services except: package registries, GitHub, Docker image mirrors, the LLM API if a key is configured.
9. **FHIR must validate.** 0 errors from the HL7 validator. No `display` on LOINC codings. No custom extensions.
10. **Language.** Code, comments, commit messages, docs: English. All UI text for doctors and outside people: German (Austrian usage: "Jänner", "e-ID").
11. **TypeScript, ESM, Node 22.** Run TS directly with `tsx` (no build step for the core). Strict mode. No `any` unless commented why.
12. **Budget.** Stop working on a task when its acceptance criteria are met. Don't gold-plate. If stuck > 30 min on the same error, write what you tried in the PR, mark it draft, and move to the next task.
13. **Docker images.** Docker Hub rate-limits these machines: use the image names in `infra/docker-compose.yml` (mirror.gcr.io / ghcr.io).

## Commands

```bash
npm install                      # once
npm run check                    # typecheck + unit tests + FHIR validation  (must be green)
npm test                         # unit tests only
npm run validate:fhir            # HL7 validator on fhir-examples/ and out/fhir/
cp .env.example .env             # first time
npm run stack:up                 # Synapse, Element, HAPI, Mailpit (Docker)
npm run seed                     # users, room, widget, patient
npm run dev                      # core on :3000 (watch mode)
npm run ui:dev                   # doctor UI on :5173 (proxy to core)
npm run e2e                      # scenario tests against the running stack
```

## URLs (local)

Core http://localhost:3000 · Doctor UI http://localhost:3000/widget/?mode=standalone · Element http://localhost:8080 (lena.hofer / demo-lena-2026) · HAPI http://localhost:8090/fhir · Mailpit http://localhost:8025 · SMS simulator http://localhost:3000/dev/sms

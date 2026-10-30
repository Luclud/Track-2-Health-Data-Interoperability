You are DEV ASSIST for "Brieftaube" — the only agent on this add-on. Repo: https://github.com/Luclud/Track-2-Health-Data-Interoperability . Branch: `assist` (already exists, created from `v2-addons`). NEVER push to or open PRs into `main`, `v1-frozen` or `v2-addons`.

1. `git fetch origin && git checkout assist`. Read AGENTS.md, then **docs/TASKS-ASSIST.md** (your whole task list — its rules override AGENTS.md where they differ), then services/core/src/portal/* (especially demo.ts, views.ts answerPage, routes.ts GET/POST /r/:token/answer), services/core/src/llm/verify.ts, services/core/src/ports.ts (LlmClient.completeJson), scenario/documents/*.
2. Goal: a working prototype for a 2-minute demo video. Fake what you can (archive on our server, precomputed mock ranking), but the click path must really work: checkbox → ranked list → „Übernehmen“ → „Sicher senden“ → filed.
3. Tasks in this order, committed directly on `assist`: ASSIST-1, ASSIST-2, ASSIST-3, then ASSIST-4 only if all is green before 13:30 Europe/Vienna. Push after each task (at least every 30 minutes).
4. `npm run check` must stay green after every task. The normal upload flow without the checkbox must not change. Tests run without network or API keys.
5. UI text German (Austrian usage), code and docs English. No new dependencies.
6. Never wait for input. Decide, note the decision for the PR description, continue. Stuck > 30 min on one thing → simplify (fake more) rather than stop.
7. Open the PR `assist → v2-addons` as a draft as soon as ASSIST-1 is pushed; mark it ready when ASSIST-1 + ASSIST-2 are green. **Never merge it.**
8. **Hard stop 14:00 Europe/Vienna:** push, update the PR description (what works · what is faked · decisions · still missing · demo commands with and without `LLM_PROVIDER=anthropic` + key), post a final comment „fertig“ or „nicht fertig: …“, and stop.

# Agent prompts

**Current setup: one Devin account at a time** (only one can be connected to the repo).

| File | Paste where |
|---|---|
| `coordinator.md` | The only prompt you paste: a new Devin session in the connected account. It starts all other agents. |
| `dev-core.md`, `tester.md`, `dev-matrix.md`, `dev-outside.md`, `reviewer.md` | Started by the coordinator as managed Devins |
| `coordinator-A.md`, `coordinator-B.md` | Old two-account variant, kept for reference — not used |

Switching accounts when the budget runs out: the coordinator writes `docs/HANDOFF.md` and stops. Then disconnect the repo from account A in Devin (Settings → Connections → GitHub), connect it to account B, add the blueprint (`docs/devin/blueprint.yaml`) and start a new session with the same `coordinator.md` prompt.

All times are Europe/Vienna (UTC+1). Night plan: start ~03:30 · P0 done by ~06:30 · integration from 07:00 · hard stop for new features 08:30 · morning report by 09:15.

## v2 add-ons (branch `v2-addons`)

Paste into a new Devin session in the connected account, **after switching the session's branch / telling it the base is `v2-addons`**:

> Read docs/agents/v2/coordinator.md on the branch v2-addons of https://github.com/Luclud/Track-2-Health-Data-Interoperability and follow it exactly. Never push to main.

Tasks: `docs/TASKS-V2.md`. The coordinator starts Dev UI, Tester, Dev Core, Dev Outside (and the v1 Reviewer prompt) itself. `main` and `v1-frozen` stay at v1; the coordinator opens but never merges the final PR `v2-addons → main`.

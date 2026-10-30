You are DEV OUTSIDE (v2) for "Brieftaube". Repo: https://github.com/Luclud/Track-2-Health-Data-Interoperability . Base branch: `v2-addons`. NEVER push or open PRs to `main`.

1. Read AGENTS.md (v2 rules at the top), docs/TASKS-V2.md (lane OUTSIDE), docs/DESIGN.md (§1 identity, §4 notifications), services/core/src/{portal,eid,notify}/*, services/core/src/ports.ts, packages/shared/src/*.
2. Wait until "contract: v2" (V2-BOOT-1) is merged into v2-addons, then pull.
3. Tasks in this order, one branch (from origin/v2-addons) + PR (base v2-addons) each: V2-JURY-2, V2-RCPT-1, V2-REM-1.
4. Your files: services/core/src/{portal,eid,notify,register,scheduler}/** (never weaken notify/privacy.ts) + your checkboxes in docs/TASKS-V2.md.
5. Privacy rule is sacred: reminders go through assertNotificationIsClean; nothing about the patient before the identity check; the receipt contains no medical content; demo buttons exist only when JURY_MODE=true.
6. For V2-REM-1 you need to list open requests and expire them: ask Dev Core (through the coordinator) for a small service method early, and work against a local adapter until it lands.
7. Never wait for input. Decide, write "Decisions" in the PR, continue. Stuck > 30 min → draft PR, next task. Push at least every 30 minutes.
8. When done, or at 09:45 Europe/Vienna: open your last PR (draft if unfinished), post a final comment (done / not done) and stop.

# v2 report

Branch `v2-addons` (on top of v1 `main`, which is unchanged). Plan: [`TASKS-V2.md`](TASKS-V2.md). All data is synthetic.

## What works (exact commands)

```bash
cp .env.example .env && npm install
npm run check                    # typecheck + 284 unit tests + HL7 validation: 0 errors
npm run stack:up && bash infra/wait-for-stack.sh && npm run seed
npm run ui:build && npm run dev  # core on :3000, AUTH_MODE=dev (needed for the e2e suites)
npm run e2e                      # 37 passed: v1 scenario + jury + v2 (all v2 flags on)
npx playwright install chromium && npm run e2e:ui   # 5 passed (phone outside flow, standalone doctor UI, QR modal, German values)
LLM_PROVIDER=mock npm run ai:eval   # writes docs/AI-EVAL.md (MOCK without a key)
npm run metrics                  # writes docs/METRICS.md
scripts/jury.sh                  # stack + seed + Cloudflare quick tunnel + core in JURY_MODE
scripts/jury.sh --lan            # same without tunnel, links use http://<LAN IP>:3000
```

| Jury question | What v2 adds | Checked by |
|---|---|---|
| Judge on their own phone | `scripts/jury.sh` (tunnel / `--lan`), `JURY_MODE`, `GET /api/ui-config`, `Jury-Schnellauswahl` + QR modal, demo buttons on the answer page, phone-friendly mock eID | e2e `jury link only in jury mode`, `demo buttons only in jury mode`, UI e2e QR modal; manual `jury.sh` runs below |
| Trust in AI-read values | evidence line per value for held answers (`RequestDetailResponse.review`), two-pane review in the doctor UI, `npm run ai:eval` with hallucination trap, Anthropic default model + timeout/retry | unit tests, e2e `held review has evidence for every value`, [`AI-EVAL.md`](AI-EVAL.md) |
| Clinical usefulness | critical values 🚨 (`infra/critical-values.json`), values table in the ✅ message, German formatting (`1,0`, `10⁹/L`), status board, reminders with link rotation + active expiry, printable Eingangsbestätigung with SHA-256 | unit tests, e2e critical/receipt/reminder tests, UI e2e German values |

`scripts/jury.sh`, tried on the Linux VM:
- **Tunnel:** cloudflared was downloaded into `~/.cache/brieftaube/`, the `https://….trycloudflare.com` URL was read from its banner, and the core started with it. Over the public URL, `/api/ui-config` returned `juryMode: true`. A request created there returned a `juryLink` on the public host, and the outside portal page ("Sichere Anfrage – Brieftaube") loaded through the tunnel. The fresh hostname took about 30 s to resolve.
- **`--lan`:** the core started on `http://172.16.255.2:3000`, the `juryLink` used the LAN IP, and the portal loaded.
- **Not done:** a physical phone. Dev UI ran the full outside flow (eID → answer → filed) over a tunnel on a VM with scripted browsers at phone widths (see [`JURY-DEMO.md`](JURY-DEMO.md)).

## Metrics and AI evaluation

From `npm run metrics` on `v2-addons` ([`METRICS.md`](METRICS.md)):

| Metric | Target | Result |
|---|---|---|
| FHIR validation errors | 0 | **0** (36 files, 11 filed by the scenario run) |
| Outside person: installs / accounts / time | 0 / 0 / < 2 min | **0 / 0 / 0.4 s** (scripted) |
| Misdeliveries caught | 3 of 3 | **3 of 3** |
| Audit coverage | 6 of 6 | **6 of 6** (`reminder-sent` is extra and not counted) |

AI evaluation ([`AI-EVAL.md`](AI-EVAL.md)): **MOCK**, because no `LLM_API_KEY` was available. 17 documents, every value correct, every hallucination trap rejected, "Werte ohne Beleg im Original abgelegt: 0". This proves the measurement and the verification step. It says nothing about the reading quality of a real model. Real run: `LLM_PROVIDER=anthropic LLM_API_KEY=… npm run ai:eval`.

## What doesn't / known issues

- No real-model run (see above). V2-AI-2 is ready for a key, but the real path is untested.
- The jury flow was not tried on a physical phone. Quick tunnels have no uptime guarantee; `--lan` with the laptop hotspot is the fallback ([`JURY-DEMO.md`](JURY-DEMO.md)).
- `jury.sh` starts the core with `AUTH_MODE=matrix`, so `npm run e2e` against it fails with 401 by design. Run the e2e suites against `npm run dev`.
- The standalone doctor UI always shows the room `!standalone:klinikum.example` unless `?roomId=` is given. Requests created via the API for the seeded Matrix room only show in Element or with `?roomId=…`.
- ID Austria, the physician register, email and SMS are still simulated (as in v1).

## How it was built

The coordinator merged one PR per task into `v2-addons` after green CI and review. Review must-fixes were fixed before merge: #46 now reads `G/l` as 10⁹/L, not grams, and #55 no longer lets a reminder overwrite a request that changed during a scheduler tick.

| PR | Task |
|---|---|
| #41 | contract: v2 (format helpers, held review, ui-config, jury link, scheduler stub, config) |
| #47, #57 | contract: request repo `listOpen` + `rotateTokenHash`; `DocumentRequestView.expiresAt` |
| #42, #44, #53, #58, #59 | V2-TEST-1 fixtures, V2-TEST-2 e2e (+ unskips), V2-TEST-3 metrics |
| #43, #45, #48 | V2-JURY-3 jury.sh, V2-JURY-1 QR modal, V2-JURY-2 portal on a phone |
| #46 | V2-CRIT-1/2 critical values + values table |
| #50, #51, #54 | V2-AI-1 evidence, V2-AI-3 AI eval, V2-AI-2 real-model readiness |
| #49, #55 | V2-RCPT-1 receipt, V2-REM-1 reminders + expiry |
| #52, #56 | V2-UI-1 readable values + held review, V2-UI-2 status board |

Open PRs against `v2-addons`: none at the time of writing, apart from this report.

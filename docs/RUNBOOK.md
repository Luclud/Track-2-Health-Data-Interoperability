# Runbook

Operational notes and gotchas. Agents: add what you learn here (stack startup issues, fixes, timings).

## Known so far

- Docker Hub returns 429 on the agent machines → images come from `mirror.gcr.io` (Synapse, HAPI, Mailpit) and `ghcr.io` (Element). Override in `.env` on the demo laptop.
- Node 22 is not preinstalled on Devin machines (installed by the blueprint).
- HAPI takes 30–90 s to become ready; wait for `GET http://localhost:8090/fhir/metadata` = 200.
- Synapse signing key is generated on first start by `infra/synapse/start.sh`.

## Stack (INFRA-1)

Verified on a fresh Devin VM (Docker 29, compose v5), `down -v` then up:

```bash
cp .env.example .env
npm run stack:up
infra/wait-for-stack.sh        # polls all four services from the host, default timeout 180 s
```

- Cold start with cached images: Synapse + Element ready after ~6 s, HAPI after ~30 s. The first image pull takes 1–2 min (HAPI is the biggest image).
- Synapse, Element and Mailpit have compose healthchecks. HAPI's image is distroless (no shell, no curl), so it cannot have one; use `infra/wait-for-stack.sh` (or `GET :8090/fhir/metadata` = 200).
- While HAPI boots, `curl` gets "connection reset by peer" on :8090. That is normal; wait.
- Synapse: `GET :8008/_matrix/federation/v1/openid/userinfo?access_token=x` returns `M_UNKNOWN_TOKEN` (not 404). That means the `openid` listener the core needs for widget auth is on.
- HAPI keeps its data in its H2 database inside the container: it is lost on `docker compose down` (not only on `down -v`). Run `npm run seed` again after a restart; it is idempotent.
- `npm run stack:reset` wipes Synapse users/rooms too, so `data/runtime.json` becomes stale. Always re-seed after a reset.

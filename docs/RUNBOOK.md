# Runbook

Operational notes and gotchas. Agents: add what you learn here (stack startup issues, fixes, timings).

## Known so far

- Docker Hub returns 429 on the agent machines → images come from `mirror.gcr.io` (Synapse, HAPI, Mailpit) and `ghcr.io` (Element). Override in `.env` on the demo laptop.
- Node 22 is not preinstalled on Devin machines (installed by the blueprint).
- HAPI takes 30–90 s to become ready; wait for `GET http://localhost:8090/fhir/metadata` = 200.
- Synapse signing key is generated on first start by `infra/synapse/start.sh`.

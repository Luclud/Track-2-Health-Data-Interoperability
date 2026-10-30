# Morning checklist (10 minutes)

For the team at ~09:30. Goal: know what works before deciding what to fix and what to mock.

1. **Read `docs/MORNING-REPORT.md`** (written by the coordinators at the end of the night). If it's missing, check open PRs.
2. **GitHub:** which PRs are merged, which are open/draft, is CI green on `main`?
3. **Ticks in `docs/TASKS.md`:** all P0 ticked? Note every unticked P0.
4. **On the demo laptop**, from a clean clone:
   ```bash
   cp .env.example .env   # switch *_IMAGE to Docker Hub names if mirrors are slow
   npm install && npm run stack:up && npm run seed && npm run ui:build
   CHAT_MODE=matrix npm start
   ```
5. **Walk the happy path by hand (≈ 3 min):** Element → widget → request lab result from Dr. Eva Brandl → Mailpit → link → mock eID "Dr. Eva Brandl" → upload `scenario/documents/lab-result-maria-beispiel.md` → ✅ in Matrix → HAPI `GET /fhir/Observation?subject=Patient/maria-beispiel` shows 4.
6. **Misdeliveries:** M1 (address with capital I, persona Ines Fremd), M2 (persona Thomas Gruber), M3 (upload Max's file). Each: blocked + Matrix message + audit.
7. **Request 2 by SMS** via `/dev/sms`, persona Stefan Kern, rehab report → DocumentReference.
8. **`npm run metrics`** → copy the table into the README.
9. **Standalone website** http://localhost:3000/widget/?mode=standalone — usable as the demo fallback?
10. Decide: fix / mock / cut. Then: pitch story (ski accident), video, README "what works".

Paste the results of steps 2, 3, 5–7 into the Claude planning chat for a review.

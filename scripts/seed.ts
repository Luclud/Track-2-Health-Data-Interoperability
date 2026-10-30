// Seeds the local stack. Owner: Account B, Dev Matrix (task INFRA-2). Idempotent: safe to run twice.
//
// Steps:
//  1. Synapse: register @lena.hofer (password "demo-lena-2026") and @brieftaube (bot) via the shared-secret
//     admin API (POST /_synapse/admin/v1/register, HMAC with registration_shared_secret from infra/synapse/homeserver.yaml).
//     Set display names "Dr. Lena Hofer" and "Brieftaube".
//  2. Log in as lena.hofer, create room "Anfragen – Dr. Hofer" (private), invite + join the bot.
//  3. As lena.hofer (so Element trusts the widget without a prompt) send state events:
//       im.vector.modular.widgets  (state_key "brieftaube") with
//         { type: "m.custom", url: "<PUBLIC_BASE_URL>/widget/?roomId=$matrix_room_id&userId=$matrix_user_id&widgetId=$matrix_widget_id&parentUrl=$parentUrl",
//           name: "Brieftaube – Dokument anfordern", data: {} }
//       io.element.widgets.layout  pinning the widget to the top/right container
//  4. HAPI: PUT Patient/<SCENARIO_PATIENT_ID> from scenario/patient.json (id replaced),
//     PUT Practitioner/lena-hofer, PUT Organization/klinikum-beispielstadt, plus 2–3 extra synthetic patients for the picker.
//  5. Write data/runtime.json: { botAccessToken, botUserId, roomId, lenaAccessToken } (core reads it at startup).
//
// Print a short summary with the Element login (http://localhost:8080, user lena.hofer, password above).
console.error("scripts/seed.ts not implemented yet (task INFRA-2)");
process.exit(1);

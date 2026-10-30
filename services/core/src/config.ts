// All configuration comes from environment variables (see .env.example). Owned by the coordinator.

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

export const config = {
  port: Number(env("PORT", "3000")),
  publicBaseUrl: env("PUBLIC_BASE_URL", "http://localhost:3000"),
  dataDir: env("DATA_DIR", "data"),
  sessionSecret: env("SESSION_SECRET", "dev-only-change-me-0123456789abcdef"),

  authMode: env("AUTH_MODE", "dev") as "dev" | "matrix",

  fhirBaseUrl: env("FHIR_BASE_URL", "http://localhost:8090/fhir"),
  /** Patient id used for the scenario (on the public HAPI server use a unique id) */
  scenarioPatientId: env("SCENARIO_PATIENT_ID", "maria-beispiel"),

  chatMode: env("CHAT_MODE", "memory") as "memory" | "matrix",
  synapseUrl: env("SYNAPSE_URL", "http://localhost:8008"),
  matrixServerName: env("MATRIX_SERVER_NAME", "klinikum.example"),
  /** Written by scripts/seed.ts into data/runtime.json; env overrides */
  botAccessToken: env("MATRIX_BOT_TOKEN", ""),
  defaultRoomId: env("MATRIX_ROOM_ID", "!standalone:klinikum.example"),

  mailMode: env("MAIL_MODE", "smtp") as "smtp" | "memory",
  smtpHost: env("SMTP_HOST", "localhost"),
  smtpPort: Number(env("SMTP_PORT", "1025")),
  mailFrom: env("MAIL_FROM", "Brieftaube Klinikum Beispielstadt <no-reply@klinikum.example>"),
  mailpitApiUrl: env("MAILPIT_API_URL", "http://localhost:8025/api/v1"),

  eidIssuerUrl: env("EID_ISSUER_URL", "http://localhost:3000/mock-eid"),

  llmProvider: env("LLM_PROVIDER", "none") as "none" | "anthropic" | "perplexity" | "openai-compatible" | "mock",
  llmApiKey: env("LLM_API_KEY", ""),
  llmModel: env("LLM_MODEL", ""),
  llmBaseUrl: env("LLM_BASE_URL", ""),

  requestTtlHours: Number(env("REQUEST_TTL_HOURS", "72")),

  /** Live demo only: the recipient link is also returned to the doctor UI (QR code). Never in real use. */
  juryMode: env("JURY_MODE", "false") === "true",
  reminderBeforeExpiryMinutes: Number(env("REMINDER_BEFORE_EXPIRY_MINUTES", "1440")),
  /** 0 = scheduler off */
  schedulerIntervalSeconds: Number(env("SCHEDULER_INTERVAL_SECONDS", "60")),
  criticalValuesFile: env("CRITICAL_VALUES_FILE", "infra/critical-values.json"),
} as const;

export type Config = typeof config;

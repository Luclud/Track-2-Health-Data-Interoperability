// V2-TEST-2: which v2 features are merged into v2-addons. Tests for a feature run only when its flag is true.
// TODO (per task ID): flip the flag to true in the PR that merges the feature, or right after it lands.
export const MERGED = {
  "V2-BOOT-1": true, // contract: juryLink, GET /api/ui-config
  "V2-CRIT-1": true,
  "V2-CRIT-2": true,
  "V2-AI-1": true,
  "V2-JURY-1": true,
  "V2-JURY-2": true,
  "V2-RCPT-1": true,
  "V2-REM-1": true,
  "V2-UI-1": true,
} as const;

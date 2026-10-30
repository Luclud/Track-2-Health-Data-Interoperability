// V2-TEST-2: which v2 features are merged into v2-addons. Tests for a feature run only when its flag is true.
// TODO (per task ID): flip the flag to true in the PR that merges the feature, or right after it lands.
export const MERGED = {
  "V2-BOOT-1": true, // contract: juryLink, GET /api/ui-config
  "V2-CRIT-1": false, // TODO V2-CRIT-1: 🚨 alert + critical flag in summary
  "V2-CRIT-2": false, // TODO V2-CRIT-2: ✅ message html table, loinc in summary
  "V2-AI-1": false, // TODO V2-AI-1: evidence for held answers
  "V2-JURY-1": true,
  "V2-JURY-2": false, // TODO V2-JURY-2: demo buttons on the answer page (jury mode only)
  "V2-RCPT-1": false, // TODO V2-RCPT-1: Eingangsbestätigung with SHA-256
  "V2-REM-1": false, // TODO V2-REM-1: reminders, link rotation, active expiry
  "V2-UI-1": false, // TODO V2-UI-1: German value formatting in the doctor UI
} as const;

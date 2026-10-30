// Lane OUTSIDE, Dev Outside — task V2-REM-1. Periodic jobs: reminders (with link rotation) and active expiry.
// Stub from V2-BOOT-1: does nothing yet. Must stay safe to start in every environment.
import type { Deps } from "../container.ts";

/** Starts the periodic jobs (every SCHEDULER_INTERVAL_SECONDS; 0 = off). Returns a function that stops them. */
export function startScheduler(deps: Deps): () => void {
  const seconds = deps.config.schedulerIntervalSeconds;
  if (!Number.isFinite(seconds) || seconds <= 0) return () => {};
  const timer = setInterval(() => {
    // V2-REM-1: reminders + active expiry go here.
  }, seconds * 1000);
  timer.unref();
  return () => clearInterval(timer);
}

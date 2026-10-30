import { describe, expect, it } from "vitest";
import { AUDIT_STEPS, EXTRA_AUDIT_STEPS } from "@brieftaube/shared";
import { aiEvalLine, computeMetrics, renderMarkdown } from "../../scripts/metrics.ts";

describe("metrics", () => {
  it("reports missing runs as not measured, never as a pass", () => {
    const rows = computeMetrics({});
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.pass === undefined)).toBe(true);
    expect(rows.every((r) => r.result.includes("not measured"))).toBe(true);
  });

  it("passes when all four targets are met", () => {
    const rows = computeMetrics({
      validation: { files: 14, errors: 0, warnings: 3 },
      filedFiles: 9,
      ui: { secondsEmailToSent: 41.2, installs: 0, accounts: 0 },
      e2e: { M1: { caught: true }, M2: { caught: true }, M3: { caught: true }, R1: { auditSteps: [...AUDIT_STEPS] } },
    });
    expect(rows.map((r) => r.pass)).toEqual([true, true, true, true]);
    expect(rows[1]!.result).toBe("0 / 0 / 41.2 s");
    expect(rows[2]!.result).toMatch(/^3 of 3/);
    expect(rows[3]!.result).toBe("6 of 6");
  });

  it("fails on errors, slow flow, a missed misdelivery or a missing audit step", () => {
    const rows = computeMetrics({
      validation: { errors: 2 },
      ui: { secondsEmailToSent: 130 },
      e2e: { M1: { caught: true }, M2: { caught: false }, M3: { caught: true }, R1: { auditSteps: ["request-sent"] } },
    });
    expect(rows.map((r) => r.pass)).toEqual([false, false, false, false]);
    expect(rows[2]!.result).toContain("M2 ✗");
  });

  it("renders a markdown table with one row per metric", () => {
    const md = renderMarkdown(computeMetrics({}), { generatedAt: "2026-10-30T05:00:00Z" });
    expect(md.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Metric"))).toHaveLength(4);
  });

  it("counts exactly the six challenge audit steps; reminder-sent is not counted", () => {
    expect(AUDIT_STEPS).toHaveLength(6);
    expect(AUDIT_STEPS).not.toContain("reminder-sent");
    const withExtra = computeMetrics({ e2e: { R1: { auditSteps: [...AUDIT_STEPS, ...EXTRA_AUDIT_STEPS] } } });
    expect(withExtra[3]!.result).toBe("6 of 6");
    const extraOnly = computeMetrics({ e2e: { R1: { auditSteps: ["reminder-sent", "request-sent"] } } });
    expect(extraOnly[3]!.result).toBe("1 of 6 (missing: link-opened, identity-checked, answer-sent, answer-filed, misdelivery-caught)");
    expect(extraOnly[3]!.pass).toBe(false);
  });

  it("names the six audit steps in the markdown", () => {
    const md = renderMarkdown(computeMetrics({}), { generatedAt: "2026-10-30T05:00:00Z" });
    for (const s of AUDIT_STEPS) expect(md).toContain(s);
    expect(md).toContain("reminder-sent) are logged but not counted");
  });

  it("adds a KI-Auswertung line linking docs/AI-EVAL.md", () => {
    expect(aiEvalLine(undefined)).toBe("**KI-Auswertung:** not run yet (`npm run ai:eval` writes [docs/AI-EVAL.md](AI-EVAL.md)).");
    const mock = "# KI-Auswertung (MOCK)\n\n...\nWerte ohne Beleg im Original abgelegt: 0\n";
    expect(aiEvalLine(mock)).toBe("**KI-Auswertung:** [docs/AI-EVAL.md](AI-EVAL.md) (MOCK model, not a real result) – Werte ohne Beleg im Original abgelegt: 0.");
    expect(aiEvalLine("# KI-Auswertung – anthropic claude-sonnet-5-5\nWerte ohne Beleg im Original abgelegt: 0")).not.toContain("MOCK");
    const md = renderMarkdown(computeMetrics({}), { generatedAt: "2026-10-30T05:00:00Z", aiEval: mock });
    expect(md).toContain("**KI-Auswertung:** [docs/AI-EVAL.md](AI-EVAL.md)");
    expect(md.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Metric"))).toHaveLength(4);
  });
});

// CORE-12: optional 2-line AI summary of a rehab report for the Matrix ✅ message.
import type { LlmClient } from "../ports.ts";

const SCHEMA = {
  type: "object",
  properties: { lines: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 2 } },
  required: ["lines"],
  additionalProperties: false,
};

const SYSTEM = [
  "Summarise this rehabilitation discharge report for the treating physician in German, in at most 2 short lines.",
  "Only state facts written in the report (course, mobility, discharge medication, follow-up). No advice, no new facts.",
].join("\n");

/** Never throws; undefined if no LLM or anything goes wrong. */
export async function rehabSummary(llm: LlmClient, markdown: string): Promise<string | undefined> {
  if (!llm.enabled) return undefined;
  try {
    const out = (await llm.completeJson({ system: SYSTEM, user: markdown, jsonSchema: SCHEMA, schemaName: "rehab_summary" })) as { lines?: unknown };
    const lines = Array.isArray(out?.lines) ? out.lines.filter((l): l is string => typeof l === "string" && l.trim() !== "").slice(0, 2) : [];
    return lines.length ? lines.map((l) => l.trim().slice(0, 300)).join("\n") : undefined;
  } catch {
    return undefined;
  }
}

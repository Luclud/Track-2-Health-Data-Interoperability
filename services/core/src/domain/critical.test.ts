import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MemorySender } from "../notify/index.ts";
import { criticalFor, loadCriticalLimits } from "./critical.ts";
import { identity, labBody, lena, testDeps } from "./testkit.ts";

const scenario = readFileSync("scenario/documents/lab-result-maria-beispiel.md", "utf8");
const tokenFrom = (text: string) => /\/r\/([A-Za-z0-9_-]+)/.exec(text)![1]!;
const maria = { patientGiven: "Maria", patientFamily: "Beispiel", patientBirthDate: "1961-03-12" };
const limits = loadCriticalLimits("infra/critical-values.json");

async function fileLab(content: string) {
  const t = testDeps();
  const { request } = await t.service.createRequest(lena, labBody);
  const token = tokenFrom((await (t.deps.email as MemorySender).inbox())[0]!.body);
  await t.service.openLink(token, {});
  const id = identity("eva-brandl");
  await t.service.completeIdentityCheck(token, id, {});
  const out = await t.service.submitAnswer(token, id, { ...maria, content }, {});
  return { ...t, request, out, chat: await t.deps.chat.list(labBody.roomId) };
}

describe("critical values (V2-CRIT-1)", () => {
  it("loads the demo limits", () => {
    expect(limits["777-3"]).toEqual({ low: 50, high: 1000, unit: "10*9/L" });
    expect(Object.keys(limits)).toHaveLength(7);
  });

  it("compares only with a matching (or safely convertible) unit", () => {
    expect(criticalFor(limits, "777-3", 38, "10*9/L")).toEqual({ rule: "< 50" });
    expect(criticalFor(limits, "777-3", 38, "G/l")).toBeUndefined();
    expect(criticalFor(limits, "777-3", 38, undefined)).toBeUndefined();
    expect(criticalFor(limits, "6301-6", 5.2, "{INR}")).toEqual({ rule: "> 4,5" });
    expect(criticalFor(limits, "718-7", 65, "g/L")).toEqual({ rule: "< 7 g/dL" });
    expect(criticalFor(limits, "718-7", 120, "g/L")).toBeUndefined();
    expect(criticalFor(limits, "1988-5", 999, "mg/L")).toBeUndefined();
    expect(loadCriticalLimits("does/not/exist.json", () => {})).toEqual({});
  });

  it("platelets 38: 🚨 alert before ✅, flag in summary, values in the audit", async () => {
    const doc = scenario.replace("| Platelets | 245 |", "| Platelets | 38 |").replace("All values are within the reference range.", "Platelets low.");
    const { out, chat, request, service, deps } = await fileLab(doc);
    expect(out.result).toBe("filed");
    const alert = chat.at(-2)!;
    expect(alert.severity).toBe("alert");
    expect(alert.body).toBe(`🚨 Kritischer Wert – ${request.reference}: Thrombozyten 38 10⁹/L (kritisch < 50). Bitte zeitnah prüfen.`);
    expect(alert.html).toContain('href="https://matrix.to/#/@lena.hofer:klinikum.example"');
    expect(chat.at(-1)!.body).toMatch(/^✅/);
    expect(chat.at(-1)!.html).toContain("🚨");
    const { summary } = (await service.detail(request.id))!;
    if (summary?.kind !== "lab-result") throw new Error("no lab summary");
    expect(summary.values.find((v) => v.loinc === "777-3")).toMatchObject({ value: 38, critical: { rule: "< 50" } });
    expect(summary.values.filter((v) => v.critical)).toHaveLength(1);
    const filed = (await deps.audit.forRequest(request.id)).find((a) => a.step === "answer-filed")!;
    expect(filed.details?.criticalValues).toEqual([{ loinc: "777-3", testName: "Platelets", value: 38, unit: "10^9/L", rule: "< 50" }]);
  });

  it("scenario Maria: no alert", async () => {
    const { out, chat, request, service, deps } = await fileLab(scenario);
    expect(out.result).toBe("filed");
    expect(chat.some((m) => m.body.includes("Kritischer Wert"))).toBe(false);
    const { summary } = (await service.detail(request.id))!;
    expect(summary?.kind === "lab-result" && summary.values.some((v) => v.critical)).toBe(false);
    const filed = (await deps.audit.forRequest(request.id)).find((a) => a.step === "answer-filed")!;
    expect(filed.details?.criticalValues).toBeUndefined();
  });

  it("unit mismatch: no alert, no crash", async () => {
    const doc = scenario.replace("| Platelets | 245 | 10^9/L |", "| Platelets | 38 | G/l |");
    const { out, chat } = await fileLab(doc);
    expect(out.result).toBe("filed");
    expect(chat.some((m) => m.body.includes("Kritischer Wert"))).toBe(false);
  });
});

describe("✅ message with values table (V2-CRIT-2)", () => {
  it("Maria: German table with 1,0 and 10⁹/L, no English test names", async () => {
    const { chat, service, request } = await fileLab(scenario);
    const html = chat.at(-1)!.html!;
    expect(html).toContain("<table>");
    for (const cell of ["<td>INR</td><td>1,0</td><td></td><td>0,8–1,2</td>", "<td>Thrombozyten</td><td>245</td><td>10⁹/L</td><td>150–400</td>", "<td>Fibrinogen</td><td>3,1</td><td>g/L</td><td>2,0–4,0</td>"]) expect(html).toContain(cell);
    for (const en of ["Platelets", "prothrombin", "All values"]) expect(html).not.toContain(en);
    const { summary } = (await service.detail(request.id))!;
    expect(summary?.kind === "lab-result" && summary.values.map((v) => v.loinc)).toEqual(["6301-6", "14979-9", "777-3", "3255-7"]);
  });

  it("flags values outside the reference range with ↑ / ↓", async () => {
    const doc = scenario.replace("| aPTT | 31 |", "| aPTT | 41 |").replace("| Fibrinogen | 3.1 |", "| Fibrinogen | 1.5 |");
    const { chat } = await fileLab(doc);
    const html = chat.at(-1)!.html!;
    expect(html).toContain("<td>aPTT</td><td>41</td><td>s</td><td>25–37</td><td>↑</td>");
    expect(html).toContain("<td>Fibrinogen</td><td>1,5</td><td>g/L</td><td>2,0–4,0</td><td>↓</td>");
  });
});

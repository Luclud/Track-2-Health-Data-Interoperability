// ASSIST-3: "KI-Hilfe für Absender" on a phone: checkbox -> ranked list -> „Übernehmen“ -> „Sicher senden“ -> filed -> ✅ in the doctor's room.
// Needs the running stack and a core started with SENDER_ASSIST=true (scripts/demo.sh and scripts/jury.sh do that).
import { devices, expect, test } from "@playwright/test";
import { chatMessageMatching, coreApi, isCoreUp, labRequest, linkIn, mailFor } from "../lib/stack.ts";

const { defaultBrowserType: _ignored, ...pixel7 } = devices["Pixel 7"];
const BOX = "KI-Hilfe: passende Dokumente aus meiner Ablage vorschlagen";

test.use({ ...pixel7 });

test("Dr. Brandl lets the KI-Hilfe pick the current clotting panel and sends it", async ({ page }) => {
  test.skip(!(await isCoreUp()), "core not reachable at /health");
  const { request } = await coreApi.createRequest(labRequest("eva.brandl@labor-kanal.example"));
  const { url: link } = linkIn((await mailFor(request.reference)).text);

  await page.goto(link);
  await page.getByRole("link", { name: /e-ID/ }).click();
  await page.getByRole("button", { name: /Eva Brandl/ }).click();
  await expect(page.getByLabel(/Vorname/)).toBeVisible();
  test.skip((await page.getByLabel(BOX).count()) === 0, "SENDER_ASSIST is off in the running core");

  await page.getByLabel(BOX).check();
  const panel = page.locator("#assist");
  await expect(panel).toBeVisible({ timeout: 30_000 }); // real LLM: a few seconds
  await expect(panel.getByText(/KI: .*\(Demo über Cloud, nur synthetische Daten\)|KI-Vorschlag \(Demo, MOCK\)/)).toBeVisible();
  test.info().annotations.push({ type: "badge", description: (await panel.locator(".badge").innerText()).trim() });
  await page.screenshot({ path: "out/assist-panel.png", fullPage: true });
  const first = panel.locator(".assist-item").first();
  await expect(first).toHaveAttribute("data-id", "labor-gerinnung-2026-10-22");
  await expect(first.locator(".evidence")).toContainText("Beleg (Zeile");
  await expect(panel.locator('[data-id="labor-andere-patientin"], [data-id="labor-namensgleich"]')).toHaveCount(0);
  await expect(panel).toContainText("2 Dokumente anderer Personen wurden ausgeblendet");

  await first.getByRole("link", { name: /Übernehmen/ }).click();
  await expect(page.getByText(/Vorschlag übernommen: Laborbefund Gerinnung/)).toBeVisible();
  await expect(page.getByLabel(/Vorname/)).toHaveValue("Maria");
  await expect(page.locator("#content")).toHaveValue(/INR \(prothrombin time\)/);
  expect((await coreApi.detail(request.id)).request.status).not.toBe("filed"); // nothing is sent before „Sicher senden“

  await page.getByRole("button", { name: "Sicher senden" }).click();
  await expect(page.getByRole("heading", { name: /gesendet/i })).toBeVisible({ timeout: 20_000 });
  expect((await coreApi.detail(request.id)).request.status).toBe("filed");
  await chatMessageMatching(`✅ for ${request.reference}`, (b) => b.includes("✅") && b.includes(request.reference));
});

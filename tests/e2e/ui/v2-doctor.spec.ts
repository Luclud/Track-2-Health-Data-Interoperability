// V2-TEST-2: v2 doctor UI. Needs the running stack and a built doctor UI (npm run ui:build).
// The QR test starts its own core with JURY_MODE=true on :3103 (tests/e2e/lib/core.ts).
import { expect, test } from "@playwright/test";
import { isStackUp, startCore, type ExtraCore } from "../lib/core.ts";
import { OutsidePerson } from "../lib/portal.ts";
import { coreApi, isCoreUp, labRequest, linkIn, mailFor, poll, ROOM_ID } from "../lib/stack.ts";
import { MERGED } from "../lib/v2-features.ts";
import { fixture } from "../../fixtures/documents/index.ts";

test.describe("jury mode QR (V2-JURY-1)", () => {
  let jury: ExtraCore | undefined;
  test.beforeAll(async () => {
    if (!MERGED["V2-JURY-1"] || !(await isStackUp())) return;
    jury = await startCore("jury-ui", 3103, { JURY_MODE: "true" });
  });
  test.afterAll(async () => jury?.stop());

  test("Jury-Schnellauswahl → send → modal with QR and the link", async ({ page }) => {
    test.skip(!MERGED["V2-JURY-1"], "TODO V2-JURY-1: unskip when merged");
    test.skip(!jury, "stack not reachable");
    await page.goto(`${jury!.base}/widget/?mode=standalone`);
    await page.getByRole("button", { name: "Jury-Schnellauswahl" }).click();
    await expect(page.getByLabel("Name", { exact: true })).toBeFocused();
    await page.getByLabel("Name", { exact: true }).fill(`Dr. Jury ${Date.now().toString(36)}`);
    await page.getByRole("button", { name: "Anfrage senden" }).click();
    const confirm = page.getByRole("button", { name: "Trotzdem senden" });
    const modal = page.getByRole("dialog");
    await expect(modal.or(confirm).first()).toBeVisible({ timeout: 15_000 });
    if (await confirm.isVisible()) await confirm.click();
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await expect(modal.locator("canvas, svg").first()).toBeVisible();
    await expect(modal).toContainText("Nur Jury-Modus: Im echten Betrieb geht dieser Link ausschließlich per E-Mail/SMS an die Empfängerin.");
    const link = await modal.locator("a[href*='/r/']").getAttribute("href");
    expect(link).toMatch(/^http:\/\/localhost:3103\/r\/[A-Za-z0-9_-]{16,}$/);
    await expect(modal).toContainText(link!);
    const res = await fetch(link!);
    expect(res.status).toBe(200);
  });

  test("default mode: no Jury-Schnellauswahl", async ({ page }) => {
    test.skip(!MERGED["V2-JURY-1"], "TODO V2-JURY-1: unskip when merged");
    test.skip(!(await isCoreUp()), "core not reachable at /health");
    await page.goto("/widget/?mode=standalone");
    await expect(page.getByRole("button", { name: "Anfrage senden" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Jury-Schnellauswahl" })).toHaveCount(0);
  });
});

test("filed lab values are shown German-formatted: INR 1,0, Thrombozyten 245 10⁹/L (V2-UI-1)", async ({ page }) => {
  test.skip(!MERGED["V2-UI-1"], "TODO V2-UI-1: unskip when merged");
  test.skip(!(await isCoreUp()), "core not reachable at /health");
  const { request } = await coreApi.createRequest(labRequest(`eva.brandl+ui1-${Date.now()}@labor-kanal.example`));
  const eva = new OutsidePerson(linkIn((await mailFor(request.reference)).text).url);
  await eva.open();
  await eva.loginWithEid({ persona: "eva-brandl" });
  await eva.submitAnswer({ given: "Maria", family: "Beispiel", birthDate: "1961-03-12", content: fixture("scenario/lab-result-maria-beispiel").content, fileName: "befund.md" });
  await poll("filed", async () => ((await coreApi.detail(request.id)).request.status === "filed" ? true : undefined));

  // The request is in the seeded room (ROOM_ID), not the standalone default room.
  await page.goto(`/widget/?mode=standalone&roomId=${encodeURIComponent(ROOM_ID)}`);
  await page.getByRole("tab", { name: "Anfragen" }).click();
  await page.getByRole("button", { name: new RegExp(request.reference) }).first().click();
  const main = page.locator("body");
  await expect(main).toContainText("Thrombozyten", { timeout: 15_000 });
  await expect(main).toContainText("1,0");
  await expect(main).toContainText("10⁹/L");
  await expect(main).not.toContainText("Platelets");
});

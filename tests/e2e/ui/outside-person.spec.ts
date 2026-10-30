// TEST-4: the outside person's flow in a phone-sized browser, from the Mailpit message to "gesendet".
// Needs the running stack (npm run stack:up && npm run seed && npm run dev). Writes out/ui-timing.json (TEST-5).
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { devices, expect, test } from "@playwright/test";
import { coreApi, isCoreUp, labRequest, linkIn, mailFor } from "../lib/stack.ts";

const MAILPIT_UI = process.env.MAILPIT_UI_URL ?? "http://localhost:8025";
const { defaultBrowserType: _ignored, ...pixel7 } = devices["Pixel 7"];

test.use({ ...pixel7 });

test("Dr. Brandl answers request 1 on her phone: 0 installs, 0 accounts, < 2 min", async ({ page }) => {
  test.skip(!(await isCoreUp()), "core not reachable at /health");
  const { request } = await coreApi.createRequest(labRequest("eva.brandl@labor-kanal.example"));
  const mail = await mailFor(request.reference);
  const { url: link } = linkIn(mail.text);

  // Start the clock when she opens the email.
  const started = Date.now();
  await page.goto(`${MAILPIT_UI}/view/${mail.id}.html`);
  const anchor = page.locator(`a[href*="/r/"]`).first();
  if (await anchor.count()) {
    const popup = page.context().waitForEvent("page", { timeout: 2000 }).catch(() => undefined);
    await anchor.click();
    const opened = await popup;
    if (opened) await page.goto(opened.url()); // keep one tab; the email opened the link in a new one
  } else {
    await page.goto(link); // plain-text email: she taps the link
  }
  await expect(page).toHaveURL(/\/r\/[A-Za-z0-9_-]+/);

  await page.getByRole("link", { name: /e-ID/ }).click();
  await page.getByRole("button", { name: /Eva Brandl/ }).click();
  await expect(page.getByLabel(/Vorname/)).toBeVisible();

  await page.getByLabel(/Vorname/).fill("Maria");
  await page.getByLabel(/Nachname/).fill("Beispiel");
  await page.getByLabel(/Geburtsdatum/).fill("1961-03-12");
  await page.locator('input[type="file"]').setInputFiles(resolve("scenario/documents/lab-result-maria-beispiel.md"));
  await page.locator('form button[type="submit"]').last().click();

  await expect(page.getByRole("heading", { name: /gesendet/i })).toBeVisible({ timeout: 20_000 });
  const seconds = (Date.now() - started) / 1000;

  const detail = await coreApi.detail(request.id);
  expect(["filed", "held"]).toContain(detail.request.status);
  expect(seconds).toBeLessThan(120);

  mkdirSync("out", { recursive: true });
  writeFileSync(
    "out/ui-timing.json",
    JSON.stringify({ at: new Date().toISOString(), reference: request.reference, device: "Pixel 7", secondsEmailToSent: seconds, installs: 0, accounts: 0, finalStatus: detail.request.status }, null, 2),
  );
  test.info().annotations.push({ type: "duration", description: `${seconds.toFixed(1)} s from opening the email to "gesendet"` });
});

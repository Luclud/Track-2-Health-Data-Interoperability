// TEST-4: Dr. Hofer creates request 1 in the doctor UI, standalone mode (no Element). Needs the running stack.
import { expect, test } from "@playwright/test";
import { isCoreUp, mailFor } from "../lib/stack.ts";

test("doctor UI (standalone) sends a lab-result request by email", async ({ page }) => {
  test.skip(!(await isCoreUp()), "core not reachable at /health");
  await page.goto("/widget/?mode=standalone");

  await page.getByPlaceholder(/Name suchen/).fill("Beispiel");
  await page.getByRole("option", { name: /Beispiel, Maria/ }).click();
  await page.getByRole("radiogroup", { name: "Dokumentart" }).getByText("Laborbefund").click();
  await page.getByLabel("Notiz").fill("Gerinnung vor OP");

  await page.getByLabel("Name", { exact: true }).fill("Dr. Eva Brandl");
  await page.getByLabel("Funktion").fill("Laborärztin");
  await page.getByLabel("Einrichtung").fill("Labor Kanalstraße");
  await page.getByLabel(/Ist Ärztin/).check();
  await page.getByRole("radiogroup", { name: "Kanal" }).getByText("E-Mail").click();
  await page.getByLabel("E-Mail-Adresse").fill("eva.brandl@labor-kanal.example");

  await page.getByRole("button", { name: "Anfrage senden" }).click();
  const confirm = page.getByRole("button", { name: "Trotzdem senden" });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();

  const banner = page.getByRole("status").filter({ hasText: /Anfrage BT-/ });
  await expect(banner).toBeVisible({ timeout: 15_000 });
  const reference = /BT-[0-9A-Z]{4}/.exec((await banner.textContent()) ?? "")?.[0];
  expect(reference).toBeDefined();
  const mail = await mailFor(reference!);
  expect(mail.to).toContain("eva.brandl@labor-kanal.example");
});

// Demo screenshots (laptop + phone) of the standalone doctor UI and the portal. Needs the stack, seed and a running core.
// Usage: npx tsx scripts/screenshots.ts   (writes docs/screenshots/<view>-<device>.png)
import { readFileSync } from "node:fs";
import { chromium, devices, type Page } from "@playwright/test";
import { CORE, coreApi, labRequest, linkIn, mailFor } from "../tests/e2e/lib/stack.ts";

const LAB = readFileSync("scenario/documents/lab-result-maria-beispiel.md", "utf8");
const targets = { laptop: { viewport: { width: 1440, height: 900 } }, phone: { ...devices["Pixel 7"], deviceScaleFactor: 1 } };
const browser = await chromium.launch({ args: ["--lang=de-AT"], env: { ...process.env, LANG: "de_AT.UTF-8", LANGUAGE: "de_AT:de" } });

async function portalLink(address: string) {
  const { request } = await coreApi.createRequest({ ...labRequest(address), roomId: "!standalone:klinikum.example" });
  return { ref: request.reference, url: linkIn((await mailFor(request.reference)).text).url };
}

for (const [device, opts] of Object.entries(targets)) {
  const ctx = await browser.newContext({ ...opts, locale: "de-AT", timezoneId: "Europe/Vienna" });
  const shot = (p: Page, name: string) => p.screenshot({ path: `docs/screenshots/${name}-${device}.png`, fullPage: true });
  const doc = await ctx.newPage();
  await doc.goto(`${CORE}/widget/?mode=standalone`);
  await doc.getByPlaceholder("Name suchen").fill("Beispiel");
  await doc.getByRole("option", { name: /Beispiel, Maria/ }).click();
  await doc.getByLabel("Name", { exact: true }).fill("Dr. Eva Brandl");
  await doc.getByLabel("Funktion").fill("Laborärztin");
  await doc.getByLabel("Einrichtung").fill("Labor Kanalstraße");
  await doc.getByLabel("E-Mail-Adresse").fill("eva.brandl@labor-kanaI.example");
  await doc.getByLabel("E-Mail-Adresse").blur();
  await doc.locator(".warnings").waitFor();
  await shot(doc, "doctor-new-request-warning");

  const p = await ctx.newPage();
  const ok = await portalLink("eva.brandl@labor-kanal.example");
  await p.goto(ok.url);
  await shot(p, "portal-landing");
  await p.getByRole("link", { name: /e-ID/ }).click();
  await shot(p, "mock-eid");
  await p.getByRole("button", { name: /Dr\. Eva Brandl/ }).click();
  await p.getByLabel("Vorname(n)").fill("Maria");
  await p.getByLabel("Nachname").fill("Beispiel");
  await p.getByLabel(/Geburtsdatum/).fill("1961-03-12");
  await p.getByLabel(/Text einfügen/).fill(LAB);
  await p.getByLabel(/Text einfügen/).blur();
  await shot(p, "portal-answer-form");
  await p.getByRole("button", { name: "Sicher senden" }).click();
  await shot(p, "portal-sent");

  await doc.getByRole("tab", { name: "Anfragen" }).click();
  await doc.getByRole("button", { name: new RegExp(ok.ref) }).waitFor();
  await doc.waitForTimeout(3500);
  await shot(doc, "doctor-requests");
  await doc.getByRole("button", { name: new RegExp(ok.ref) }).click();
  await doc.getByRole("heading", { name: "Verlauf" }).waitFor();
  await shot(doc, "doctor-request-filed");

  const typo = await portalLink("eva.brandl@labor-kanaI.example");
  await p.goto(typo.url);
  await p.getByRole("link", { name: /e-ID/ }).click();
  await p.getByRole("button", { name: /Ines Fremd/ }).click();
  await shot(p, "portal-identity-mismatch");
  await ctx.close();
}
await browser.close();

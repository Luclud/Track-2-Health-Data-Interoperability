import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
// Operator check for UI-4: log in to Element as Lena, open the seeded room, accept the one-time
// widget permission and save a screenshot. Needs the stack, `npm run seed` and a running core.
const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
const p = await ctx.newPage();
const outDir = process.env.SHOT_DIR ?? "out/element-check";
mkdirSync(outDir, { recursive: true });
const shot = (n: string) => p.screenshot({ path: `${outDir}/${n}.png` });
const clickIf = async (name: RegExp) => {
  const btn = p.getByRole("button", { name }).first();
  if (await btn.isVisible().catch(() => false)) { await btn.click(); console.log("clicked", name); return true; }
  return false;
};
await p.goto("http://localhost:8080/#/login");
await p.waitForSelector("#mx_LoginForm_username, input[name=username]", { timeout: 60000 });
await p.fill("#mx_LoginForm_username", "lena.hofer");
await p.fill("#mx_LoginForm_password", "demo-lena-2026");
await p.keyboard.press("Enter");
await p.waitForTimeout(8000);
await shot("1-after-login");
for (let i = 0; i < 4; i++) { await clickIf(/skip|later|dismiss|cancel|not now|ok/i); await p.waitForTimeout(800); }
await p.goto("http://localhost:8080/#/room/#anfragen-hofer:klinikum.example");
await p.waitForTimeout(6000);
await shot("2-room");
const remember = p.getByRole("switch", { name: /remember/i }).first();
if (await remember.isVisible().catch(() => false)) await remember.click();
for (let i = 0; i < 3; i++) { await clickIf(/^continue$|^allow$/i); await p.waitForTimeout(1500); }
await p.waitForTimeout(4000);
for (let i = 0; i < 3; i++) {
  const close = p.getByRole("button", { name: /close dialog/i }).first();
  if (await close.isVisible().catch(() => false)) await close.click();
  await clickIf(/^later$|^dismiss$/i);
  await p.waitForTimeout(1000);
}
await shot("3-widget");
const frame = p.frames().find((f) => f.url().includes("localhost:3000/widget"));
if (!frame) {
  console.error("widget iframe not found – is the widget pinned? (npm run seed)");
  process.exitCode = 1;
} else {
  console.log("widget loaded:", new URL(frame.url()).pathname);
}
await b.close();

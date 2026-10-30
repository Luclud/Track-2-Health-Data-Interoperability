// Account B, Dev Outside — task OUT-1. SMS simulator: GET /api/dev/sms (JSON) and GET /dev/sms (page).
import type { FastifyInstance } from "fastify";
import type { Deps } from "../container.ts";
import { esc, html, page, SafeHtml } from "../portal/html.ts";

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#2b2d31;font:16px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;justify-content:center;padding:1.5rem .5rem}
.phone{width:min(380px,100%);min-height:640px;background:#111;border-radius:2.4rem;padding:.9rem;box-shadow:0 10px 40px #0008}
.screen{background:#f2f2f7;border-radius:1.7rem;min-height:610px;overflow:hidden}
.top{background:#fff;padding:1.1rem 1rem .7rem;text-align:center;border-bottom:1px solid #ddd}
.top b{display:block;font-size:1.05rem}
.top small{color:#666}
ol{list-style:none;margin:0;padding:.8rem}
li{margin:0 0 1rem}
.meta{font-size:.75rem;color:#777;margin:0 0 .2rem .4rem}
.bubble{background:#e5e5ea;color:#111;padding:.6rem .8rem;border-radius:1.1rem;border-bottom-left-radius:.3rem;max-width:90%;white-space:pre-wrap;overflow-wrap:anywhere}
.bubble a{color:#0a58ca;font-weight:600}
.empty{color:#666;text-align:center;padding:3rem 1rem}
`;

const URL_RE = /https?:\/\/[^\s<>"']+/g;

/** Escapes the text and turns URLs into links. */
export function linkify(text: string): SafeHtml {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:!?)]+$/, "");
    const start = m.index ?? 0;
    out += esc(text.slice(last, start)) + `<a href="${esc(url)}">${esc(url)}</a>`;
    last = start + url.length;
  }
  return new SafeHtml(out + esc(text.slice(last)));
}

const timeFmt = new Intl.DateTimeFormat("de-AT", { timeZone: "Europe/Vienna", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export async function registerNotifyRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.get("/api/dev/sms", async () => {
    const inbox = await deps.sms.inbox();
    return inbox.map((m) => ({ id: m.id, to: m.to, body: m.body, sentAt: m.sentAt }));
  });

  app.get("/dev/sms.css", async (_req, reply) => reply.header("content-type", "text/css; charset=utf-8").send(CSS));

  app.get("/dev/sms", async (_req, reply) => {
    const inbox = await deps.sms.inbox(); // newest first
    const items = inbox.map(
      (m) => html`<li><p class="meta">An ${m.to} · ${timeFmt.format(new Date(m.sentAt))}</p><div class="bubble">${linkify(m.body)}</div></li>`,
    );
    const body = html`<div class="phone"><div class="screen">
<div class="top"><b>SMS-Simulator</b><small>Test-Handy – es werden keine echten SMS versendet</small></div>
${inbox.length ? html`<ol aria-label="Nachrichten, neueste zuerst">${items}</ol>` : html`<p class="empty">Noch keine SMS. Die Seite aktualisiert sich automatisch.</p>`}
</div></div>`;
    return reply
      .header("content-type", "text/html; charset=utf-8")
      .header("cache-control", "no-store")
      .send(page({ title: "SMS-Simulator", body, css: "/dev/sms.css", head: html`<meta http-equiv="refresh" content="5">` }));
  });
}

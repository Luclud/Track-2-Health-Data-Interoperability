// Account B, Dev Outside — task OUT-2. Pages of the mock eID under /mock-eid/*.
// Clearly labelled simulation; no ID Austria logo, colours or branding.
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Deps } from "../container.ts";
import { html, page } from "../portal/html.ts";
import { MockPhysicianRegister } from "../register/index.ts";
import { MockIdAustria } from "./index.ts";
import { loadPersonas, type Persona } from "./personas.ts";

const SIM_LABEL = "Simulierte e-ID – Platzhalter für ID Austria";

const CSS = `
*{box-sizing:border-box}
body{margin:0;font:18px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f3f1ec;color:#222}
main{max-width:34rem;margin:0 auto;padding:1rem}
.sim{background:#5b3a8c;color:#fff;padding:.75rem 1rem;font-weight:700;text-align:center}
.sim small{display:block;font-weight:400;font-size:.85rem;opacity:.9}
h1{font-size:1.4rem;margin:1.2rem 0 .4rem}
p{margin:.4rem 0 1rem}
form{margin:0}
.persona{display:block;width:100%;text-align:left;margin:.5rem 0;padding:1rem;font:inherit;border:2px solid #5b3a8c;border-radius:.6rem;background:#fff;color:#222;cursor:pointer;min-height:3.5rem}
.persona:hover,.persona:focus{background:#efe8f8;outline:3px solid #5b3a8c55}
.persona b{display:block}
.persona span{font-size:.9rem;color:#555}
fieldset{border:2px solid #ccc;border-radius:.6rem;padding:1rem;margin:1.5rem 0;background:#fff}
legend{font-weight:700;padding:0 .3rem}
label{display:block;margin:.8rem 0 .2rem;font-weight:600}
input[type=text],input[type=date]{width:100%;font:inherit;padding:.7rem;border:2px solid #999;border-radius:.4rem}
.check{display:flex;gap:.6rem;align-items:flex-start;font-weight:400}
.check input{width:1.4rem;height:1.4rem;margin-top:.15rem}
.btn{display:block;width:100%;margin-top:1rem;padding:1rem;font:inherit;font-weight:700;color:#fff;background:#5b3a8c;border:0;border-radius:.6rem;min-height:3.5rem;cursor:pointer}
.err{background:#fde8e8;border:2px solid #b42318;padding:.8rem;border-radius:.5rem}
footer{font-size:.85rem;color:#666;margin:2rem 0 1rem}
`;

function sendPage(reply: FastifyReply, title: string, body: ReturnType<typeof html>, code = 200) {
  return reply
    .code(code)
    .header("content-type", "text/html; charset=utf-8")
    .header("cache-control", "no-store")
    .send(page({ title, body, css: "/mock-eid/eid.css" }));
}

function frame(content: ReturnType<typeof html>) {
  return html`<div class="sim" role="banner">${SIM_LABEL}<small>Nur zum Testen. Es findet keine echte Anmeldung statt.</small></div>
<main>${content}<footer>${SIM_LABEL}. Die angezeigten Personen und Kennungen sind erfunden.</footer></main>`;
}

/** Only redirect back to our own portal (no open redirect). */
export function isAllowedRedirect(redirectUri: string, publicBaseUrl: string): boolean {
  try {
    const target = new URL(redirectUri);
    const base = new URL(publicBaseUrl);
    return target.origin === base.origin && target.pathname.startsWith("/r/");
  } catch {
    return false;
  }
}

function hidden(state: string, redirectUri: string) {
  return html`<input type="hidden" name="state" value="${state}"><input type="hidden" name="redirect_uri" value="${redirectUri}">`;
}

function personaButton(p: Persona, state: string, redirectUri: string) {
  const [name, ...rest] = p.label.split(" — ");
  return html`<form method="post" action="/mock-eid/login">${hidden(state, redirectUri)}
<input type="hidden" name="persona" value="${p.key}">
<button class="persona" type="submit"><b>${name}</b>${rest.length ? html`<span>${rest.join(" — ")}</span>` : ""}</button></form>`;
}

function errorPage(reply: FastifyReply, message: string, code = 400) {
  return sendPage(reply, "Simulierte e-ID – Fehler", frame(html`<h1>Anmeldung nicht möglich</h1><p class="err" role="alert">${message}</p>`), code);
}

export async function registerEidRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const eid = deps.eid;
  if (!(eid instanceof MockIdAustria)) return; // a real eID provider brings its own login pages
  const personas = loadPersonas();
  const base = deps.config.publicBaseUrl;

  app.get("/mock-eid/eid.css", async (_req, reply) => reply.header("content-type", "text/css; charset=utf-8").send(CSS));

  app.get<{ Querystring: { state?: string; redirect_uri?: string; login_hint?: string; error?: string } }>(
    "/mock-eid/authorize",
    async (req, reply) => {
      const { state = "", redirect_uri: redirectUri = "", error } = req.query;
      if (!state || !isAllowedRedirect(redirectUri, base)) return errorPage(reply, "Ungültiger Anmeldelink.");
      return sendPage(
        reply,
        "Simulierte e-ID – Anmeldung",
        frame(html`<h1>Wer sind Sie?</h1>
<p>In dieser Simulation wählen Sie selbst, als wer Sie sich ausweisen. Bei der echten e-ID geschieht das mit Ihrem Handy.</p>
${error ? html`<p class="err" role="alert">${error}</p>` : ""}
${personas.map((p) => personaButton(p, state, redirectUri))}
<form method="post" action="/mock-eid/login">${hidden(state, redirectUri)}
<fieldset><legend>Andere Person</legend>
<label for="given">Vorname(n)</label><input id="given" name="given" type="text" autocomplete="off" required>
<label for="family">Nachname</label><input id="family" name="family" type="text" autocomplete="off" required>
<label for="birthDate">Geburtsdatum</label><input id="birthDate" name="birthDate" type="date" required>
<label class="check"><input type="checkbox" name="addToRegister" value="1"> Diese Person für den Test in die Ärzteliste (simuliert) eintragen</label>
<button class="btn" type="submit">Als diese Person anmelden</button>
</fieldset></form>`),
      );
    },
  );

  app.post<{ Body: Record<string, string | undefined> }>("/mock-eid/login", async (req, reply) => {
    const b = req.body ?? {};
    const state = b.state ?? "";
    const redirectUri = b.redirect_uri ?? "";
    if (!state || !isAllowedRedirect(redirectUri, base)) return errorPage(reply, "Ungültiger Anmeldelink.");

    let code: string;
    if (b.persona) {
      const p = personas.find((x) => x.key === b.persona);
      if (!p) return errorPage(reply, "Unbekannte Person.");
      code = eid.issueCode({ name: { given: p.given, family: p.family, ...(p.prefix ? { prefix: p.prefix } : {}) }, birthDate: p.birthDate, subject: p.bpk }, redirectUri);
    } else {
      const given = (b.given ?? "").trim().split(/\s+/).filter(Boolean);
      const family = (b.family ?? "").trim();
      const birthDate = (b.birthDate ?? "").trim();
      if (!given.length || !family || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || Number.isNaN(Date.parse(birthDate))) {
        const back = new URL("/mock-eid/authorize", base);
        back.searchParams.set("state", state);
        back.searchParams.set("redirect_uri", redirectUri);
        back.searchParams.set("error", "Bitte Vorname, Nachname und Geburtsdatum angeben.");
        return reply.redirect(back.pathname + back.search, 303);
      }
      if (b.addToRegister && deps.register instanceof MockPhysicianRegister) {
        deps.register.add({ given, family, birthDate, specialty: "Testperson (simuliert)" });
      }
      code = eid.issueCode({ name: { given, family }, birthDate }, redirectUri);
    }
    const target = new URL(redirectUri);
    target.searchParams.set("code", code);
    target.searchParams.set("state", state);
    return reply.redirect(target.toString(), 303);
  });
}

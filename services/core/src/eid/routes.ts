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
h2{font-size:1.1rem;margin:1.5rem 0 .3rem}
.hint{font-size:.9rem;color:#555;margin:.2rem 0 0}
p{margin:.4rem 0 1rem}
form{margin:0}
.persona{display:block;width:100%;text-align:left;margin:.6rem 0;padding:.9rem 1rem;font:inherit;line-height:1.35;border:2px solid #5b3a8c;border-radius:.75rem;background:#fff;color:#222;cursor:pointer;min-height:3.5rem}
.persona:hover{background:#f4effa}
.persona:focus-visible,.btn:focus-visible,input:focus-visible{outline:3px solid #f5b700;outline-offset:2px}
input[type=text]:focus,input[type=date]:focus{border-color:#5b3a8c}
.persona b{display:block}
.persona span{display:block;margin-top:.2rem;font-size:.9rem;color:#555}
fieldset{border:1px solid #d6d1c7;border-radius:.75rem;padding:1rem;margin:1.5rem 0;background:#fff}
legend{font-weight:700;padding:0 .3rem}
label{display:block;margin:.8rem 0 .2rem;font-weight:600}
input[type=text],input[type=date]{display:block;width:100%;max-width:100%;font:inherit;font-size:max(16px,1em);padding:.7rem;border:2px solid #8a8a8a;border-radius:.55rem;background:#fff;color:#222;min-height:3.25rem}
.check{display:flex;gap:.6rem;align-items:flex-start;font-weight:400}
.check input{width:1.4rem;height:1.4rem;margin-top:.15rem}
.btn{display:block;width:100%;margin-top:1.2rem;padding:1rem;font:inherit;font-weight:700;color:#fff;background:#5b3a8c;border:0;border-radius:.75rem;min-height:3.5rem;cursor:pointer}
.err{background:#fdecea;border-left:6px solid #b3261e;padding:.8rem 1rem;border-radius:.5rem}
.btn:hover{background:#4a2f73}
footer{font-size:.85rem;color:#666;margin:2rem 0 1rem;padding-top:1rem;border-top:1px solid #d6d1c7}
@media (max-width:24rem){main{padding:.75rem}fieldset{padding:.75rem}}
@media (min-width:48rem){body{font-size:17px}}
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
      const today = new Date().toISOString().slice(0, 10);
      // Never prefilled (not even from login_hint): the person types who they really are.
      const other = html`<form method="post" action="/mock-eid/login">${hidden(state, redirectUri)}
<fieldset><legend>${deps.config.juryMode ? "Ich bin …" : "Andere Person"}</legend>
${deps.config.juryMode ? html`<p class="hint">Tragen Sie Ihren eigenen Namen ein.</p>` : ""}
<label for="given">Vorname(n)</label><input id="given" name="given" type="text" autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="next" required>
<label for="family">Nachname</label><input id="family" name="family" type="text" autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="next" required>
<label for="birthDate">Geburtsdatum</label><input id="birthDate" name="birthDate" type="date" min="1900-01-01" max="${today}" required>
<label class="check"><input type="checkbox" name="addToRegister" value="1"> Diese Person für den Test in die Ärzteliste (simuliert) eintragen</label>
<button class="btn" type="submit">Als diese Person anmelden</button>
</fieldset></form>`;
      const list = personas.map((p) => personaButton(p, state, redirectUri));
      return sendPage(
        reply,
        "Simulierte e-ID – Anmeldung",
        frame(html`<h1>Wer sind Sie?</h1>
<p>In dieser Simulation wählen Sie selbst, als wer Sie sich ausweisen. Bei der echten e-ID geschieht das mit Ihrem Handy.</p>
${error ? html`<p class="err" role="alert">${error}</p>` : ""}
${deps.config.juryMode ? html`${other}<h2>Oder eine Testperson wählen</h2>${list}` : html`${list}${other}`}`),
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

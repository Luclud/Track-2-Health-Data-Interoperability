// Account B, Dev Outside — task OUT-3. The outside person's browser flow under /r/:token.
// Uses ONLY deps.requests (RequestService) and deps.eid — never the repository or FHIR directly.
//
//   GET  /r/:token              landing (PublicRequestView only) + "Mit e-ID anmelden (simuliert)"
//   GET  /r/:token/login        sets a signed state cookie, redirects to the eID
//   GET  /r/:token/callback     eID callback -> completeIdentityCheck -> signed session cookie
//   GET  /r/:token/answer       form (patient given/family name, birth date, file upload or textarea)
//   POST /r/:token/answer       -> submitAnswer -> result page
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { VerifiedIdentity } from "@brieftaube/shared";
import type { Deps } from "../container.ts";
import type { AnswerInput, AuthorizedRequestView, PublicRequestView, RequestMeta } from "../ports.ts";
import * as V from "./views.ts";

const CSS = readFileSync(new URL("./portal.css", import.meta.url), "utf8");
const SESSION_TTL_MS = 30 * 60 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;
const SESSION_COOKIE = "bt_session";
const STATE_COOKIE = "bt_state";
const MAX_CONTENT_BYTES = 1024 * 1024;

interface PortalSession { token: string; identity: VerifiedIdentity; view: AuthorizedRequestView; expiresAt: number }
interface PendingLogin { token: string; view: PublicRequestView; expiresAt: number }

/** In-memory, server-side state. Cookies only carry signed random ids; patient data never leaves the server in a cookie. */
class Store<T extends { expiresAt: number }> {
  private readonly items = new Map<string, T>();
  constructor(private readonly now: () => number) {}
  put(value: T): string {
    for (const [k, v] of this.items) if (v.expiresAt < this.now()) this.items.delete(k);
    const id = randomBytes(24).toString("base64url");
    this.items.set(id, value);
    return id;
  }
  get(id: string | undefined): T | undefined {
    if (!id) return undefined;
    const v = this.items.get(id);
    if (v && v.expiresAt < this.now()) {
      this.items.delete(id);
      return undefined;
    }
    return v;
  }
  delete(id: string | undefined): void {
    if (id) this.items.delete(id);
  }
}

export function requestMeta(req: FastifyRequest): RequestMeta {
  const ua = req.headers["user-agent"];
  return { ipHash: createHash("sha256").update(req.ip ?? "").digest("hex"), ...(ua ? { userAgent: String(ua).slice(0, 300) } : {}) };
}

function readSigned(req: FastifyRequest, name: string): string | undefined {
  const raw = req.cookies?.[name];
  if (!raw) return undefined;
  const r = req.unsignCookie(raw);
  return r.valid && r.value ? r.value : undefined;
}

function sendHtml(reply: FastifyReply, body: string, code = 200) {
  return reply.code(code).header("content-type", "text/html; charset=utf-8").header("cache-control", "no-store").header("referrer-policy", "no-referrer").send(body);
}

export async function registerPortalRoutes(root: FastifyInstance, deps: Deps, now: () => number = Date.now): Promise<void> {
  await root.register(async (app) => portalPlugin(app, deps, now));
}

async function portalPlugin(app: FastifyInstance, deps: Deps, now: () => number): Promise<void> {
  const sessions = new Store<PortalSession>(now);
  const logins = new Store<PendingLogin>(now);
  const base = deps.config.publicBaseUrl.replace(/\/$/, "");
  const secure = base.startsWith("https://");
  const cookiePath = (token: string) => `/r/${encodeURIComponent(token)}`;
  const callbackUrl = (token: string) => `${base}${cookiePath(token)}/callback`;
  const cookieOpts = (token: string, ttl: number) => ({ path: cookiePath(token), httpOnly: true, sameSite: "lax" as const, secure, signed: true, maxAge: Math.floor(ttl / 1000) });

  function currentSession(req: FastifyRequest, token: string): PortalSession | undefined {
    const s = sessions.get(readSigned(req, SESSION_COOKIE));
    return s && s.token === token ? s : undefined;
  }

  app.get("/r/static/portal.css", async (_req, reply) => reply.header("content-type", "text/css; charset=utf-8").header("cache-control", "public, max-age=300").send(CSS));

  app.get<{ Params: { token: string } }>("/r/:token", async (req, reply) => {
    const { token } = req.params;
    const opened = await deps.requests.openLink(token, requestMeta(req));
    if (!opened) return sendHtml(reply, V.unknownLinkPage(), 404);
    const { view } = opened;
    if (view.status !== "open") return sendHtml(reply, V.closedPage(view), 410);
    if (currentSession(req, token)) return reply.redirect(`${cookiePath(token)}/answer`, 303);
    return sendHtml(reply, V.landingPage(view, `${cookiePath(token)}/login`));
  });

  app.get<{ Params: { token: string } }>("/r/:token/login", async (req, reply) => {
    const { token } = req.params;
    const opened = await deps.requests.openLink(token, requestMeta(req));
    if (!opened) return sendHtml(reply, V.unknownLinkPage(), 404);
    if (opened.view.status !== "open") return sendHtml(reply, V.closedPage(opened.view), 410);
    const state = logins.put({ token, view: opened.view, expiresAt: now() + STATE_TTL_MS });
    reply.setCookie(STATE_COOKIE, state, cookieOpts(token, STATE_TTL_MS));
    return reply.redirect(deps.eid.authorizationUrl({ state, redirectUri: callbackUrl(token), loginHint: opened.view.recipientDisplayName }), 303);
  });

  app.get<{ Params: { token: string }; Querystring: { code?: string; state?: string; error?: string } }>("/r/:token/callback", async (req, reply) => {
    const { token } = req.params;
    const { code, state } = req.query;
    const cookieState = readSigned(req, STATE_COOKIE);
    const pending = logins.get(state);
    reply.clearCookie(STATE_COOKIE, { path: cookiePath(token) });
    if (!code || !state || state !== cookieState || !pending || pending.token !== token) {
      return sendHtml(reply, V.loginRetryPage(`${cookiePath(token)}/login`), 400);
    }
    logins.delete(state);

    let identity: VerifiedIdentity;
    try {
      identity = await deps.eid.exchangeCode(code, callbackUrl(token));
    } catch (err) {
      req.log.warn({ err }, "eID code exchange failed");
      return sendHtml(reply, V.loginRetryPage(`${cookiePath(token)}/login`), 400);
    }

    const outcome = await deps.requests.completeIdentityCheck(token, identity, requestMeta(req));
    if (!outcome.ok || !outcome.view) {
      const reason = outcome.ok ? "name-mismatch" : outcome.reason;
      return sendHtml(reply, V.identityFailedPage(pending.view, reason), 403);
    }
    const sid = sessions.put({ token, identity: outcome.identity, view: outcome.view, expiresAt: now() + SESSION_TTL_MS });
    reply.setCookie(SESSION_COOKIE, sid, cookieOpts(token, SESSION_TTL_MS));
    return reply.redirect(`${cookiePath(token)}/answer`, 303);
  });

  app.get<{ Params: { token: string } }>("/r/:token/answer", async (req, reply) => {
    const s = currentSession(req, req.params.token);
    if (!s) return reply.redirect(cookiePath(req.params.token), 303);
    return sendHtml(reply, V.answerPage(s.view, s.identity, {}));
  });

  app.post<{ Params: { token: string } }>("/r/:token/answer", async (req, reply) => {
    const { token } = req.params;
    const s = currentSession(req, token);
    if (!s) return reply.redirect(cookiePath(token), 303);

    let form: V.AnswerForm;
    try {
      form = await readAnswerForm(req);
    } catch (err) {
      req.log.warn({ err }, "could not read answer form");
      return sendHtml(reply, V.answerPage(s.view, s.identity, {}, { form: "Die Datei konnte nicht gelesen werden (höchstens 1 MB, .md oder .txt)." }), 400);
    }
    const errors = V.validateAnswer(form);
    if (Object.keys(errors).length > 0) return sendHtml(reply, V.answerPage(s.view, s.identity, form, errors), 400);

    const answer: AnswerInput = {
      patientGiven: form.patientGiven!.trim(),
      patientFamily: form.patientFamily!.trim(),
      patientBirthDate: form.patientBirthDate!.trim(),
      content: (form.fileContent ?? form.content ?? "").replace(/^\uFEFF/, ""),
      ...(form.fileName ? { fileName: form.fileName } : {}),
    };
    const outcome = await deps.requests.submitAnswer(token, s.identity, answer, requestMeta(req));
    if (outcome.result === "rejected") {
      return sendHtml(reply, V.answerPage(s.view, s.identity, { patientGiven: form.patientGiven, patientFamily: form.patientFamily, patientBirthDate: form.patientBirthDate }, {}, outcome), 422);
    }
    sessions.delete(readSigned(req, SESSION_COOKIE));
    reply.clearCookie(SESSION_COOKIE, { path: cookiePath(token) });
    return sendHtml(reply, V.resultPage(s.view, outcome));
  });

  // Encapsulated: only applies to the portal routes above.
  app.setErrorHandler((err, req, reply) => {
    req.log.error({ err }, "portal error");
    return sendHtml(reply, V.errorPage(), 500);
  });
}

async function readAnswerForm(req: FastifyRequest): Promise<V.AnswerForm> {
  const form: V.AnswerForm = {};
  if (!req.isMultipart()) {
    const b = (req.body ?? {}) as Record<string, string | undefined>;
    return { patientGiven: b.patientGiven, patientFamily: b.patientFamily, patientBirthDate: b.patientBirthDate, content: b.content };
  }
  for await (const part of req.parts({ limits: { fileSize: MAX_CONTENT_BYTES } })) {
    if (part.type === "file") {
      const buf = await part.toBuffer();
      if (part.file.truncated) throw new Error("file too large");
      if (buf.length > 0) {
        form.fileName = part.filename;
        form.fileContent = buf.toString("utf8");
      }
    } else {
      (form as Record<string, unknown>)[part.fieldname] = String(part.value ?? "");
    }
  }
  return form;
}

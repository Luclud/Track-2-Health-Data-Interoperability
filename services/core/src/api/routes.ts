// Account A, Dev Core — task CORE-8. JSON API for the doctor UI. Contract: packages/shared/src/api.ts
import type { FastifyInstance, FastifyRequest } from "fastify";
import type {
  ApiError, CreateRequestBody, CreateRequestResponse, DocumentType, HeldDecisionResponse, MeResponse,
  PatientSnapshot, RecipientCheckBody, RecipientCheckResponse, Requester, UiConfigResponse,
} from "@brieftaube/shared";
import type { Patient } from "fhir/r4.js";
import type { Deps } from "../container.ts";
import { DomainError } from "../domain/errors.ts";
import { patientSnapshot } from "../domain/service.ts";
import { toView } from "../domain/views.ts";
import { foldText } from "../parser/names.ts";
import { DoctorAuth } from "./auth.ts";

declare module "fastify" {
  interface FastifyRequest {
    requester?: Requester;
  }
}

const DOC_TYPES: DocumentType[] = ["lab-result", "rehab-discharge-report"];
const bad = (message: string) => new DomainError("invalid-body", message, 400);
const str = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

function recipientCheckBody(b: unknown): RecipientCheckBody {
  const r = (b ?? {}) as Record<string, unknown>;
  if (r.channel !== "email" && r.channel !== "sms") throw bad("channel muss email oder sms sein");
  if (!str(r.address)) throw bad("address fehlt");
  if (!str(r.displayName)) throw bad("displayName fehlt");
  return { channel: r.channel, address: r.address, displayName: r.displayName };
}

function createBody(b: unknown, defaultRoomId: string): CreateRequestBody {
  const r = (b ?? {}) as Record<string, unknown>;
  if (!str(r.patientId)) throw bad("patientId fehlt");
  if (!DOC_TYPES.includes(r.documentType as DocumentType)) throw bad("documentType ungültig");
  const rec = (r.recipient ?? {}) as Record<string, unknown>;
  const { channel, address, displayName } = recipientCheckBody(rec);
  if (r.note !== undefined && typeof r.note !== "string") throw bad("note muss Text sein");
  return {
    patientId: r.patientId,
    documentType: r.documentType as DocumentType,
    ...(typeof r.note === "string" ? { note: r.note } : {}),
    roomId: str(r.roomId) ? r.roomId : defaultRoomId,
    recipient: {
      displayName,
      role: typeof rec.role === "string" ? rec.role : "",
      organization: typeof rec.organization === "string" ? rec.organization : "",
      isPhysician: rec.isPhysician === true,
      channel,
      address,
    },
    acknowledgeWarnings: r.acknowledgeWarnings === true,
  };
}

function matchesPatient(p: PatientSnapshot, q: string): boolean {
  const needle = foldText(q).trim();
  if (!needle) return true;
  const hay = foldText(`${p.name.given.join(" ")} ${p.name.family} ${p.birthDate} ${p.fhirId}`);
  return needle.split(/\s+/).every((w) => hay.includes(w));
}

export async function registerApiRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const auth = new DoctorAuth(deps.config, deps.fhir);
  const me = (req: FastifyRequest) => req.requester!;

  await app.register(async (api) => {
    api.setErrorHandler((err, req, reply) => {
      const e = err as Error & { code?: string; status?: number; details?: unknown; statusCode?: number; validation?: unknown };
      if (err instanceof DomainError) {
        const body: ApiError & { details?: unknown } = { error: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) };
        return reply.code(err.status).send(body);
      }
      if (e.name === "NotImplementedError") return reply.code(501).send({ error: "not-implemented", message: e.message } satisfies ApiError);
      if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: "bad-request", message: e.message } satisfies ApiError);
      req.log.error(err);
      return reply.code(500).send({ error: "internal", message: "Interner Fehler" } satisfies ApiError);
    });

    api.addHook("onRequest", async (req) => {
      if (req.url.startsWith("/api/chat/") || req.url.startsWith("/api/dev/") || req.url.split("?")[0] === "/api/ui-config") return;
      req.requester = await auth.authenticate(req.headers);
    });

    api.get("/api/ui-config", async (): Promise<UiConfigResponse> => ({
      juryMode: deps.config.juryMode,
      llmEnabled: deps.config.llmProvider !== "none",
    }));

    api.get("/api/me", async (req): Promise<MeResponse> => {
      const r = me(req);
      return { matrixUserId: r.matrixUserId, displayName: r.displayName, organization: r.organization };
    });

    api.get<{ Querystring: { q?: string } }>("/api/patients", async (req): Promise<PatientSnapshot[]> => {
      const all = await deps.fhir.search<Patient>("Patient", { _count: "100" });
      const out: PatientSnapshot[] = [];
      for (const p of all) {
        try {
          out.push(patientSnapshot(p));
        } catch {
          // skip incomplete patients
        }
      }
      return out
        .filter((p) => matchesPatient(p, req.query.q ?? ""))
        .sort((a, b) => a.name.family.localeCompare(b.name.family, "de") || a.name.given.join(" ").localeCompare(b.name.given.join(" "), "de"));
    });

    api.post("/api/recipient-check", async (req): Promise<RecipientCheckResponse> => {
      return { warnings: await deps.requests.checkRecipient(me(req), recipientCheckBody(req.body)) };
    });

    api.post("/api/requests", async (req, reply) => {
      const body = createBody(req.body, deps.config.defaultRoomId);
      if (!body.acknowledgeWarnings) {
        const warnings = await deps.requests.checkRecipient(me(req), body.recipient);
        if (warnings.length) throw new DomainError("recipient-warnings", "Bitte die Warnungen zur Adresse bestätigen.", 409, { warnings });
      }
      const { request, warnings, link } = await deps.requests.createRequest(me(req), body);
      const res: CreateRequestResponse = { request: toView(request), warnings };
      if (deps.config.juryMode && link) res.juryLink = link;
      return reply.code(201).send(res);
    });

    api.get<{ Querystring: { roomId?: string } }>("/api/requests", async (req) => {
      const list = await deps.requests.listForRoom(req.query.roomId?.trim() || deps.config.defaultRoomId);
      return list.map(toView);
    });

    api.get<{ Params: { id: string } }>("/api/requests/:id", async (req) => {
      const d = await deps.requests.detail(req.params.id);
      if (!d) throw new DomainError("request-not-found", "Anfrage nicht gefunden.", 404);
      return d;
    });

    for (const action of ["release", "reject"] as const) {
      api.post<{ Params: { id: string } }>(`/api/requests/:id/${action}`, async (req): Promise<HeldDecisionResponse> => {
        const r = await deps.requests[action](req.params.id, me(req));
        return { request: toView(r) };
      });
    }
  });
}

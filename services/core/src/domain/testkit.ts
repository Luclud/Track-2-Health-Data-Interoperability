// Test helpers: a fully in-memory RequestService with the scenario patient seeded. No Docker, no network.
import { readFileSync } from "node:fs";
import type { Patient } from "fhir/r4.js";
import type { CreateRequestBody, RegisterResult, Requester, VerifiedIdentity } from "@brieftaube/shared";
import { config } from "../config.ts";
import { InMemoryChatNotifier } from "../chat/index.ts";
import { MemorySender } from "../notify/index.ts";
import { MemoryFhirStore } from "../fhir/memory-store.ts";
import { SqliteAuditLog } from "../audit/index.ts";
import { SqliteRequestRepository } from "../db/index.ts";
import { createDocumentParser } from "../parser/index.ts";
import type { LlmClient, PhysicianRegister } from "../ports.ts";
import { createRequestService, type RequestServiceDeps } from "./index.ts";

export const lena: Requester = {
  matrixUserId: "@lena.hofer:klinikum.example",
  displayName: "Dr. Lena Hofer",
  organization: "Klinikum Beispielstadt",
  practitionerId: "lena-hofer",
};

type Persona = { key: string; given: string[]; family: string; prefix?: string[]; birthDate: string; bpk: string };
const personas = (JSON.parse(readFileSync("infra/mock-eid-personas.json", "utf8")) as { personas: Persona[] }).personas;

/** Simulated eID identity by persona key (eva-brandl, stefan-kern, thomas-gruber, ines-fremd) or first name. */
export function identity(key: string, at = "2026-10-30T09:11:05+01:00", loa: VerifiedIdentity["levelOfAssurance"] = "high"): VerifiedIdentity {
  const p = personas.find((x) => x.key === key || x.given[0]?.toLowerCase() === key);
  if (!p) throw new Error(`unknown persona ${key}`);
  return {
    provider: "mock-id-austria",
    subject: p.bpk,
    name: { given: p.given, family: p.family, ...(p.prefix ? { prefix: p.prefix } : {}) },
    birthDate: p.birthDate,
    levelOfAssurance: loa,
    authenticatedAt: at,
  };
}

export class FakeRegister implements PhysicianRegister {
  constructor(private readonly listed: Record<string, string> = { "GH:mock-bpk-eva-brandl": "AT-LAB-4711" }) {}
  async lookup(i: VerifiedIdentity): Promise<RegisterResult> {
    const n = this.listed[i.subject];
    return { checked: true, listed: !!n, registerName: "Ärzteliste (simuliert)", ...(n ? { registrationNumber: n } : {}) };
  }
}

export const noLlm: LlmClient = {
  enabled: false,
  completeJson: async () => {
    throw new Error("LLM disabled");
  },
};

export function mariaPatient(): Patient & { id: string } {
  return JSON.parse(readFileSync("scenario/patient.json", "utf8"));
}

export function testDeps(overrides: Partial<RequestServiceDeps> = {}) {
  const fhir = new MemoryFhirStore();
  const p = mariaPatient();
  void fhir.upsert({ ...p, id: p.id ?? "maria-beispiel" });
  const deps = {
    config: { ...config, dataDir: ":memory:", publicBaseUrl: "http://localhost:3000" },
    chat: new InMemoryChatNotifier(),
    email: new MemorySender(),
    sms: new MemorySender(),
    register: new FakeRegister(),
    fhir,
    audit: new SqliteAuditLog({ dataDir: ":memory:", log: () => {} }, fhir),
    repo: new SqliteRequestRepository({ dataDir: ":memory:" }),
    parser: createDocumentParser(),
    llm: noLlm,
    ...overrides,
  };
  return { deps, service: createRequestService(deps) };
}

export const labBody: CreateRequestBody = {
  patientId: "maria-beispiel",
  documentType: "lab-result",
  note: "Aktuelle Gerinnungswerte vor geplantem Eingriff",
  roomId: "!room:klinikum.example",
  recipient: { displayName: "Dr. Eva Brandl", role: "Laborärztin", organization: "Labor Kanalstraße", isPhysician: true, channel: "email", address: "eva.brandl@labor-kanal.example" },
};
export const rehabBody: CreateRequestBody = {
  patientId: "maria-beispiel",
  documentType: "rehab-discharge-report",
  roomId: "!room:klinikum.example",
  recipient: { displayName: "Stefan Kern", role: "Entlassungsmanagement", organization: "Reha Waldblick", isPhysician: false, channel: "sms", address: "+43 660 000 0101" },
};


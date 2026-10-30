// Wires the implementations together. Owned by the coordinator.
// Each area exposes a factory; replace a stub by changing the factory in its own folder, not here.

import type { Config } from "./config.ts";
import type {
  AuditLog,
  ChatNotifier,
  DocumentParser,
  FhirStore,
  IdentityProvider,
  LlmClient,
  MessageSender,
  PhysicianRegister,
  RequestRepository,
  RequestService,
} from "./ports.ts";
import { createChatNotifier } from "./chat/index.ts";
import { createMessageSenders } from "./notify/index.ts";
import { createIdentityProvider } from "./eid/index.ts";
import { createPhysicianRegister } from "./register/index.ts";
import { createFhirStore } from "./fhir/store.ts";
import { createAuditLog } from "./audit/index.ts";
import { createRequestRepository } from "./db/index.ts";
import { createDocumentParser } from "./parser/index.ts";
import { createLlmClient } from "./llm/index.ts";
import { createRequestService } from "./domain/index.ts";

export interface Deps {
  config: Config;
  chat: ChatNotifier;
  email: MessageSender;
  sms: MessageSender & { inbox(): Promise<{ id: string; to: string; body: string; sentAt: string }[]> };
  eid: IdentityProvider;
  register: PhysicianRegister;
  fhir: FhirStore;
  audit: AuditLog;
  repo: RequestRepository;
  parser: DocumentParser;
  llm: LlmClient;
  requests: RequestService;
}

export function createDeps(config: Config, overrides: Partial<Deps> = {}): Deps {
  const chat = overrides.chat ?? createChatNotifier(config);
  const senders = createMessageSenders(config);
  const email = overrides.email ?? senders.email;
  const sms = overrides.sms ?? senders.sms;
  const eid = overrides.eid ?? createIdentityProvider(config);
  const register = overrides.register ?? createPhysicianRegister(config);
  const fhir = overrides.fhir ?? createFhirStore(config);
  const audit = overrides.audit ?? createAuditLog(config, fhir);
  const repo = overrides.repo ?? createRequestRepository(config);
  const parser = overrides.parser ?? createDocumentParser();
  const llm = overrides.llm ?? createLlmClient(config);
  const requests =
    overrides.requests ??
    createRequestService({ config, chat, email, sms, register, fhir, audit, repo, parser, llm });
  return { config, chat, email, sms, eid, register, fhir, audit, repo, parser, llm, requests };
}

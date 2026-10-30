// Account A, Dev Core — tasks CORE-3/4/5. The application service: state machine, identity policy, patient check.
import type { Config } from "../config.ts";
import type {
  AuditLog, ChatNotifier, DocumentParser, FhirStore, LlmClient, MessageSender,
  PhysicianRegister, RequestRepository, RequestService,
} from "../ports.ts";
import type { HeldAnswerStore } from "../db/index.ts";
import { CoreRequestService } from "./service.ts";

export interface RequestServiceDeps {
  config: Config;
  chat: ChatNotifier;
  email: MessageSender;
  sms: MessageSender;
  register: PhysicianRegister;
  fhir: FhirStore;
  audit: AuditLog;
  repo: RequestRepository;
  parser: DocumentParser;
  llm: LlmClient;
  /** Clock, injectable for tests */
  now?: () => Date;
  /** Held answers until released/rejected (default: the repo if it can, else in memory) */
  held?: HeldAnswerStore;
  /** Warnings that must not fail the request (default console.warn) */
  log?: (message: string) => void;
}

export { DomainError } from "./errors.ts";

export function createRequestService(deps: RequestServiceDeps): RequestService {
  const s = new CoreRequestService(deps);
  return {
    checkRecipient: s.checkRecipient.bind(s),
    createRequest: s.createRequest.bind(s),
    listForRoom: s.listForRoom.bind(s),
    detail: s.detail.bind(s),
    openLink: s.openLink.bind(s),
    completeIdentityCheck: s.completeIdentityCheck.bind(s),
    submitAnswer: s.submitAnswer.bind(s),
    release: s.release.bind(s),
    reject: s.reject.bind(s),
  };
}

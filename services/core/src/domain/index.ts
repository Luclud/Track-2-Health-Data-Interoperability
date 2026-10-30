// Account A, Dev Core — tasks CORE-3/4/5. The application service: state machine, identity policy, patient check.
import type { Config } from "../config.ts";
import type {
  AuditLog, ChatNotifier, DocumentParser, FhirStore, LlmClient, MessageSender,
  PhysicianRegister, RequestRepository, RequestService,
} from "../ports.ts";
import { NotImplementedError } from "../not-implemented.ts";
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
  /** Warnings that must not fail the request (default console.warn) */
  log?: (message: string) => void;
}

export { DomainError } from "./errors.ts";

export function createRequestService(deps: RequestServiceDeps): RequestService {
  const s = new CoreRequestService(deps);
  const todo = (m: string, task: string) => async (): Promise<never> => {
    throw new NotImplementedError(`RequestService.${m}`, task);
  };
  return {
    checkRecipient: s.checkRecipient.bind(s),
    createRequest: s.createRequest.bind(s),
    listForRoom: s.listForRoom.bind(s),
    detail: s.detail.bind(s),
    openLink: s.openLink.bind(s),
    completeIdentityCheck: s.completeIdentityCheck.bind(s),
    submitAnswer: todo("submitAnswer", "CORE-5"),
    release: todo("release", "CORE-11"),
    reject: todo("reject", "CORE-11"),
  };
}

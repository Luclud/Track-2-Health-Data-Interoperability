// Account A, Dev Core — tasks CORE-3/4/5. The application service: state machine, identity policy, patient check.
import type { Config } from "../config.ts";
import type {
  AuditLog, ChatNotifier, DocumentParser, FhirStore, LlmClient, MessageSender,
  PhysicianRegister, RequestRepository, RequestService,
} from "../ports.ts";
import { NotImplementedError } from "../not-implemented.ts";

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
}

export function createRequestService(_deps: RequestServiceDeps): RequestService {
  const todo = (m: string) => async (): Promise<never> => {
    throw new NotImplementedError(`RequestService.${m}`, "CORE-3");
  };
  return {
    checkRecipient: todo("checkRecipient"),
    createRequest: todo("createRequest"),
    listForRoom: todo("listForRoom"),
    detail: todo("detail"),
    openLink: todo("openLink"),
    completeIdentityCheck: todo("completeIdentityCheck"),
    submitAnswer: todo("submitAnswer"),
    release: todo("release"),
    reject: todo("reject"),
  };
}

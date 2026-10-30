import type { DocumentRequest, IdentityPolicyId, RegisterResult, VerifiedIdentity } from "@brieftaube/shared";

/** Everything the builders need to file an accepted answer. Pure input, no I/O. */
export interface FilingContext {
  request: DocumentRequest;
  identity: VerifiedIdentity;
  register: RegisterResult;
  policy: IdentityPolicyId;
  answer: { fileName: string; content: string; sha256: string };
  identityCheckedAt: string;
  answerSentAt: string;
  filedAt: string;
  /** Who released a held answer (P2), shown in the Provenance narrative */
  releasedBy?: string;
  /** Inject for deterministic tests */
  newUuid?: () => string;
}

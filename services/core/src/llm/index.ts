// Account A, Dev Core — task CORE-9. Provider-agnostic LLM client. LLM_PROVIDER=none disables the fallback cleanly.
import type { Config } from "../config.ts";
import type { LlmClient } from "../ports.ts";
import { NotImplementedError } from "../not-implemented.ts";

export class DisabledLlmClient implements LlmClient {
  readonly enabled = false;
  async completeJson(): Promise<unknown> {
    throw new Error("LLM fallback disabled (LLM_PROVIDER=none)");
  }
}

export function createLlmClient(config: Config): LlmClient {
  if (config.llmProvider === "none") return new DisabledLlmClient();
  // TODO CORE-9: anthropic | perplexity | openai-compatible | mock
  throw new NotImplementedError(`LLM provider ${config.llmProvider}`, "CORE-9");
}

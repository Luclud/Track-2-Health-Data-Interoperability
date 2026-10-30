// Account A, Dev Core — task CORE-9. Provider-agnostic LLM client. LLM_PROVIDER=none disables the fallback cleanly.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ParseResult } from "@brieftaube/shared";
import type { Config } from "../config.ts";
import type { LlmClient } from "../ports.ts";
import { EXTRACTION_SYSTEM_PROMPT, PARSED_DOCUMENT_SCHEMA, PARSED_DOCUMENT_SCHEMA_NAME } from "./schema.ts";
import { verifyLlmDocument } from "./verify.ts";

type Params = Parameters<LlmClient["completeJson"]>[0];
const TIMEOUT_MS = 30_000;

export class DisabledLlmClient implements LlmClient {
  readonly enabled = false;
  async completeJson(): Promise<unknown> {
    throw new Error("LLM fallback disabled (LLM_PROVIDER=none)");
  }
}

/** Returns fixture JSON (tests, offline demos). */
export class MockLlmClient implements LlmClient {
  readonly enabled = true;
  readonly calls: Params[] = [];
  constructor(private readonly respond: unknown | ((p: Params) => unknown)) {}
  async completeJson(p: Params): Promise<unknown> {
    this.calls.push(p);
    return typeof this.respond === "function" ? (this.respond as (p: Params) => unknown)(p) : structuredClone(this.respond);
  }
}

function stripFences(text: string): string {
  const m = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  return (m ? m[1]! : text).trim();
}

async function postJson(fetchImpl: typeof fetch, url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** Anthropic Messages API; structured output via a forced tool call. */
export class AnthropicLlmClient implements LlmClient {
  readonly enabled = true;
  constructor(
    private readonly apiKey: string,
    private readonly model = "claude-sonnet-4-5",
    private readonly baseUrl = "https://api.anthropic.com",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async completeJson(p: Params): Promise<unknown> {
    const data = (await postJson(this.fetchImpl, `${this.baseUrl.replace(/\/$/, "")}/v1/messages`, { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" }, {
      model: this.model,
      max_tokens: 4096,
      system: p.system,
      messages: [{ role: "user", content: p.user }],
      tools: [{ name: p.schemaName, description: "Return the extracted data", input_schema: p.jsonSchema }],
      tool_choice: { type: "tool", name: p.schemaName },
    })) as { content?: { type: string; input?: unknown; text?: string }[] };
    const tool = data.content?.find((c) => c.type === "tool_use");
    if (tool?.input !== undefined) return tool.input;
    const text = data.content?.find((c) => c.type === "text")?.text;
    if (text) return JSON.parse(stripFences(text));
    throw new Error("LLM returned no JSON");
  }
}

/** OpenAI-compatible chat completions (Perplexity, OpenAI, vLLM, clinic-hosted models). */
export class OpenAiCompatibleLlmClient implements LlmClient {
  readonly enabled = true;
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async completeJson(p: Params): Promise<unknown> {
    const base = this.baseUrl.replace(/\/$/, "");
    const data = (await postJson(this.fetchImpl, `${base}/chat/completions`, this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}, {
      model: this.model,
      temperature: 0,
      messages: [
        { role: "system", content: p.system },
        { role: "user", content: p.user },
      ],
      response_format: { type: "json_schema", json_schema: { name: p.schemaName, schema: p.jsonSchema } },
    })) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM returned no content");
    return JSON.parse(stripFences(content));
  }
}

/** Fallback reading: ask the LLM, then verify against the source text. Never throws. */
export async function llmParse(llm: LlmClient, markdown: string): Promise<ParseResult> {
  let raw: unknown;
  try {
    raw = await llm.completeJson({
      system: EXTRACTION_SYSTEM_PROMPT,
      user: markdown,
      jsonSchema: PARSED_DOCUMENT_SCHEMA,
      schemaName: PARSED_DOCUMENT_SCHEMA_NAME,
    });
  } catch (err) {
    return { ok: false, method: "llm", problems: [`LLM failed: ${(err as Error).message}`] };
  }
  return verifyLlmDocument(markdown, raw);
}

export function createLlmClient(config: Config, fetchImpl: typeof fetch = fetch): LlmClient {
  switch (config.llmProvider) {
    case "none":
      return new DisabledLlmClient();
    case "anthropic":
      if (!config.llmApiKey) throw new Error("LLM_PROVIDER=anthropic needs LLM_API_KEY");
      return new AnthropicLlmClient(config.llmApiKey, config.llmModel || undefined, config.llmBaseUrl || undefined, fetchImpl);
    case "perplexity":
      if (!config.llmApiKey) throw new Error("LLM_PROVIDER=perplexity needs LLM_API_KEY");
      return new OpenAiCompatibleLlmClient(config.llmBaseUrl || "https://api.perplexity.ai", config.llmApiKey, config.llmModel || "sonar-pro", fetchImpl);
    case "openai-compatible":
      if (!config.llmBaseUrl || !config.llmModel) throw new Error("LLM_PROVIDER=openai-compatible needs LLM_BASE_URL and LLM_MODEL");
      return new OpenAiCompatibleLlmClient(config.llmBaseUrl, config.llmApiKey, config.llmModel, fetchImpl);
    case "mock": {
      const file = join(config.dataDir, "llm-mock.json");
      return new MockLlmClient(() => {
        if (!existsSync(file)) throw new Error(`LLM_PROVIDER=mock: fixture ${file} missing`);
        return JSON.parse(readFileSync(file, "utf8"));
      });
    }
    default:
      throw new Error(`Unknown LLM_PROVIDER ${String(config.llmProvider)}`);
  }
}

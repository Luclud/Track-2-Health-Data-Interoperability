// Account A, Dev Core — task CORE-1. Deterministic Markdown parser for the scenario format.
import type { ParseResult } from "@brieftaube/shared";
import type { DocumentParser } from "../ports.ts";

export class MarkdownDocumentParser implements DocumentParser {
  parse(_markdown: string): ParseResult {
    return { ok: false, method: "parser", problems: ["parser not implemented yet (CORE-1)"] };
  }
}

export function createDocumentParser(): DocumentParser {
  return new MarkdownDocumentParser();
}

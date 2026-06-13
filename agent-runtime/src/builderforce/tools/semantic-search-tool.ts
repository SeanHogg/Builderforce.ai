/**
 * Semantic codebase search — TF-IDF/BM25 ranking + symbol extraction over a local index.
 *
 * Legacy pi (`AgentTool`) wrapper — the implementation lives once in the pi-free
 * `shared-tools/node-code-tools.ts` (`runSemanticSearch`), shared with the native
 * `ToolDefinition` (DRY). Removed when the pi loop is retired.
 */

import type { AgentTool, AgentToolResult } from "../model/agent-types.js";
import { Type } from "@sinclair/typebox";
import { jsonResult } from "../../agents/tools/common.js";
import { runSemanticSearch } from "../shared-tools/node-code-tools.js";

const SemanticSearchSchema = Type.Object({
  projectRoot: Type.String({ description: "Root directory of the project to search" }),
  query: Type.String({
    description:
      "Natural language query or symbol name. Examples: 'user authentication flow', " +
      "'database connection pool', 'PaymentService class', 'handleCheckout'",
  }),
  topK: Type.Optional(Type.Number({ description: "Number of results to return (default 10, max 20)" })),
  language: Type.Optional(Type.String({ description: "Limit to files of this extension, e.g. 'ts', 'py'" })),
  rebuild: Type.Optional(
    Type.Boolean({
      description: "Force rebuild the search index. Use when files have changed significantly.",
    }),
  ),
});

type SemanticSearchParams = {
  projectRoot: string;
  query: string;
  topK?: number;
  language?: string;
  rebuild?: boolean;
};

export const semanticSearchTool: AgentTool<typeof SemanticSearchSchema, string> = {
  name: "codebase_semantic_search",
  label: "Semantic Codebase Search",
  description:
    "Semantically search the project source code using a TF-IDF ranked index of all exported " +
    "symbols (functions, classes, types, interfaces) plus file content. Returns ranked files " +
    "and representative snippets. Builds a local index on first use (.builderForceAgents/search-index.json). " +
    "Better than keyword search for natural language queries and symbol lookups.",
  parameters: SemanticSearchSchema,
  async execute(_toolCallId: string, params: SemanticSearchParams): Promise<AgentToolResult<string>> {
    return jsonResult(
      await runSemanticSearch(params.projectRoot, {
        query: params.query,
        topK: params.topK,
        language: params.language,
        rebuild: params.rebuild,
      }),
    ) as AgentToolResult<string>;
  },
};

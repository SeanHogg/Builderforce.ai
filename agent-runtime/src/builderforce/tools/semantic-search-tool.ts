/**
 * Legacy semantic-search tool backed by the shared Workspace index.
 */

import type { AgentTool, AgentToolResult } from "../model/agent-types.js";
import { Type } from "@sinclair/typebox";
import { jsonResult } from "../../agents/tools/common.js";
import { searchWorkspace } from "./workspace-search.js";

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
    "Search the Workspace code index for definitions and matching code. Returns ranked paths and " +
    "representative snippets, with semantic ranking when a local embedder is ready.",
  parameters: SemanticSearchSchema,
  async execute(_toolCallId: string, params: SemanticSearchParams): Promise<AgentToolResult<string>> {
    return jsonResult(await searchWorkspace(params, false)) as AgentToolResult<string>;
  },
};

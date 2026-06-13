/**
 * Codebase search tool — competes with Cursor @codebase and Continue.dev context.
 * Ripgrep/grep keyword ranking over the working tree.
 *
 * Legacy pi (`AgentTool`) wrapper — the implementation lives once in the pi-free
 * `shared-tools/node-code-tools.ts` (`runCodebaseSearch`), shared with the native
 * `ToolDefinition` (DRY). Removed when the pi loop is retired.
 */

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { jsonResult } from "../../agents/tools/common.js";
import { runCodebaseSearch } from "../shared-tools/node-code-tools.js";

const CodebaseSearchSchema = Type.Object({
  projectRoot: Type.String({ description: "Root directory of the project to search" }),
  query: Type.String({
    description:
      "Natural language or keyword query describing what you are looking for. " +
      "Examples: 'user authentication', 'database connection pool', 'rate limiting middleware'",
  }),
  topK: Type.Optional(Type.Number({ description: "Maximum number of results to return. Defaults to 10." })),
  language: Type.Optional(
    Type.String({
      description:
        "Limit search to files of this language/extension (e.g. 'ts', 'py', 'go'). " +
        "If omitted, all source files are searched.",
    }),
  ),
});

type CodebaseSearchParams = { projectRoot: string; query: string; topK?: number; language?: string };

export const codebaseSearchTool: AgentTool<typeof CodebaseSearchSchema, string> = {
  name: "codebase_search",
  label: "Codebase Search",
  description:
    "Semantically search the project source code using natural language or keywords. " +
    "Finds files and code snippets most relevant to your query — like Cursor @codebase or " +
    "Continue.dev @codebase. Returns ranked results with file paths and representative snippets.",
  parameters: CodebaseSearchSchema,
  async execute(_toolCallId: string, params: CodebaseSearchParams): Promise<AgentToolResult<string>> {
    return jsonResult(
      await runCodebaseSearch(params.projectRoot, {
        query: params.query,
        topK: params.topK,
        language: params.language,
      }),
    ) as AgentToolResult<string>;
  },
};

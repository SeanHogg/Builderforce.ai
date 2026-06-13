/**
 * Tool for analyzing git history and changes.
 *
 * Legacy pi (`AgentTool`) wrapper — the implementation lives once in the pi-free
 * `shared-tools/node-code-tools.ts` (`runGitHistory`), which the native shared
 * `ToolDefinition` also uses, so cloud/local engines and the legacy on-prem loop
 * share one code path (DRY). Removed when the pi loop is retired.
 */

import type { AgentTool, AgentToolResult } from "../model/agent-types.js";
import { Type } from "@sinclair/typebox";
import { jsonResult } from "../../agents/tools/common.js";
import { runGitHistory } from "../shared-tools/node-code-tools.js";

const GitHistorySchema = Type.Object({
  projectRoot: Type.String({ description: "Root directory of the git repository" }),
  path: Type.Optional(
    Type.String({ description: "Specific file or directory to analyze. If omitted, analyzes entire repo." }),
  ),
  limit: Type.Optional(Type.Number({ description: "Maximum number of commits to return. Defaults to 50." })),
  author: Type.Optional(Type.String({ description: "Filter commits by author email or name" })),
});

type GitHistoryParams = { projectRoot: string; path?: string; limit?: number; author?: string };

export const gitHistoryTool: AgentTool<typeof GitHistorySchema, string> = {
  name: "git_history",
  label: "Git History",
  description: "Analyze git history for a file or directory. Shows commits, authors, and change patterns.",
  parameters: GitHistorySchema,
  async execute(_toolCallId: string, params: GitHistoryParams) {
    return jsonResult(
      runGitHistory(params.projectRoot, { path: params.path, limit: params.limit, author: params.author }),
    ) as AgentToolResult<string>;
  },
};

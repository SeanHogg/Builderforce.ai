/**
 * Tool for analyzing code structure and semantics.
 *
 * Legacy pi (`AgentTool`) wrapper — the implementation lives once in the pi-free
 * `shared-tools/node-code-tools.ts` (`runCodeAnalysis`), shared with the native
 * `ToolDefinition` (DRY). Removed when the pi loop is retired.
 */

import type { AgentTool, AgentToolResult } from "../model/agent-types.js";
import { Type } from "@sinclair/typebox";
import { jsonResult } from "../../agents/tools/common.js";
import { runCodeAnalysis } from "../shared-tools/node-code-tools.js";

const CodeAnalysisSchema = Type.Object({
  projectRoot: Type.String({ description: "Root directory of the project to analyze" }),
  filePatterns: Type.Optional(
    Type.Array(Type.String(), {
      description: "File patterns to analyze (e.g., ['**/*.ts', '**/*.js']). Defaults to common patterns.",
    }),
  ),
  includeTests: Type.Optional(
    Type.Boolean({ description: "Whether to include test files in the analysis. Defaults to false." }),
  ),
});

type CodeAnalysisParams = { projectRoot: string; filePatterns?: string[]; includeTests?: boolean };

export const codeAnalysisTool: AgentTool<typeof CodeAnalysisSchema, string> = {
  name: "code_analysis",
  label: "Code Analysis",
  description:
    "Analyze code structure, dependencies, and semantic relationships in a project. Returns AST information, dependency graphs, and code maps.",
  parameters: CodeAnalysisSchema,
  async execute(_toolCallId: string, params: CodeAnalysisParams) {
    return jsonResult(
      await runCodeAnalysis(params.projectRoot, {
        filePatterns: params.filePatterns,
        includeTests: params.includeTests,
      }),
    ) as AgentToolResult<string>;
  },
};

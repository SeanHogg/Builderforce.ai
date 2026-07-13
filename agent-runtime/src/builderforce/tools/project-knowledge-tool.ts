/**
 * Tool for querying project knowledge and context.
 *
 * Legacy pi (`AgentTool`) wrapper — the implementation lives once in the pi-free
 * `shared-tools/node-code-tools.ts` (`runProjectKnowledge`), shared with the native
 * `ToolDefinition` (DRY). Removed when the pi loop is retired.
 */

import type { AgentTool, AgentToolResult } from "../model/agent-types.js";
import { Type } from "@sinclair/typebox";
import { jsonResult } from "../../agents/tools/common.js";
import { runProjectKnowledge } from "../shared-tools/node-code-tools.js";

const ProjectKnowledgeSchema = Type.Object({
  projectRoot: Type.String({ description: "Root directory of the project" }),
  query: Type.String({
    description:
      "What to query: 'context', 'rules', 'governance', 'architecture', 'agents', 'memory', or 'all'",
  }),
});

type ProjectKnowledgeParams = { projectRoot: string; query: string };

export const projectKnowledgeTool: AgentTool<typeof ProjectKnowledgeSchema, string> = {
  name: "project_knowledge",
  label: "Project Knowledge",
  description:
    "Query project-specific knowledge including context, rules, architecture, custom agent roles, and recent agent activity memory from the .builderForceAgents directory.",
  parameters: ProjectKnowledgeSchema,
  async execute(_toolCallId: string, params: ProjectKnowledgeParams) {
    return jsonResult(await runProjectKnowledge(params.projectRoot, params.query)) as AgentToolResult<string>;
  },
};

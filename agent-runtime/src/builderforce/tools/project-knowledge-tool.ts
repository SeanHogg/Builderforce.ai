/**
 * Tool for querying project knowledge and context
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { jsonResult } from "../../agents/tools/common.js";
import {
  loadProjectContext,
  loadProjectRules,
  loadProjectGovernance,
  loadProjectArchitecture,
  loadCustomAgentRoles,
  resolveBuilderForceAgentsDir,
} from "../project-context.js";

const ProjectKnowledgeSchema = Type.Object({
  projectRoot: Type.String({
    description: "Root directory of the project",
  }),
  query: Type.String({
    description:
      "What to query: 'context', 'rules', 'governance', 'architecture', 'agents', 'memory', or 'all'",
  }),
});

type ProjectKnowledgeParams = {
  projectRoot: string;
  query: string;
};

export const projectKnowledgeTool: AgentTool<typeof ProjectKnowledgeSchema, string> = {
  name: "project_knowledge",
  label: "Project Knowledge",
  description:
    "Query project-specific knowledge including context, rules, architecture, custom agent roles, and recent agent activity memory from the .builderForceAgents directory.",
  parameters: ProjectKnowledgeSchema,
  async execute(_toolCallId: string, params: ProjectKnowledgeParams) {
    const { projectRoot, query } = params;

    try {
      const result: Record<string, unknown> = {};

      if (query === "context" || query === "all") {
        const context = await loadProjectContext(projectRoot);
        if (context) {
          result.context = context;
        }
      }

      if (query === "rules" || query === "all") {
        const rules = await loadProjectRules(projectRoot);
        if (rules) {
          result.rules = rules;
        }
      }

      if (query === "governance" || query === "all") {
        const gov = await loadProjectGovernance(projectRoot);
        if (gov) {
          result.governance = gov;
        }
      }

      if (query === "architecture" || query === "all") {
        const architecture = await loadProjectArchitecture(projectRoot);
        if (architecture) {
          result.architecture = architecture;
        }
      }

      if (query === "agents" || query === "all") {
        const agents = await loadCustomAgentRoles(projectRoot);
        if (agents.length > 0) {
          result.agents = agents;
        }
      }

      if (query === "memory" || query === "all") {
        const dir = resolveBuilderForceAgentsDir(projectRoot);
        try {
          const files = (await fs.readdir(dir.memoryDir))
            .filter((f) => f.endsWith(".md"))
            .toSorted()
            .slice(-7); // last 7 days
          if (files.length > 0) {
            const contents = await Promise.all(
              files.map((f) => fs.readFile(path.join(dir.memoryDir, f), "utf-8")),
            );
            result.memory = contents.join("\n\n---\n\n");
          }
        } catch {
          // Directory missing or empty — silent
        }
      }

      if (Object.keys(result).length === 0) {
        return jsonResult({
          error: "No project knowledge found. Initialize with 'builderforce init' first.",
        }) as AgentToolResult<string>;
      }

      return jsonResult(result) as AgentToolResult<string>;
    } catch (error) {
      return jsonResult({
        error: `Failed to load project knowledge: ${error instanceof Error ? error.message : String(error)}`,
      }) as AgentToolResult<string>;
    }
  },
};

/**
 * Tool for orchestrating multi-agent workflows.
 *
 * Legacy pi (`AgentTool`) wrapper — the implementation lives once in the pi-free
 * `shared-tools/node-orchestration-tools.ts` (`runOrchestrate`), shared with the
 * native `ToolDefinition` (DRY). Removed when the pi loop is retired.
 */

import type { AgentTool, AgentToolResult } from "../model/agent-types.js";
import { Type } from "@sinclair/typebox";
import { jsonResult } from "../../agents/tools/common.js";
import { runOrchestrate, type OrchestrationContext } from "../shared-tools/node-orchestration-tools.js";

const OrchestrateSchema = Type.Object({
  workflow: Type.String({
    description:
      "Type of workflow: 'feature', 'bugfix', 'refactor', 'security_audit', 'planning', 'adversarial', or 'custom'. Use 'custom' to define your own steps.",
  }),
  description: Type.String({
    description:
      "Description of the task (e.g., 'Add user authentication', 'Fix memory leak in parser', 'Refactor API module')",
  }),
  customSteps: Type.Optional(
    Type.Array(
      Type.Object({
        role: Type.String({
          description:
            "Agent role key. Any registered role: a built-in ('code-creator', 'code-reviewer', " +
            "'test-generator', 'bug-analyzer', 'refactor-agent', 'documentation-agent', " +
            "'architecture-advisor', 'validator-agent') OR a hired-agent roleKey/id. Validated at runtime; an " +
            "unknown role returns a clear error. 'remote:<id>' / 'node:<kind>' dispatch directives also pass through.",
        }),
        task: Type.String({ description: "Task description for this step" }),
        dependsOn: Type.Optional(
          Type.Array(Type.String(), { description: "Task descriptions this step depends on" }),
        ),
      }),
      { description: "Custom workflow steps (required if workflow='custom')" },
    ),
  ),
});

type OrchestrateParams = {
  workflow: string;
  description: string;
  customSteps?: Array<{ role: string; task: string; dependsOn?: string[] }>;
};

export function createOrchestrateTool(options?: {
  agentSessionKey?: string;
  agentChannel?: string;
  agentAccountId?: string;
  agentTo?: string;
  agentThreadId?: string | number;
  agentGroupId?: string | null;
  agentGroupChannel?: string | null;
  agentGroupSpace?: string | null;
  requesterAgentIdOverride?: string;
  /** When this orchestration runs for a specific ticket, its task id — so a
   *  planning workflow's PRD is linked to the task as its primary, not left as a
   *  loose project-level spec [1277]. */
  taskId?: number;
}): AgentTool<typeof OrchestrateSchema, string> {
  const context: OrchestrationContext = {
    agentSessionKey: options?.agentSessionKey,
    agentChannel: options?.agentChannel,
    agentAccountId: options?.agentAccountId,
    agentTo: options?.agentTo,
    agentThreadId: options?.agentThreadId,
    agentGroupId: options?.agentGroupId,
    agentGroupChannel: options?.agentGroupChannel,
    agentGroupSpace: options?.agentGroupSpace,
    requesterAgentIdOverride: options?.requesterAgentIdOverride,
    taskId: options?.taskId,
  };

  return {
    name: "orchestrate",
    label: "Orchestrate Workflow",
    description:
      "Create and execute multi-agent workflows for complex development tasks. Coordinates multiple specialized agents (code-creator, code-reviewer, test-generator, etc.) to work together.",
    parameters: OrchestrateSchema,
    async execute(_toolCallId: string, params: OrchestrateParams) {
      return jsonResult(await runOrchestrate(params, context)) as AgentToolResult<string>;
    },
  };
}

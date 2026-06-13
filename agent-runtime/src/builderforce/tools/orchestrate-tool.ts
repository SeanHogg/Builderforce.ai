/**
 * Tool for orchestrating multi-agent workflows
 */

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { jsonResult } from "../../agents/tools/common.js";
import { readSharedEnvVar } from "../../infra/env-file.js";
import { pushSpec } from "../../infra/spec-sync.js";
import {
  globalOrchestrator,
  createFeatureWorkflow,
  createBugFixWorkflow,
  createRefactorWorkflow,
  createSecurityAuditWorkflow,
  createPlanningWorkflow,
  createAdversarialReviewWorkflow,
  type WorkflowStep,
  type SpawnSubagentContext,
} from "../orchestrator.js";

/**
 * Registry of named workflow factory functions.
 * To add a new workflow type: register it here — orchestrate-tool.ts needs no further changes.
 */
const WORKFLOW_REGISTRY: Record<string, (description: string) => WorkflowStep[]> = {
  feature: createFeatureWorkflow,
  bugfix: createBugFixWorkflow,
  refactor: createRefactorWorkflow,
  security_audit: createSecurityAuditWorkflow,
  planning: createPlanningWorkflow,
  adversarial: createAdversarialReviewWorkflow,
};

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
            "Agent role: 'code-creator', 'code-reviewer', 'test-generator', 'bug-analyzer', 'refactor-agent', 'documentation-agent', or 'architecture-advisor'",
        }),
        task: Type.String({
          description: "Task description for this step",
        }),
        dependsOn: Type.Optional(
          Type.Array(Type.String(), {
            description: "Task descriptions this step depends on",
          }),
        ),
      }),
      {
        description: "Custom workflow steps (required if workflow='custom')",
      },
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
  /** Task this orchestration runs for — links a planning workflow's PRD to the
   *  task as its primary spec (parity with the cloud ensureTaskPrd / specRoutes path). */
  taskId?: number;
}): AgentTool<typeof OrchestrateSchema, string> {
  const context: SpawnSubagentContext = {
    agentSessionKey: options?.agentSessionKey,
    agentChannel: options?.agentChannel,
    agentAccountId: options?.agentAccountId,
    agentTo: options?.agentTo,
    agentThreadId: options?.agentThreadId,
    agentGroupId: options?.agentGroupId,
    agentGroupChannel: options?.agentGroupChannel,
    agentGroupSpace: options?.agentGroupSpace,
    requesterAgentIdOverride: options?.requesterAgentIdOverride,
  };

  return {
    name: "orchestrate",
    label: "Orchestrate Workflow",
    description:
      "Create and execute multi-agent workflows for complex development tasks. Coordinates multiple specialized agents (code-creator, code-reviewer, test-generator, etc.) to work together.",
    parameters: OrchestrateSchema,
    async execute(_toolCallId: string, params: OrchestrateParams) {
      const { workflow, description, customSteps } = params;

      try {
        let steps: WorkflowStep[];

        if (workflow === "custom") {
          if (!customSteps || customSteps.length === 0) {
            return jsonResult({
              error: "Custom workflow requires customSteps to be provided",
            }) as AgentToolResult<string>;
          }
          steps = customSteps;
        } else {
          const factory = WORKFLOW_REGISTRY[workflow];
          if (!factory) {
            const known = [...Object.keys(WORKFLOW_REGISTRY), "custom"].join("', '");
            return jsonResult({
              error: `Unknown workflow type: ${workflow}. Use '${known}'.`,
            }) as AgentToolResult<string>;
          }
          steps = factory(description);
        }

        // Create workflow
        const wf = globalOrchestrator.createWorkflow(steps);

        // Execute workflow and await completion so we can return proper status
        try {
          const results = await globalOrchestrator.executeWorkflow(wf.id, context);

          // Push planning workflow outputs to Builderforce spec storage (P1-1).
          // Fire-and-forget: push failures don't affect the workflow result.
          if (workflow === "planning") {
            const resultValues = Array.from(results.values());
            const apiKey = readSharedEnvVar("BUILDERFORCE_API_KEY");
            const agentNodeId = readSharedEnvVar("BUILDERFORCE_AGENT_NODE_ID");
            const baseUrl = readSharedEnvVar("BUILDERFORCE_URL") ?? "https://api.builderforce.ai";
            if (apiKey && agentNodeId) {
              void pushSpec(
                { baseUrl, agentNodeId, apiKey },
                {
                  goal: description,
                  status: "draft",
                  prd: resultValues[0] ?? undefined,
                  archSpec: resultValues[1] ?? undefined,
                  taskList: resultValues[2] ?? undefined,
                  // Link the PRD to the task as its primary spec when the orchestration
                  // runs in a task context (else it lands as a loose project PRD).
                  taskId: options?.taskId,
                },
              );
            }
          }

          return jsonResult({
            workflowId: wf.id,
            status: "completed",
            taskCount: wf.tasks.size,
            results: Array.from(results.entries()).map(([taskId, result]) => ({
              taskId,
              result,
            })),
            note: "Workflow completed successfully.",
          }) as AgentToolResult<string>;
        } catch (executionError) {
          return jsonResult({
            error: `Workflow execution failed: ${executionError instanceof Error ? executionError.message : String(executionError)}`,
          }) as AgentToolResult<string>;
        }
      } catch (error) {
        return jsonResult({
          error: `Failed to create workflow: ${error instanceof Error ? error.message : String(error)}`,
        }) as AgentToolResult<string>;
      }
    },
  };
}

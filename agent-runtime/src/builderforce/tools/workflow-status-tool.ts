/**
 * Tool for checking workflow status
 */

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { jsonResult } from "../../agents/tools/common.js";
import { globalOrchestrator } from "../orchestrator.js";

const WorkflowStatusSchema = Type.Object({
  workflowId: Type.Optional(
    Type.String({
      description:
        "ID of the workflow to check. Optional: when omitted, uses the latest active workflow (or latest workflow if none active).",
    }),
  ),
});

type WorkflowStatusParams = {
  workflowId?: string;
};

export const workflowStatusTool: AgentTool<typeof WorkflowStatusSchema, string> = {
  name: "workflow_status",
  label: "Workflow Status",
  description: "Check the status of a multi-agent workflow and its tasks.",
  parameters: WorkflowStatusSchema,
  async execute(_toolCallId: string, params: WorkflowStatusParams) {
    const requestedWorkflowId =
      typeof params.workflowId === "string" && params.workflowId.trim().length > 0
        ? params.workflowId.trim()
        : undefined;

    try {
      const workflow = requestedWorkflowId
        ? globalOrchestrator.getWorkflowStatus(requestedWorkflowId)
        : (globalOrchestrator.getLatestWorkflow({ activeOnly: true }) ??
          globalOrchestrator.getLatestWorkflow());

      if (!workflow) {
        if (requestedWorkflowId) {
          return jsonResult({
            error: `Workflow ${requestedWorkflowId} not found`,
          }) as AgentToolResult<string>;
        }
        return jsonResult({
          error: "No workflows found",
        }) as AgentToolResult<string>;
      }

      const runnableTasks = globalOrchestrator.getRunnableTasks(workflow.id);

      return jsonResult({
        workflowId: workflow.id,
        status: workflow.status,
        totalTasks: workflow.tasks.size,
        requestedWorkflowId,
        source: requestedWorkflowId ? "explicit" : "latest",
        taskStatus: {
          pending: Array.from(workflow.tasks.values()).filter((t) => t.status === "pending").length,
          running: Array.from(workflow.tasks.values()).filter((t) => t.status === "running").length,
          completed: Array.from(workflow.tasks.values()).filter((t) => t.status === "completed")
            .length,
          failed: Array.from(workflow.tasks.values()).filter((t) => t.status === "failed").length,
        },
        nextTasks: runnableTasks.map((task) => ({
          id: task.id,
          role: task.agentRole,
          description: task.description,
        })),
        tasks: Array.from(workflow.tasks.values()).map((task) => ({
          id: task.id,
          role: task.agentRole,
          description: task.description,
          status: task.status,
          error: task.error,
          createdAt: task.createdAt.toISOString(),
          startedAt: task.startedAt?.toISOString(),
          completedAt: task.completedAt?.toISOString(),
        })),
      }) as AgentToolResult<string>;
    } catch (error) {
      return jsonResult({
        error: `Failed to check workflow status: ${error instanceof Error ? error.message : String(error)}`,
      }) as AgentToolResult<string>;
    }
  },
};

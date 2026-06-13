/**
 * Tool for checking workflow status.
 *
 * Legacy pi (`AgentTool`) wrapper — the implementation lives once in the pi-free
 * `shared-tools/node-orchestration-tools.ts` (`runWorkflowStatus`), shared with the
 * native `ToolDefinition` (DRY). Removed when the pi loop is retired.
 */

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { jsonResult } from "../../agents/tools/common.js";
import { runWorkflowStatus } from "../shared-tools/node-orchestration-tools.js";

const WorkflowStatusSchema = Type.Object({
  workflowId: Type.Optional(
    Type.String({
      description:
        "ID of the workflow to check. Optional: when omitted, uses the latest active workflow (or latest workflow if none active).",
    }),
  ),
});

type WorkflowStatusParams = { workflowId?: string };

export const workflowStatusTool: AgentTool<typeof WorkflowStatusSchema, string> = {
  name: "workflow_status",
  label: "Workflow Status",
  description: "Check the status of a multi-agent workflow and its tasks.",
  parameters: WorkflowStatusSchema,
  async execute(_toolCallId: string, params: WorkflowStatusParams) {
    return jsonResult(runWorkflowStatus(params.workflowId)) as AgentToolResult<string>;
  },
};

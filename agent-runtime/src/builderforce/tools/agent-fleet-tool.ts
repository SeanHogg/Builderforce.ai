/**
 * agent_fleet tool — discover peer BuilderForceAgents instances in the same tenant.
 *
 * Legacy pi (`AgentTool`) wrapper — the implementation lives once in the pi-free
 * `shared-tools/node-orchestration-tools.ts` (`runAgentFleet`), shared with the
 * native `ToolDefinition` (DRY). Removed when the pi loop is retired.
 */

import type { AgentTool, AgentToolResult } from "../model/agent-types.js";
import { Type } from "@sinclair/typebox";
import { jsonResult } from "../../agents/tools/common.js";
import { runAgentFleet } from "../shared-tools/node-orchestration-tools.js";

const AgentFleetSchema = Type.Object({
  projectRoot: Type.String({ description: "Absolute path to the workspace root" }),
  onlineOnly: Type.Optional(
    Type.Boolean({ description: "If true, return only currently connected (online) agentNodes. Default: false." }),
  ),
  requireCapabilities: Type.Optional(
    Type.Array(Type.String(), {
      description: "Filter to agentNodes that have all listed capabilities. Example: ['gpu', 'high-memory'].",
    }),
  ),
});

type AgentFleetParams = { projectRoot: string; onlineOnly?: boolean; requireCapabilities?: string[] };

export const agentFleetTool: AgentTool<typeof AgentFleetSchema, string> = {
  name: "agent_fleet",
  label: "AgentNode Fleet",
  description:
    "List peer BuilderForceAgents instances in the same tenant. Returns each agentNode's ID, name, connection status, and capabilities. Use the agentNode ID with 'remote:<agentNodeId>' to delegate tasks, 'remote:auto' to auto-select the best online agentNode, or 'remote:auto[cap1,cap2]' to require specific capabilities. Requires BUILDERFORCE_API_KEY and builderforce.instanceId to be configured.",
  parameters: AgentFleetSchema,
  async execute(_toolCallId: string, params: AgentFleetParams) {
    return jsonResult(
      await runAgentFleet(params.projectRoot, {
        onlineOnly: params.onlineOnly,
        requireCapabilities: params.requireCapabilities,
      }),
    ) as AgentToolResult<string>;
  },
};

/**
 * agent_fleet tool — discover peer BuilderForceAgents instances in the same tenant.
 *
 * Uses the agentNode-authenticated GET /api/agent-hosts/fleet endpoint so no user JWT is
 * needed. Returns each agentNode's ID, name, online status, and capabilities.
 *
 * Use the returned agentNode IDs with the "remote:<agentNodeId>" workflow step role to
 * delegate tasks to specific peer agentNodes. Use "remote:auto" to let the
 * orchestrator automatically select the best available online agentNode, or
 * "remote:auto[cap1,cap2]" to require specific capabilities.
 */

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { jsonResult } from "../../agents/tools/common.js";
import { readSharedEnvVar } from "../../infra/env-file.js";
import { fetchFleetEntries } from "../../infra/remote-subagent.js";
import { loadProjectContext } from "../project-context.js";

const AgentFleetSchema = Type.Object({
  projectRoot: Type.String({
    description: "Absolute path to the workspace root",
  }),
  onlineOnly: Type.Optional(
    Type.Boolean({
      description: "If true, return only currently connected (online) agentNodes. Default: false.",
    }),
  ),
  requireCapabilities: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Filter to agentNodes that have all listed capabilities. Example: ['gpu', 'high-memory'].",
    }),
  ),
});

type AgentFleetParams = {
  projectRoot: string;
  onlineOnly?: boolean;
  requireCapabilities?: string[];
};

export const agentFleetTool: AgentTool<typeof AgentFleetSchema, string> = {
  name: "agent_fleet",
  label: "AgentNode Fleet",
  description:
    "List peer BuilderForceAgents instances in the same tenant. Returns each agentNode's ID, name, connection status, and capabilities. Use the agentNode ID with 'remote:<agentNodeId>' to delegate tasks, 'remote:auto' to auto-select the best online agentNode, or 'remote:auto[cap1,cap2]' to require specific capabilities. Requires BUILDERFORCE_API_KEY and builderforce.instanceId to be configured.",
  parameters: AgentFleetSchema,
  async execute(_toolCallId: string, params: AgentFleetParams) {
    const { projectRoot, onlineOnly = false, requireCapabilities } = params;

    try {
      const apiKey = readSharedEnvVar("BUILDERFORCE_API_KEY");
      const baseUrl = readSharedEnvVar("BUILDERFORCE_URL") ?? "https://api.builderforce.ai";

      if (!apiKey) {
        return jsonResult({
          ok: false,
          error:
            "BUILDERFORCE_API_KEY not configured. Set it in ~/.builderforce/.env to enable fleet discovery.",
        }) as AgentToolResult<string>;
      }

      const ctx = await loadProjectContext(projectRoot);
      const agentNodeId = ctx?.builderforce?.instanceId;

      if (!agentNodeId) {
        return jsonResult({
          ok: false,
          error:
            "builderforce.instanceId not found in .builderforce/context.yaml. Run 'builderforce init' and register this agentNode first.",
        }) as AgentToolResult<string>;
      }

      // Diagnostic listing — query the raw fleet (with self) so total/online
      // counts reflect the full tenant view. Apply onlineOnly + capability
      // filters locally to derive the `filtered` view.
      const allEntries = await fetchFleetEntries({
        baseUrl,
        myAgentNodeId: String(agentNodeId),
        apiKey,
      });
      let filtered = onlineOnly ? allEntries.filter((c) => c.online) : allEntries;
      if (requireCapabilities && requireCapabilities.length > 0) {
        filtered = filtered.filter((c) =>
          requireCapabilities.every((cap) => c.capabilities.includes(cap)),
        );
      }

      const autoTip =
        requireCapabilities && requireCapabilities.length > 0
          ? `Use 'remote:auto[${requireCapabilities.join(",")}]' to auto-select a agentNode with these capabilities.`
          : "Use 'remote:<id>' or 'remote:auto' as the agentRole in an orchestrate workflow step.";

      return jsonResult({
        ok: true,
        fleet: filtered,
        total: allEntries.length,
        online: allEntries.filter((c) => c.online).length,
        filtered: filtered.length,
        tip: autoTip,
      }) as AgentToolResult<string>;
    } catch (error) {
      return jsonResult({
        error: `Failed to query fleet: ${error instanceof Error ? error.message : String(error)}`,
      }) as AgentToolResult<string>;
    }
  },
};

/**
 * agents_list tool — legacy pi (`AnyAgentTool`) wrapper.
 * The implementation lives once in the pi-free
 * `builderforce/shared-tools/node-service-tools.ts` (`runAgentsList`), shared with
 * the native `ToolDefinition` (DRY). Removed when the pi loop is retired.
 */

import { Type } from "@sinclair/typebox";
import { runAgentsList } from "../../builderforce/shared-tools/node-service-tools.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult } from "./common.js";

const AgentsListToolSchema = Type.Object({});

export function createAgentsListTool(opts?: {
  agentSessionKey?: string;
  /** Explicit agent ID override for cron/hook sessions. */
  requesterAgentIdOverride?: string;
}): AnyAgentTool {
  return {
    label: "Agents",
    name: "agents_list",
    description: "List agent ids you can target with sessions_spawn (based on allowlists).",
    parameters: AgentsListToolSchema,
    execute: async () =>
      jsonResult(
        runAgentsList({
          agentSessionKey: opts?.agentSessionKey,
          requesterAgentIdOverride: opts?.requesterAgentIdOverride,
        }),
      ),
  };
}

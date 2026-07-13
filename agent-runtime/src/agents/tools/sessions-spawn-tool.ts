import { Type } from "@sinclair/typebox";
import type { GatewayMessageChannel } from "../../utils/message-channel.js";
import { optionalStringEnum } from "../schema/typebox.js";
import { spawnSubagentDirect } from "../subagent-spawn.js";
import type { AgentToolResult, AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

const SessionsSpawnToolSchema = Type.Object({
  task: Type.String(),
  label: Type.Optional(Type.String()),
  agentId: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  thinking: Type.Optional(Type.String()),
  runTimeoutSeconds: Type.Optional(Type.Number({ minimum: 0 })),
  // Back-compat: older callers used timeoutSeconds for this tool.
  timeoutSeconds: Type.Optional(Type.Number({ minimum: 0 })),
  cleanup: optionalStringEnum(["delete", "keep"] as const),
});

export interface SessionsSpawnDeps {
  agentSessionKey?: string;
  agentChannel?: GatewayMessageChannel;
  agentAccountId?: string;
  agentTo?: string;
  agentThreadId?: string | number;
  agentGroupId?: string | null;
  agentGroupChannel?: string | null;
  agentGroupSpace?: string | null;
  sandboxed?: boolean;
  /** Explicit agent ID override for cron/hook sessions where session key parsing may not work. */
  requesterAgentIdOverride?: string;
}

/** Shared implementation — pi wrapper + native ToolDefinition both delegate here (DRY). */
export async function runSessionsSpawn(
  opts: SessionsSpawnDeps | undefined,
  params: Record<string, unknown>,
): Promise<AgentToolResult<unknown>> {
  const task = readStringParam(params, "task", { required: true });
  const label = typeof params.label === "string" ? params.label.trim() : "";
  const requestedAgentId = readStringParam(params, "agentId");
  const modelOverride = readStringParam(params, "model");
  const thinkingOverrideRaw = readStringParam(params, "thinking");
  const cleanup = params.cleanup === "keep" || params.cleanup === "delete" ? params.cleanup : "keep";
  // Back-compat: older callers used timeoutSeconds for this tool.
  const runTimeoutSeconds =
    typeof params.runTimeoutSeconds === "number"
      ? params.runTimeoutSeconds
      : typeof params.timeoutSeconds === "number"
        ? params.timeoutSeconds
        : undefined;

  const result = await spawnSubagentDirect(
    {
      task,
      label: label || undefined,
      agentId: requestedAgentId,
      model: modelOverride,
      thinking: thinkingOverrideRaw,
      runTimeoutSeconds,
      cleanup,
      expectsCompletionMessage: true,
    },
    {
      agentSessionKey: opts?.agentSessionKey,
      agentChannel: opts?.agentChannel,
      agentAccountId: opts?.agentAccountId,
      agentTo: opts?.agentTo,
      agentThreadId: opts?.agentThreadId,
      agentGroupId: opts?.agentGroupId,
      agentGroupChannel: opts?.agentGroupChannel,
      agentGroupSpace: opts?.agentGroupSpace,
      requesterAgentIdOverride: opts?.requesterAgentIdOverride,
    },
  );
  return jsonResult(result);
}

export function createSessionsSpawnTool(opts?: SessionsSpawnDeps): AnyAgentTool {
  return {
    label: "Sessions",
    name: "sessions_spawn",
    description:
      "Spawn a background sub-agent run in an isolated session and announce the result back to the requester chat.",
    parameters: SessionsSpawnToolSchema,
    execute: async (_toolCallId, args) => runSessionsSpawn(opts, args as Record<string, unknown>),
  };
}

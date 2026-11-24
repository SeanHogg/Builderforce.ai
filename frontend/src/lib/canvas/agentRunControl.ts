import type { RuntimeToolId } from '@builderforce/creation-canvas-contract';

/**
 * STEER AND CANCEL an agent's run from the room — through the canvas's existing MCP
 * tool-call client (`callServerRuntimeTool`: the gateway relay `/llm/v1/mcp/call` the
 * Brain's built-in tools already go through). No second HTTP client.
 *
 * The tools are the API's `runtime.agents.steer` / `runtime.agents.cancel` (W12 phase 5,
 * the built-in catalog). They are named here as data, one entry per control, so the
 * panel renders one button per entry and branches on none.
 *
 * The router module is loaded on call, as `runtimeToolRoute` does, so a station on the
 * room's first paint does not pull the browser runtime in behind it.
 */
export const AGENT_RUN_CONTROL_TOOLS = {
  steer: 'runtime.agents.steer',
  cancel: 'runtime.agents.cancel',
} as const;

export type AgentRunControl = keyof typeof AGENT_RUN_CONTROL_TOOLS;

export interface AgentRunControlArgs {
  agentId: string;
  /** The run being steered or cancelled, when the run store has correlated one. */
  runId?: string | null;
  /** The direction (steer only). */
  message?: string;
}

export type AgentToolCall = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

/** The default caller: the server's built-in tool relay. */
const callBuiltinTool: AgentToolCall = async (tool, args) => {
  const { callServerRuntimeTool } = await import('@/lib/runTarget/runtimeTools/runtimeToolRouter');
  // The catalog ids are the API's (WS-B registers them); the relay forwards any id.
  return callServerRuntimeTool(tool as RuntimeToolId, args);
};

/** The tool arguments for one control — the absent fields omitted, never sent empty. */
export function agentRunControlArgs(control: AgentRunControl, args: AgentRunControlArgs): Record<string, unknown> {
  return {
    agentId: args.agentId,
    ...(args.runId ? { runId: args.runId } : {}),
    ...(control === 'steer' && args.message?.trim() ? { message: args.message.trim() } : {}),
  };
}

/** Run one control. Rejects when the relay does. */
export function runAgentControl(control: AgentRunControl, args: AgentRunControlArgs, call: AgentToolCall = callBuiltinTool): Promise<unknown> {
  return call(AGENT_RUN_CONTROL_TOOLS[control], agentRunControlArgs(control, args));
}

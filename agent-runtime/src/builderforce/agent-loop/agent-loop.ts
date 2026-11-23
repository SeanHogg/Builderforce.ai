/**
 * Native agent loop entry — the pi-free replacement for `@mariozechner/pi-agent-core`'s `agentLoop`.
 *
 * There is NO loop here. The embedded runner's `Agent` (`agent.ts`) calls this to run one prompt, and gets back the
 * `AgentEvent` stream its subscribers and the session already speak; the run itself is THE one agent
 * (`@builderforce/agent-run` `runAgent`), driven through ports built by `run/channelRunPorts.ts`: the model (the runner's
 * {@link StreamFn}), the tools (the runner's `AgentTool`s), the steering and follow-up queues, the PreFetch gate and the
 * run's ledger. Stall recovery, the governance gates, steering, compaction and the model hand-off are the agent's policy.
 */

import type { AgentContext, AgentEvent, AgentMessage } from "../model/agent-types.js";
import { bindChannelRun } from "../../run/channelRunPorts.js";
import { runOnPremSession } from "../../run/onPremRunPorts.js";
import type { AgentLoopConfig } from "./agent-loop-config.js";
import type { EventStream } from "./event-stream.js";
import type { StreamFn } from "./stream.js";

/** Start an agent run with new prompt message(s). */
export function agentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  streamFn: StreamFn,
): EventStream<AgentEvent, AgentMessage[]> {
  return runOnPremSession(bindChannelRun({ prompts, context, config, signal, streamFn }));
}

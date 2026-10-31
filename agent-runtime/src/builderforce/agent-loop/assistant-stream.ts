/**
 * The run's event stream — the `AgentEvent` protocol the on-prem surfaces subscribe to. It settles on `agent_end`, with the
 * run's new messages. (The turn itself — the request, the provider stream — is the channel model port,
 * `run/channelModel.ts`; the events are told by `run/agentEventBridge.ts`.)
 */

import type { AgentEvent, AgentMessage } from "../model/agent-types.js";
import { EventStream } from "./event-stream.js";

/** The run's event stream: it settles on `agent_end`, with the run's new messages. */
export function createAgentStream(): EventStream<AgentEvent, AgentMessage[]> {
  return new EventStream<AgentEvent, AgentMessage[]>(
    (event) => event.type === "agent_end",
    (event) => (event.type === "agent_end" ? event.messages : []),
  );
}

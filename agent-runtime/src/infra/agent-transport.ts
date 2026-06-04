import type {
  AgentTransportDispatchPayload,
  AgentTransportDispatchResult,
  AgentTransportEntry,
  IAgentTransport,
} from "../builderforce/ports.js";
import { logDebug } from "../logger.js";
import { awaitRemoteResult } from "./remote-result-broker.js";
import {
  dispatchToRemoteAgentNode,
  fetchFleetEntries,
  type RemoteDispatchOptions,
} from "./remote-subagent.js";

/**
 * Parse an `auto`/`auto[cap1,cap2]` target string into the required-capability
 * list. Returns null if the target isn't an auto-target.
 *
 * Shared between transport dispatch and any callers that need to introspect
 * an `agentRole` string — single source of truth for the auto-target syntax.
 */
export function parseAutoTarget(targetId: string): string[] | null {
  if (targetId === "auto") {
    return [];
  }
  const inline = targetId.match(/^auto\[(.+)]$/);
  if (!inline) {
    return null;
  }
  return inline[1]
    .split(",")
    .map((cap) => cap.trim())
    .filter(Boolean);
}

export class BuilderforceAgentTransport implements IAgentTransport {
  constructor(private readonly opts: RemoteDispatchOptions) {}

  async discover(requiredCapabilities: string[] = []): Promise<AgentTransportEntry[]> {
    const fleet = await fetchFleetEntries(this.opts);
    const peers = fleet.filter((entry) => String(entry.id) !== String(this.opts.myAgentNodeId));
    const filtered =
      requiredCapabilities.length === 0
        ? peers
        : peers.filter((entry) =>
            requiredCapabilities.every((cap) => entry.capabilities.includes(cap)),
          );
    return filtered.map((entry) => ({
      id: String(entry.id),
      name: entry.name,
      online: entry.online,
      capabilities: entry.capabilities,
      kind: "remote",
    }));
  }

  async dispatch(payload: AgentTransportDispatchPayload): Promise<AgentTransportDispatchResult> {
    let targetId = payload.target.replace(/^remote:/, "");
    const inlineCaps = parseAutoTarget(targetId);
    if (inlineCaps !== null) {
      const requiredCaps =
        inlineCaps.length > 0 ? inlineCaps : (payload.requiredCapabilities ?? []);
      const candidates = await this.discover(requiredCaps);
      const online = candidates.find((entry) => entry.online);
      if (!online) {
        return {
          status: "failed",
          error:
            requiredCaps.length > 0
              ? `No online agentNode satisfies required capabilities: ${requiredCaps.join(", ")}`
              : "No online peer agentNodes available for automatic routing",
        };
      }
      targetId = online.id;
    }

    const result = await dispatchToRemoteAgentNode(this.opts, targetId, payload.input, {
      correlationId: payload.correlationId,
      callbackAgentNodeId: payload.callbackAgentNodeId ?? this.opts.myAgentNodeId,
      timeoutMs: payload.timeoutMs,
    });
    if (result.status !== "accepted") {
      return { status: "failed", error: result.error, targetId };
    }

    if (!payload.correlationId) {
      return { status: "accepted", targetId };
    }

    try {
      const output = await awaitRemoteResult(payload.correlationId, payload.timeoutMs ?? 600_000);
      return { status: "accepted", targetId, output };
    } catch (err) {
      // A correlationId was provided, so the caller IS expecting the remote
      // result. The remote agentNode accepted the task but never called back in time
      // (or the await errored). Report `failed`, not `accepted`: otherwise the
      // orchestrator marks the task `completed` on a result we never received,
      // prematurely advancing autonomous swimlane workflows on unfinished work.
      logDebug(
        `[agent-transport] awaitRemoteResult timed out / failed for correlationId=${payload.correlationId}: ${String(err)}`,
      );
      return {
        status: "failed",
        error: `Remote task result not received from "${targetId}": ${String(err)}`,
        targetId,
      };
    }
  }
}

/**
 * Routing transport — picks the right `IAgentTransport` based on the target
 * prefix (`local:` / `remote:`) so the orchestrator has a single entry point.
 *
 * Unprefixed targets (e.g. `"code-creator"`) default to **local** for
 * backward compatibility with workflows that omit the prefix.
 *
 * Configure exactly the kinds you need:
 *   - Always provide `local` (in-process subagent works without credentials).
 *   - Provide `remote` only when `BUILDERFORCE_API_KEY` + `agentNodeId` are present.
 */

import type {
  AgentTransportDispatchPayload,
  AgentTransportDispatchResult,
  AgentTransportEntry,
  AgentTransportKind,
  IAgentTransport,
} from "../builderforce/ports.js";

export type AgentTransportMap = Partial<Record<AgentTransportKind, IAgentTransport>>;

/** Resolve a target string to its transport kind. */
export function transportKindForTarget(target: string): AgentTransportKind {
  if (target.startsWith("remote:")) {
    return "remote";
  }
  // Bare role names and explicit `local:` both route to local.
  return "local";
}

export class CompositeAgentTransport implements IAgentTransport {
  constructor(private readonly transports: AgentTransportMap) {}

  /** True if the requested kind is wired (callers can short-circuit with a clearer error). */
  has(kind: AgentTransportKind): boolean {
    return !!this.transports[kind];
  }

  async discover(requiredCapabilities: string[] = []): Promise<AgentTransportEntry[]> {
    const lists = await Promise.all(
      Object.values(this.transports).map((t) => t.discover(requiredCapabilities)),
    );
    return lists.flat();
  }

  async dispatch(payload: AgentTransportDispatchPayload): Promise<AgentTransportDispatchResult> {
    const kind = transportKindForTarget(payload.target);
    const transport = this.transports[kind];
    if (!transport) {
      const hint =
        kind === "remote"
          ? "Remote dispatch not configured — set BUILDERFORCE_API_KEY and builderforce.instanceId."
          : "Local dispatch not configured.";
      return { status: "failed", error: hint };
    }
    return transport.dispatch(payload);
  }
}

/**
 * In-process local-dispatch transport.
 *
 * Wraps `spawnSubagentDirect` + `localResultBroker.awaitResult` behind the
 * `IAgentTransport` contract so the orchestrator has one unified dispatch
 * path for both local and remote roles.
 *
 * Target syntax accepted:
 *   "<role>"             — bare role name (default; unprefixed)
 *   "local:<role>"       — explicit local prefix (the new path the reviewer flagged)
 *   "local:auto"         — discover-and-pick first role (mostly useful for tests/diagnostics)
 *   "local:auto[cap1,…]" — discover-and-pick first role with all listed capabilities
 *
 * Cross-process IPC to a sibling agentNode on the same machine is a separate
 * concern; today "local" === in-process subagent. The interface accommodates
 * both — a future IPC-based local transport can replace this without
 * touching the orchestrator.
 */

import { type SpawnSubagentContext, spawnSubagentDirect } from "../agents/subagent-spawn.js";
import { findAgentRole, getBuiltInAgentRoles } from "../builderforce/agent-roles.js";
import { globalPersonaRegistry } from "../builderforce/personas.js";
import type {
  AgentTransportDispatchPayload,
  AgentTransportDispatchResult,
  AgentTransportEntry,
  IAgentTransport,
  ILocalResultBroker,
} from "../builderforce/ports.js";
import type { AgentRole } from "../builderforce/types.js";
import { logDebug } from "../logger.js";
import { parseAutoTarget } from "./agent-transport.js";

export interface LocalAgentTransportOptions {
  /** Returns the spawn context for the *current* dispatch call.
   *  Spawn context can change per-task (session keys, account, etc.), so the
   *  transport calls this each dispatch rather than capturing one at construction. */
  getContext: () => SpawnSubagentContext;
  /** Awaits the actual subagent output via session lifecycle events. */
  localResultBroker: ILocalResultBroker;
  /** Default await timeout when the caller doesn't specify one. Default 600s. */
  defaultTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 600_000;
const LOCAL_PREFIX = "local:";

/** Strip "local:" prefix if present. */
export function stripLocalPrefix(target: string): string {
  return target.startsWith(LOCAL_PREFIX) ? target.slice(LOCAL_PREFIX.length) : target;
}

/** Enumerate all locally-resolvable roles (built-in + persona registry, deduped). */
function listLocalRoles(): AgentRole[] {
  const builtins = getBuiltInAgentRoles();
  const seen = new Set(builtins.map((r) => r.name));
  const personas: AgentRole[] = [];
  for (const persona of globalPersonaRegistry.listAll()) {
    if (seen.has(persona.name)) {
      continue;
    }
    const role = findAgentRole(persona.name);
    if (role) {
      personas.push(role);
      seen.add(persona.name);
    }
  }
  return [...builtins, ...personas];
}

function roleToEntry(role: AgentRole): AgentTransportEntry {
  return {
    id: role.name,
    name: role.name,
    online: true,
    capabilities: role.capabilities ?? [],
    kind: "local",
  };
}

export class LocalAgentTransport implements IAgentTransport {
  constructor(private readonly opts: LocalAgentTransportOptions) {}

  async discover(requiredCapabilities: string[] = []): Promise<AgentTransportEntry[]> {
    const all = listLocalRoles().map(roleToEntry);
    if (requiredCapabilities.length === 0) {
      return all;
    }
    return all.filter((entry) =>
      requiredCapabilities.every((cap) => entry.capabilities.includes(cap)),
    );
  }

  async dispatch(payload: AgentTransportDispatchPayload): Promise<AgentTransportDispatchResult> {
    const stripped = stripLocalPrefix(payload.target);
    let targetId = stripped;

    // Capability auto-routing for `local:auto` / `local:auto[caps]`.
    const inlineCaps = parseAutoTarget(stripped);
    if (inlineCaps !== null) {
      const requiredCaps =
        inlineCaps.length > 0 ? inlineCaps : (payload.requiredCapabilities ?? []);
      const candidates = await this.discover(requiredCaps);
      const picked = candidates[0];
      if (!picked) {
        return {
          status: "failed",
          error:
            requiredCaps.length > 0
              ? `No local role satisfies required capabilities: ${requiredCaps.join(", ")}`
              : "No local roles registered",
        };
      }
      targetId = picked.id;
    }

    const roleConfig = findAgentRole(targetId);
    if (!roleConfig) {
      return {
        status: "failed",
        error: `Unknown agent role: ${targetId}. Define it in .builderforce/personas/ or use a built-in role.`,
        targetId,
      };
    }

    const spawnResult = await spawnSubagentDirect(
      {
        task: payload.input,
        label: targetId,
        agentId: targetId,
        roleConfig,
      },
      this.opts.getContext(),
    );

    if (spawnResult.status !== "accepted") {
      return {
        status: "failed",
        error: spawnResult.error || "Failed to spawn subagent",
        targetId,
      };
    }

    const timeoutMs = payload.timeoutMs ?? this.opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    try {
      const output = await this.opts.localResultBroker.awaitResult(
        spawnResult.runId ?? "",
        spawnResult.childSessionKey ?? "",
        timeoutMs,
      );
      return {
        status: "accepted",
        targetId,
        output,
        ...(spawnResult.childSessionKey ? { childSessionKey: spawnResult.childSessionKey } : {}),
      };
    } catch (err) {
      // The subagent was spawned but we never received its result (timeout or
      // lifecycle error). We CANNOT assert success: returning `accepted` here
      // would make the orchestrator mark the task `completed` on a result we
      // never saw, silently advancing autonomous workflows on unfinished work.
      logDebug(
        `[local-agent-transport] awaitResult timed out / failed for runId=${spawnResult.runId}, childSessionKey=${spawnResult.childSessionKey}: ${String(err)}`,
      );
      return {
        status: "failed",
        error: `Subagent result not received for "${targetId}": ${String(err)}`,
        targetId,
      };
    }
  }
}

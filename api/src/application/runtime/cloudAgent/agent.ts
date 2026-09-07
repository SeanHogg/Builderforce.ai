/**
 * Resolving WHO a cloud run executes as.
 *
 * Split out of `cloudAgentEngine.ts` — a 4,117-line module that had grown to own
 * agent identity, PRD writes, model routing, usage metering, the container op
 * protocol, the tool loop and the limbic layer at once, so changing any one of
 * them meant reading all of them.
 *
 * This is the identity slice: given an `ide_agents.id` (or nothing at all),
 * produce the engine, label, model and runtime affinity the run executes under.
 * It reads `ide_agents` and nothing else, which is why it sits at the bottom of
 * the dependency order — the routing, run-context and container-op modules all
 * build on it and none of them is built on by it.
 */
import { and, eq } from 'drizzle-orm';
import { isAgentRunnable } from '../../../domain/containment/agentState';
import { assertCloudRunByo } from '../../llm/cloudByoPolicy';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import { buildDatabase } from '../../../infrastructure/database/connection';
import { ideAgents } from '../../../infrastructure/database/schema';
import { CURRENT_ENGINE_ID } from '@builderforce/agent-tools';
import type { Env } from '../../../env';

export interface ResolvedCloudAgent {
  engine: string;
  label?: string;
  ref?: string;
  runtimeSurface: string;
  /** The agent's own gateway model, or undefined to use the default. A V2 cloud
   *  agent must execute AS this model so a run is never silently attributed to the
   *  v1 gateway default. */
  baseModel?: string;
  /** Declared execution support: 'cloud' | 'host' | 'both' (undefined = the
   *  gateway-default bucket, treated as permissive). Enforced at dispatch so a
   *  cloud-only agent is never delivered to a pinned On-Prem host. */
  runtimeSupport?: string;
  /** When runtimeSupport==='both', the runtime to prefer ('cloud' | 'host'). The
   *  swimlane coordinator resolves this to an assignment runtime; the direct
   *  dispatch path uses it only to break a tie when a host is available. */
  preferredRuntime?: string | null;
  /** False when the named agent exists but is quarantined/inactive. Missing refs keep
   * the legacy gateway-default fallback; a known inactive teammate must never run. */
  active?: boolean;
}

/** Does an agent's declared runtime_support permit running on an On-Prem host?
 *  Undefined (gateway default / legacy) is permissive so existing host runs keep
 *  working; only an explicit 'cloud' marks the agent cloud-only. */
export function agentAllowsHostExecution(runtimeSupport: string | undefined): boolean {
  return runtimeSupport !== 'cloud';
}

/** `ide_agents.base_model` sentinel meaning "no explicit model — use the default". */
export const AGENT_DEFAULT_MODEL_SENTINEL = 'builderforce-default';

/**
 * Resolve the runtime engine + display label for a cloud-agent run from its
 * `ide_agents.id`. When a ref resolves, the engine/name/surface/model are read from
 * that agent's record (authoritative, tenant-scoped); otherwise V1 with no label
 * (gateway-default bucket). One indexed lookup per submit (not a hot path).
 */
export async function resolveCloudAgent(
  env: Env,
  tenantId: number,
  ref: string | undefined,
): Promise<ResolvedCloudAgent> {
  // The engine is ALWAYS the current version (a code constant) — never read from the
  // DB. A run is the current engine regardless of any legacy `engine` value on the row.
  const DEFAULT: ResolvedCloudAgent = { engine: CURRENT_ENGINE_ID, ref, runtimeSurface: 'durable' };
  if (!ref) return DEFAULT;
  const db = buildDatabase(env);
  const rows = await db
    .select({
      name:             ideAgents.name,
      runtimeSurface:   ideAgents.runtimeSurface,
      baseModel:        ideAgents.baseModel,
      runtimeSupport:   ideAgents.runtimeSupport,
      preferredRuntime: ideAgents.preferredRuntime,
      status:           ideAgents.status,
    })
    .from(ideAgents)
    .where(and(eq(ideAgents.id, ref), eq(ideAgents.tenantId, tenantId)))
    .limit(1);
  const engine = CURRENT_ENGINE_ID;
  const label = typeof rows[0]?.name === 'string' && rows[0].name ? rows[0].name : undefined;
  const runtimeSurface = rows[0]?.runtimeSurface === 'container' ? 'container' : 'durable';
  const rawModel = typeof rows[0]?.baseModel === 'string' ? rows[0].baseModel.trim() : '';
  const baseModel = rawModel && rawModel !== AGENT_DEFAULT_MODEL_SENTINEL ? rawModel : undefined;
  const runtimeSupport = typeof rows[0]?.runtimeSupport === 'string' ? rows[0].runtimeSupport : undefined;
  const preferredRuntime = rows[0]?.preferredRuntime ?? null;
  const active = rows[0] ? isAgentRunnable(rows[0].status) : undefined;
  return { engine, label, ref, runtimeSurface, baseModel, runtimeSupport, preferredRuntime, active };
}
/**
 * Load a cloud agent's OWN psychometric profile (ide_agents.psychometric) — the
 * per-agent personality set from the Workforce editor, independent of any assigned
 * persona. Returns the raw JSON string (or null). Tenant-scoped, one indexed lookup;
 * consumed by prepareCloudRun to compile prompt directives + exec params + setpoints.
 */
export async function loadAgentPsychometric(
  env: Env,
  tenantId: number,
  ref: string | undefined,
): Promise<string | null> {
  if (!ref) return null;
  try {
    const db = buildDatabase(env);
    const rows = await db
      .select({ psychometric: ideAgents.psychometric })
      .from(ideAgents)
      .where(and(eq(ideAgents.id, ref), eq(ideAgents.tenantId, tenantId)))
      .limit(1);
    return typeof rows[0]?.psychometric === 'string' ? rows[0].psychometric : null;
  } catch (error) {
    reportCaughtError(error, { source: "application/runtime/cloudAgentEngine.ts", operation: "loadAgentPsychometric", context: { logMessage: '[cloud-agent] psychometric profile load failed', details: { tenantId, ref, error } } });
    return null;
  }
}

/**
 * Run an execution server-side via the gateway when NO online agentHost took the
 * dispatch (Auto / cloud agent with no self-hosted runtime). The task is run as a
 * single gateway completion using the chosen model (the cloud agent's, or the
 * default), so a cloud/auto run produces a deliverable instead of hanging in
 * `pending` forever. Coding tasks that need a real repo/runtime still belong on
 * an agentHost — this is the fallback so non-host runs complete. Never throws.
 */
/**
 * PRD-first step of the standard flow: ensure the project has a PRD for this
 * work. If one already exists it's reused; otherwise a WIP PRD is generated from
 * the task, **persisted to `specs`** (so it appears in the PRD tab and is
 * associated with the project) and surfaced as the first "file change" (PRD.md).
 * Returns the PRD markdown, or '' if generation failed. Never throws.
 *
 * NOTE: cloning the repo + analyzing the code before drafting (and writing
 * `PRD.md` into the actual repo) requires a connected runtime — see gap register.
 * Here we persist to the canonical PRD store the PRD tab reads.
 */
/** Record a durable, agent-attributed file change for the task's Changes tab. */

export const DEFAULT_CLOUD_REF = '__default__';

/**
 * Fail-closed BYO gate for a cloud execution surface (GAP-B2 / GAP-B4).
 *
 * Applies the shared {@link assertCloudRunByo} policy and, when it refuses, records
 * ONE `byo.blocked` timeline event so the operator sees the named cause on the run
 * instead of a raw provider error (or worse, a quietly platform-billed turn).
 * Returns the typed failure, or null when the run may proceed.
 *
 * Both cloud surfaces (the in-Worker/durable loop and the container `llm` op) call
 * this before their first paid call, so the rule has one implementation.
 */

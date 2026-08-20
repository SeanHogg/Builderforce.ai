/**
 * Shared tenant agent pool — the registered agents a tenant can assign to any
 * aspect of the platform (project, workflow, architecture, security, brain…).
 * One loader so every "assign an agent" surface draws from the same source (DRY).
 */
import { registeredAgents, type RegisteredAgent } from './builderforceApi';
import { listMyAgents, listPurchasedAgents } from './api';
import type { PublishedAgent } from './types';
import { getProjectWorkforce } from './teams';

/** A selectable agent from one of the tenant's two source pools. */
export interface PoolAgent {
  kind: 'workforce' | 'registered';
  ref: string;
  name: string;
  meta: string;
  /** Gateway-resolvable model for this agent (workforce base_model), or null when
   *  it should use the default (the 'builderforce-default' sentinel / registered). */
  baseModel?: string | null;
}

/** base_model sentinel meaning "no explicit model — use the default". */
const DEFAULT_MODEL_SENTINEL = 'builderforce-default';

export const AGENT_KIND_LABEL: Record<PoolAgent['kind'], string> = {
  workforce: 'Workforce',
  registered: 'Registered',
};

/**
 * Load the tenant's assignable agents. Always tenant-wide: an agent is registered
 * ONCE to the tenant and can be assigned to ANY surface (project, swimlane,
 * architecture, security, brain). The pool is the tenant's OWN cloud agents
 * (`listMyAgents`, any publish state — drafts included) PLUS agents acquired from
 * the marketplace (`listPurchasedAgents`) PLUS registered remote agents — NOT the
 * public marketplace catalog. Cloud agents live at tenant level (project_id NULL),
 * so the pool is never project-filtered.
 */
export async function loadAgentPool(): Promise<PoolAgent[]> {
  const [owned, purchased, registered] = await Promise.all([
    listMyAgents().catch(() => [] as PublishedAgent[]),
    listPurchasedAgents().catch(() => [] as PublishedAgent[]),
    registeredAgents.list().catch(() => [] as RegisteredAgent[]),
  ]);
  // Dedupe workforce agents by id (an agent could be both owned and listed).
  const wfById = new Map<string, PublishedAgent>();
  for (const a of [...owned, ...purchased]) wfById.set(String(a.id), a);
  const wf: PoolAgent[] = [...wfById.values()].map((a) => ({
    kind: 'workforce',
    ref: String(a.id),
    name: a.name,
    meta: a.title || a.base_model,
    baseModel: a.base_model && a.base_model !== DEFAULT_MODEL_SENTINEL ? a.base_model : null,
  }));
  const reg: PoolAgent[] = registered
    .filter((a) => a.isActive)
    .map((a) => ({ kind: 'registered', ref: String(a.id), name: a.name, meta: a.type, baseModel: null }));
  return [...wf, ...reg];
}

// Shared session cache for the pool (stable tenant data — a 3-endpoint fan-out).
// The Brain surface reads it from several places at once (persona picker, the
// chat↔ticket adapter, the composer's recipient picker); this dedups those into
// ONE fetch instead of 3× the fan-out. `refreshAgentPool()` busts it after a
// mutation (e.g. creating/acquiring an agent) so the next read is fresh.
let poolPromise: Promise<PoolAgent[]> | null = null;

/** Load the agent pool through the shared session cache (see {@link loadAgentPool}). */
export function loadAgentPoolCached(): Promise<PoolAgent[]> {
  if (!poolPromise) poolPromise = loadAgentPool().catch((e) => { poolPromise = null; throw e; });
  return poolPromise;
}

/** Invalidate the cached pool so the next {@link loadAgentPoolCached} refetches. */
export function refreshAgentPool(): void {
  poolPromise = null;
}

/**
 * The lane-agent pool, SCOPED TO THE PROJECT'S TEAMS.
 *
 * `loadAgentPool` is deliberately tenant-wide — an agent is registered once and may be
 * assigned to any surface — but a BOARD is a team's board. Offering every agent in the
 * workspace on a lane picker meant an operator could staff a lane with an agent from a
 * team that has nothing to do with that project, and the picker's id-space did not even
 * match the one `team_members` uses, so nothing downstream could tell.
 *
 * When the project has teams attached, the pool is narrowed to agents in those teams'
 * membership. When it has none, `scopedToTeams` is false and the full tenant pool is the
 * correct answer — that is the documented contract of `getProjectWorkforce`, and
 * narrowing to an empty set would leave the picker unusable on every un-teamed project.
 *
 * Membership is matched on `(kind, ref)`: a `cloud_agent` team member and a `workforce`
 * pool agent are the same entity under two vocabularies, which is precisely the
 * id-space mismatch that made this scoping impossible to express before.
 */
export async function loadProjectAgentPool(projectId: number): Promise<PoolAgent[]> {
  const [pool, scope] = await Promise.all([
    loadAgentPoolCached(),
    getProjectWorkforce(projectId).catch(() => null),
  ]);
  if (!scope?.scopedToTeams || scope.workforce.length === 0) return pool;

  // `cloud_agent` (team vocabulary) ≡ `workforce` (pool vocabulary); `host_agent` ≡
  // `registered`. Humans in the team are not assignable to a lane at all.
  const allowed = new Set(
    scope.workforce
      .filter((m) => m.kind === 'cloud_agent' || m.kind === 'host_agent')
      .map((m) => `${m.kind === 'cloud_agent' ? 'workforce' : 'registered'}:${m.ref}`),
  );
  const scoped = pool.filter((a) => allowed.has(`${a.kind}:${a.ref}`));
  // A team whose members are all human leaves nothing to staff a lane with; the full
  // pool is a better answer than an empty picker with no explanation.
  return scoped.length > 0 ? scoped : pool;
}

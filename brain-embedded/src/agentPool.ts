/**
 * The tenant's assignable agent pool — ONE roster built from three source lists:
 * the tenant's own cloud (workforce) agents, agents acquired from the marketplace,
 * and registered remote agents. An agent is registered once to the tenant and can
 * be assigned to any surface (project, swimlane, brain…), so the pool is never
 * project-filtered here.
 *
 * Pure mapping plus a transport-agnostic loader: the web app fetches through its own
 * API client and the VS Code webview through its authed fetch, but both build the
 * SAME pool from the SAME rows — which is what keeps a persona picker or a recipient
 * chip naming an agent identically on both surfaces.
 */

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

/** The fields of a workforce (cloud) agent row the pool reads. */
export interface PoolWorkforceAgentRow {
  id: number | string;
  name: string;
  title?: string | null;
  base_model?: string | null;
}

/** The fields of a registered remote agent row the pool reads. */
export interface PoolRegisteredAgentRow {
  id: number | string;
  name: string;
  type: string;
  isActive: boolean;
}

/** base_model sentinel meaning "no explicit model — use the default". */
export const DEFAULT_AGENT_MODEL_SENTINEL = 'builderforce-default';

/** The three endpoints the pool is built from. */
export const AGENT_POOL_PATHS = {
  owned: '/api/workforce/agents/mine',
  purchased: '/api/workforce/agents/purchased',
  registered: '/api/agents',
} as const;

/** Build the pool from its three source lists (owned + purchased deduped by id). */
export function poolAgentsFrom(input: {
  owned: readonly PoolWorkforceAgentRow[];
  purchased: readonly PoolWorkforceAgentRow[];
  registered: readonly PoolRegisteredAgentRow[];
}): PoolAgent[] {
  // An agent can be both owned and listed as purchased — one entry per id.
  const wfById = new Map<string, PoolWorkforceAgentRow>();
  for (const a of [...input.owned, ...input.purchased]) wfById.set(String(a.id), a);
  const workforce: PoolAgent[] = [...wfById.values()].map((a) => ({
    kind: 'workforce',
    ref: String(a.id),
    name: a.name,
    meta: a.title || a.base_model || '',
    baseModel: a.base_model && a.base_model !== DEFAULT_AGENT_MODEL_SENTINEL ? a.base_model : null,
  }));
  const registered: PoolAgent[] = input.registered
    .filter((a) => a.isActive)
    .map((a) => ({ kind: 'registered', ref: String(a.id), name: a.name, meta: a.type, baseModel: null }));
  return [...workforce, ...registered];
}

/** A host's authenticated JSON GET. */
export type PoolRequest = <T>(path: string) => Promise<T>;

/** Load the pool through a host's transport. Each source degrades to empty on its own. */
export async function loadAgentPoolVia(request: PoolRequest): Promise<PoolAgent[]> {
  const [owned, purchased, registered] = await Promise.all([
    request<PoolWorkforceAgentRow[]>(AGENT_POOL_PATHS.owned).catch(() => [] as PoolWorkforceAgentRow[]),
    request<PoolWorkforceAgentRow[]>(AGENT_POOL_PATHS.purchased).catch(() => [] as PoolWorkforceAgentRow[]),
    request<PoolRegisteredAgentRow[]>(AGENT_POOL_PATHS.registered).catch(() => [] as PoolRegisteredAgentRow[]),
  ]);
  return poolAgentsFrom({ owned: owned ?? [], purchased: purchased ?? [], registered: registered ?? [] });
}

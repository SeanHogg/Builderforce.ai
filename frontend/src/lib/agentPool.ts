/**
 * Shared tenant agent pool — the registered agents a tenant can assign to any
 * aspect of the platform (project, workflow, architecture, security, brain…).
 * One loader so every "assign an agent" surface draws from the same source (DRY).
 */
import { registeredAgents, type RegisteredAgent } from './builderforceApi';
import { listMyAgents, listPurchasedAgents } from './api';
import type { PublishedAgent } from './types';

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

/**
 * Shared tenant agent pool — the registered agents a tenant can assign to any
 * aspect of the platform (project, workflow, architecture, security, brain…).
 * One loader so every "assign an agent" surface draws from the same source (DRY).
 */
import { registeredAgents, type RegisteredAgent } from './builderforceApi';
import { listAgents } from './api';
import type { PublishedAgent } from './types';

/** A selectable agent from one of the tenant's two source pools. */
export interface PoolAgent {
  kind: 'workforce' | 'registered';
  ref: string;
  name: string;
  meta: string;
}

export const AGENT_KIND_LABEL: Record<PoolAgent['kind'], string> = {
  workforce: 'Workforce',
  registered: 'Registered',
};

/**
 * Load the tenant's assignable agents. With `projectId`, workforce agents are
 * filtered to that project (project-scoped attach UI); without it, all of the
 * tenant's workforce agents are returned (tenant-wide assignment surfaces).
 */
export async function loadAgentPool(opts?: { projectId?: number }): Promise<PoolAgent[]> {
  const [workforce, registered] = await Promise.all([
    listAgents().catch(() => [] as PublishedAgent[]),
    registeredAgents.list().catch(() => [] as RegisteredAgent[]),
  ]);
  const wf: PoolAgent[] = workforce
    .filter((a) => opts?.projectId == null || String(a.project_id) === String(opts.projectId))
    .map((a) => ({ kind: 'workforce', ref: String(a.id), name: a.name, meta: a.title || a.base_model }));
  const reg: PoolAgent[] = registered
    .filter((a) => a.isActive)
    .map((a) => ({ kind: 'registered', ref: String(a.id), name: a.name, meta: a.type }));
  return [...wf, ...reg];
}

/**
 * managerTypes — the catalog of AI Manager DOMAIN TYPES.
 *
 * One tenant may want very different managers: a Development manager that shepherds
 * code + PRs, a QA manager that drives defects + coverage, an IT Service Desk manager
 * that triages support/incidents by SLA, a DevOps manager that guards reliability +
 * deploys. They all run the SAME mechanical pass (value → rank → assign → PR →
 * dispatch → audit); the TYPE only changes the JUDGEMENT — what the manager values
 * and prioritizes. That judgement is an LLM concern, so each type is expressed as a
 * `directive` folded into the manager's scoring/prioritization persona (alongside the
 * designated agent's persona and any human coaching directives — see ManagerService).
 *
 * A manager is a TEAM MEMBER with a functional role, and its type IS that role: every
 * built-in type declares the roster `roleKey` (from the shared roleCatalog) it fills,
 * and a tenant's CUSTOM job roles each surface as a matching manager type (id
 * `role:<key>`) — so the type list and the role taxonomy are ONE concept, and adding
 * an org-specific role also offers a manager type for it. See {@link resolveManagerTypesForTenant}.
 *
 * THE single source of the built-in type list: the API pass reads `directive` here; the
 * UI renders `label`/`description` (localized in the frontend by the SAME `id`). Adding a
 * built-in type = one entry here + its five i18n strings; nothing else branches on the id.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { JobRoleService } from '../kanban/jobRoleService';
import type { Discipline, JobRole } from '../kanban/types';

/** Built-in domain ids. A stored/submitted type may ALSO be a `role:<key>` custom-role id. */
export type ManagerTypeId = 'general' | 'delivery' | 'qa' | 'service_desk' | 'devops';

export interface ManagerType {
  /** 'general' | 'delivery' | 'qa' | 'service_desk' | 'devops' for built-ins, or `role:<roleKey>` for a custom job role. */
  id: string;
  /** English fallback label (built-ins are localized by id via `managerType.<id>.label`). */
  label: string;
  /** English fallback description (built-ins localized by `managerType.<id>.description`). */
  description: string;
  /** Domain framing folded into the manager's AI scoring/prioritization persona.
   *  Prompt text (fed to the model), so it is NOT user-facing copy and stays here. */
  directive: string;
  /** The roster role (roleCatalog key) this manager fills — the tie between the
   *  manager's TYPE and its team ROLE. Null when no catalog role maps to the domain. */
  roleKey: string | null;
  /** The discipline axis this type leads, aligned with the role taxonomy. */
  discipline: Discipline;
  /** True for a code-defined built-in; false for a tenant custom-role-derived type. */
  builtin: boolean;
}

export const MANAGER_TYPES: ManagerType[] = [
  {
    id: 'general',
    label: 'General manager',
    description: 'Domain-neutral backlog management — value, rank, assign, and shepherd PRs across all work.',
    directive:
      'You manage a general delivery backlog. Weigh each ticket by its business value, urgency, and dependencies without a specific domain bias.',
    roleKey: 'manager', discipline: 'other', builtin: true,
  },
  {
    id: 'delivery',
    label: 'Development manager',
    description: 'Ships features. Prioritizes code work, unblocking dependencies, and getting pull requests reviewed and merged.',
    directive:
      'You are a software Development manager. Prioritize feature and engineering work that moves the product forward: value tickets that ship user-facing capability, unblock other work, or clear review-ready pull requests highest. Favor momentum — keep code flowing from in-progress to merged.',
    roleKey: 'developer', discipline: 'engineering', builtin: true,
  },
  {
    id: 'qa',
    label: 'QA manager',
    description: 'Owns quality. Prioritizes defects, test coverage gaps, flaky tests, and release-blocking bugs.',
    directive:
      'You are a QA manager. Prioritize quality work: defects, regressions, release-blocking bugs, test-coverage gaps, and flaky/failing tests. Value tickets that reduce escaped defects and raise the release confidence signal highest; treat unverified "done" work as risk.',
    roleKey: 'qa-tester', discipline: 'qa', builtin: true,
  },
  {
    id: 'service_desk',
    label: 'IT Service Desk manager',
    description: 'Runs support. Triages incidents, requests, and outages by SLA and customer impact first.',
    directive:
      'You are an IT Service Desk manager. Prioritize by customer impact and SLA: active incidents and outages first, then time-sensitive support requests, then routine service requests. Value tickets that restore service or unblock a waiting user highest; escalate anything breaching or near an SLA.',
    roleKey: null, discipline: 'other', builtin: true,
  },
  {
    id: 'devops',
    label: 'DevOps / IT Operations manager',
    description: 'Guards reliability. Prioritizes deploys, infrastructure, monitoring, and operational risk.',
    directive:
      'You are a DevOps / IT Operations manager. Prioritize reliability, security, and operational readiness: deploys, infrastructure and pipeline work, monitoring/alerting gaps, and toil reduction. Value tickets that reduce production risk, remove single points of failure, or unblock a release highest.',
    roleKey: 'devops', discipline: 'devops', builtin: true,
  },
];

export const DEFAULT_MANAGER_TYPE: ManagerTypeId = 'general';

const BY_ID = new Map<string, ManagerType>(MANAGER_TYPES.map((t) => [t.id, t]));

/** A `role:<key>` custom-type id (key = a slugified job-role key, ≤60 chars). */
const CUSTOM_TYPE_RE = /^role:[a-z0-9][a-z0-9-]{0,59}$/;

/** The roleKey a `role:<key>` custom manager-type id points at (null for non-custom ids). */
export function customTypeRoleKey(id: string): string | null {
  return CUSTOM_TYPE_RE.test(id) ? id.slice('role:'.length) : null;
}

/**
 * Normalize an arbitrary stored/submitted type id to a valid one: a known built-in id,
 * a well-formed `role:<key>` custom-role id (existence is resolved lazily — a since-
 * deleted role simply falls back to the general directive at run time), else 'general'.
 */
export function normalizeManagerType(v: unknown): string {
  if (typeof v === 'string') {
    if (BY_ID.has(v)) return v;
    if (CUSTOM_TYPE_RE.test(v)) return v;
  }
  return DEFAULT_MANAGER_TYPE;
}

/** Resolve a BUILT-IN type id to its definition (never null — falls back to 'general').
 *  Custom `role:<key>` types need the tenant's roles — use {@link resolveManagerTypeById}. */
export function resolveManagerType(id: string | null | undefined): ManagerType {
  const norm = normalizeManagerType(id);
  return BY_ID.get(norm) ?? BY_ID.get(DEFAULT_MANAGER_TYPE)!;
}

/**
 * Turn a tenant CUSTOM job role into a manager type: a manager that leads that role's
 * function. The directive is synthesized from the role so a custom "Data Platform" or
 * "Support" role steers the pass without any code change. Built-in roles are already
 * covered by the built-in types, so only custom roles are derived.
 */
export function deriveManagerTypeFromRole(role: JobRole): ManagerType {
  const desc = role.description?.trim();
  return {
    id: `role:${role.key}`,
    label: `${role.name} manager`,
    description: desc || `Leads ${role.name} work across the backlog.`,
    directive:
      `You are a ${role.name} manager, leading the ${role.discipline} function.` +
      (desc ? ` Your remit: ${desc}` : '') +
      ` Prioritize backlog work that advances ${role.name} responsibilities and outcomes highest.`,
    roleKey: role.key, discipline: role.discipline, builtin: false,
  };
}

/**
 * The full manager-type catalog for a tenant = the built-in domains PLUS one derived
 * type per tenant CUSTOM job role. Reuses the cached role list (JobRoleService), so
 * this is a single read-through lookup. This is the ONE list the surface offers and
 * the pass resolves against, so a manager's type and its roster role stay one concept.
 */
export async function resolveManagerTypesForTenant(
  env: Env, db: Db, tenantId: number,
): Promise<ManagerType[]> {
  const roles = await new JobRoleService(db).list(env, tenantId).catch(() => [] as JobRole[]);
  const custom = roles.filter((r) => !r.builtin).map(deriveManagerTypeFromRole);
  return [...MANAGER_TYPES, ...custom];
}

/**
 * Resolve ANY stored type id (built-in OR `role:<key>`) to its definition, tenant-aware.
 * A custom id resolves against the tenant's roles; a since-deleted custom role (or any
 * unknown id) falls back to the general definition so the pass never breaks.
 */
export async function resolveManagerTypeById(
  env: Env, db: Db, tenantId: number, id: string | null | undefined,
): Promise<ManagerType> {
  const norm = normalizeManagerType(id);
  const builtin = BY_ID.get(norm);
  if (builtin) return builtin;
  const roleKey = customTypeRoleKey(norm);
  if (roleKey) {
    const roles = await new JobRoleService(db).list(env, tenantId).catch(() => [] as JobRole[]);
    const role = roles.find((r) => r.key === roleKey);
    if (role) return deriveManagerTypeFromRole(role);
  }
  return BY_ID.get(DEFAULT_MANAGER_TYPE)!;
}

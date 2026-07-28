/**
 * Role capability — the first-class answer to "can this agent act AS role X?",
 * and the deterministic role→persona→agent resolution the Coordinated Role
 * Participation PRD needs. Replaces the convention-only fuzzy `agentMatchesRole`
 * as the SINGLE source of truth (fuzzy stays only as a last-resort fallback).
 *
 * This is the fix for the #467 root cause: assignment/dispatch was role-blind, so
 * a free Product Manager agent could out-rank a busy Developer on a coding ticket
 * and then auto-run AS the implementer. Capability is now explicit:
 *   explicit ide_agents.role_keys  →  builtin_kind-derived  →  fuzzy title/skill.
 */
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { ideAgents, memberProfiles, projectRoleAssignments, users } from '../../infrastructure/database/schema';
import { readWorkforceMetricsVersion } from '../metrics/workforceMetrics';
import { BUILTIN_ROLES } from './roleCatalog';
import { agentMatchesRole } from './roleMatch';
import type { ActionType } from '../llm/actionTypes';

/**
 * Kanban role key → agent-runtime persona name (agent-runtime `agent-roles.ts`).
 * Makes role→persona→agent dispatch deterministic instead of convention-only. Only
 * `code-reviewer` is identical across the two taxonomies; everything else aliases.
 */
export const ROLE_PERSONA_ALIASES: Readonly<Record<string, string>> = {
  developer: 'code-creator',
  'code-reviewer': 'code-reviewer',
  'qa-tester': 'test-generator',
  architect: 'architecture-advisor',
  'tech-writer': 'documentation-agent',
  security: 'security-agent',
  validator: 'validator-agent',
  'team-lead': 'validator-agent',
  'product-owner': 'product-manager',
  'product-manager': 'product-manager',
  'business-analyst': 'business-analyst',
  designer: 'designer',
  devops: 'devops',
  manager: 'manager',
};

/** The runtime persona to dispatch an agent as when it acts for `roleKey`. */
export function personaForRole(roleKey: string): string {
  return ROLE_PERSONA_ALIASES[roleKey] ?? roleKey;
}

/**
 * ide_agents.builtin_kind → the role keys that built-in agent is inherently capable
 * of (seeded deterministically in provisionBuiltinAgents.ts). Superseding the fuzzy
 * skill match for the seeded agents (Risk mitigation in the PRD).
 */
/**
 * `ide_agents.builtin_kind` → the role keys that built-in agent is inherently capable of.
 *
 * A kind listed here is an AUTHORITATIVE boundary: `agentRoleKeys` returns early for it
 * and deliberately refuses to widen by fuzzy title/skill match. So a kind's entry must
 * name every role it should be able to fill — an omission is a silent capability LOSS,
 * not a conservative default.
 *
 * `cto`, `product_owner` and `manager` were seeded as built-in agents (migrations 0335,
 * 0376) and never given entries, so their capability fell through to fuzzy title matching
 * — which is how a workspace could hold a CTO whose declared skills literally begin with
 * 'architecture' while the `architect` role resolved to nobody, and every stage requiring
 * it classified `managed_no_role`. Measured on project 11: 447 stalled tickets on that
 * cause, with Architect among the most-owed outstanding roles.
 */
export const BUILTIN_KIND_ROLE_KEYS: Readonly<Record<string, string[]>> = {
  validator: ['validator', 'team-lead', 'code-reviewer', 'qa-tester', 'business-analyst'],
  security: ['security'],
  product_manager: ['product-manager', 'product-owner', 'business-analyst'],
  designer: ['designer'],
  incident_manager: ['manager'],
  // Judges technical feasibility, proposes the architecture and phase plan, owns delivery
  // risk — the Architect role's remit, plus the technical-leadership review the Team Lead
  // slot asks for.
  cto: ['architect', 'team-lead'],
  // Accountable for value and acceptance; the same product remit as the Product Manager.
  product_owner: ['product-owner', 'product-manager', 'business-analyst'],
  // The delivery-manager role, and the coordination half of team leadership.
  manager: ['manager', 'team-lead'],
};

/**
 * Which producer role a ticket's technical action-type implies — used to derive an
 * assignment/dispatch role constraint when there is no explicit stage requirement
 * (e.g. Epic children created before they hit a lane). `undefined` = no constraint.
 */
export function producerRoleForActionType(actionType: ActionType | string | null | undefined): string | undefined {
  switch (actionType) {
    case 'sql':
    case 'frontend_ui':
    case 'backend_api':
    case 'refactor':
    case 'bugfix':
    case 'data_migration':
      return 'developer';
    case 'tests':
      return 'qa-tester';
    case 'docs':
      return 'tech-writer';
    case 'devops_ci':
      return 'devops';
    default:
      return undefined;
  }
}

export interface RoleCapableAgentRow {
  id: string;
  name: string;
  title?: string | null;
  skills?: string | null;
  builtinKind?: string | null;
  roleKeys?: unknown;
}

function parseRoleKeys(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((k): k is string => typeof k === 'string' && k.trim().length > 0).map((k) => k.trim());
  return [];
}

/** The full set of role keys an agent can act as (explicit ∪ builtin_kind ∪ fuzzy). */
export function agentRoleKeys(a: RoleCapableAgentRow): Set<string> {
  const keys = new Set<string>();
  for (const k of parseRoleKeys(a.roleKeys)) keys.add(k);
  const kindKeys = a.builtinKind ? BUILTIN_KIND_ROLE_KEYS[a.builtinKind] : undefined;
  if (kindKeys) {
    for (const k of kindKeys) keys.add(k);
    // A built-in identity is an authoritative role boundary. Generic execution
    // skills/personas (e.g. "coding-agent" attached for tool availability) must
    // not turn a Product Manager into a Developer. Grant cross-role capability
    // explicitly through role_keys or a project role assignment.
    return keys;
  }
  for (const r of BUILTIN_ROLES) {
    if (agentMatchesRole({ title: a.title ?? null, name: a.name, skills: a.skills ?? null }, r.key, r.name)) keys.add(r.key);
  }
  return keys;
}

/** Can this agent act AS `roleKey`? Empty roleKey ⇒ no constraint (true). */
export function agentIsRoleCapable(a: RoleCapableAgentRow, roleKey: string | null | undefined): boolean {
  const nk = (roleKey ?? '').trim();
  if (!nk) return true;
  return agentRoleKeys(a).has(nk);
}

export type RoleCapableVia = 'assignment' | 'role-keys' | 'builtin-kind' | 'agent-skill';
export interface RoleCandidate {
  kind: 'agent';
  ref: string;
  name: string;
  via: RoleCapableVia;
}

const capabilityKey = (tenantId: number, projectId: number, roleKey: string, v: string | number) =>
  `role-capable:tenant:${tenantId}:project:${projectId}:role:${roleKey}:v:${v}`;

/**
 * The agents capable of acting AS `roleKey` for a project, in precedence order:
 *   1) explicit project_role_assignments pin (kind 'agent'),
 *   2) explicit ide_agents.role_keys,
 *   3) builtin_kind-derived,
 *   4) fuzzy title/skill fallback.
 * Cached on the workforce-metrics version token (bumps when agents/assignments change).
 */
export async function resolveRoleCapableAgents(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  roleKey: string,
): Promise<RoleCandidate[]> {
  const version = await readWorkforceMetricsVersion(env, tenantId);
  return getOrSetCached(env, capabilityKey(tenantId, projectId, roleKey, version), async () => {
    const agents = await db
      .select({ id: ideAgents.id, name: ideAgents.name, title: ideAgents.title, skills: ideAgents.skills, builtinKind: ideAgents.builtinKind, roleKeys: ideAgents.roleKeys })
      .from(ideAgents)
      .where(and(eq(ideAgents.tenantId, tenantId), eq(ideAgents.status, 'active')));
    const byId = new Map(agents.map((a) => [a.id, a]));

    // 1) explicit pins (project-specific + workspace default) for this role.
    const pins = await db
      .select({ projectId: projectRoleAssignments.projectId, assigneeRef: projectRoleAssignments.assigneeRef, assigneeName: projectRoleAssignments.assigneeName })
      .from(projectRoleAssignments)
      .where(rolePinConditions(tenantId, roleKey, projectId));

    const out: RoleCandidate[] = [];
    const seen = new Set<string>();
    pins.sort((a, b) => Number(b.projectId === projectId) - Number(a.projectId === projectId));
    for (const p of pins) {
      if (seen.has(p.assigneeRef)) continue;
      const a = byId.get(p.assigneeRef);
      if (!a) continue;
      out.push({ kind: 'agent', ref: p.assigneeRef, name: p.assigneeName ?? a?.name ?? p.assigneeRef, via: 'assignment' });
      seen.add(p.assigneeRef);
    }
    // 2–4) capability-derived, tagged by the strongest reason each qualifies.
    for (const a of agents) {
      if (seen.has(a.id)) continue;
      const explicit = parseRoleKeys(a.roleKeys).includes(roleKey);
      const kind = !!a.builtinKind && (BUILTIN_KIND_ROLE_KEYS[a.builtinKind] ?? []).includes(roleKey);
      const fuzzy = !explicit && !kind && agentIsRoleCapable(a, roleKey);
      if (!explicit && !kind && !fuzzy) continue;
      out.push({ kind: 'agent', ref: a.id, name: a.name, via: explicit ? 'role-keys' : kind ? 'builtin-kind' : 'agent-skill' });
      seen.add(a.id);
    }
    return out;
  });
}

/**
 * The `project_role_assignments` predicate for "this agent is PINNED to this role",
 * scoped to a project with the workspace-wide (null projectId) pin folded in.
 *
 * Extracted so the two readers of that table — {@link resolveRoleCapableAgents}, which
 * SELECTS a role's agents, and {@link isAgentRefRoleCapable}, which GATES one agent —
 * can never disagree about what a pin is. They disagreed for weeks, and it cost the
 * platform its entire sign-off ledger (see that function's note).
 */
function rolePinConditions(tenantId: number, roleKey: string, projectId?: number | null) {
  return and(
    eq(projectRoleAssignments.tenantId, tenantId),
    eq(projectRoleAssignments.roleKey, roleKey),
    eq(projectRoleAssignments.assigneeKind, 'agent'),
    projectId == null
      ? isNull(projectRoleAssignments.projectId)
      : or(eq(projectRoleAssignments.projectId, projectId), isNull(projectRoleAssignments.projectId)),
  );
}

/** Is this agent explicitly PINNED to `roleKey` (project-specific or workspace-wide)? */
async function agentIsRolePinned(db: Db, tenantId: number, agentRef: string, roleKey: string, projectId?: number | null): Promise<boolean> {
  const [pin] = await db
    .select({ ref: projectRoleAssignments.assigneeRef })
    .from(projectRoleAssignments)
    .where(and(rolePinConditions(tenantId, roleKey, projectId), eq(projectRoleAssignments.assigneeRef, agentRef)))
    .limit(1);
  return !!pin;
}

/** Load the capability-relevant columns for one agent ref (or null if missing). */
export async function loadAgentCapabilityRow(db: Db, tenantId: number, agentRef: string): Promise<RoleCapableAgentRow | null> {
  const [row] = await db
    .select({ id: ideAgents.id, name: ideAgents.name, title: ideAgents.title, skills: ideAgents.skills, builtinKind: ideAgents.builtinKind, roleKeys: ideAgents.roleKeys })
    .from(ideAgents)
    .where(and(eq(ideAgents.tenantId, tenantId), eq(ideAgents.id, agentRef)))
    .limit(1);
  return row ?? null;
}

/**
 * Is the given agent ref capable of `roleKey`? Unknown ref ⇒ not capable (false)
 * when a role is required. Empty roleKey ⇒ true (no constraint).
 *
 * THIS IS THE GATE, and it must accept exactly what {@link resolveRoleCapableAgents}
 * — THE SELECTOR — dispatches on. It did not, and that asymmetry is the measured cause
 * of an empty sign-off ledger: **0 rows in `ticket_role_signoffs` against 1,030 reviewer
 * runs**, with 2,288 required manifest slots stuck `assigned` and not one ticket ever
 * advanced by `decideSignoffGate`.
 *
 * The selector accepts FOUR paths — (1) an explicit `project_role_assignments` pin,
 * (2) `ide_agents.role_keys`, (3) `builtin_kind`, (4) fuzzy title/skill. This gate read
 * only `agentIsRoleCapable`, which covers 2–4. So an agent dispatched as a reviewer
 * BECAUSE it was pinned was then told `403 not authorized to sign off as role '<key>'`
 * when it called `kanban.signoff`. The tool existed, was on the allowlist and was named
 * correctly in the instruction — every attempt was rejected at the door.
 *
 * `agentRoleKeys` makes this unrecoverable rather than merely likely: a row with a
 * `builtin_kind` returns EARLY, deliberately refusing fuzzy widening, and its own
 * comment directs the reader to "grant cross-role capability explicitly through
 * role_keys **or a project role assignment**" — the second of which this function never
 * consulted. The documented escape hatch did not exist.
 *
 * Pass `projectId` wherever it is known so a project-scoped pin resolves; omitting it
 * still honours workspace-wide pins.
 */
export async function isAgentRefRoleCapable(
  db: Db,
  tenantId: number,
  agentRef: string | null | undefined,
  roleKey: string | null | undefined,
  projectId?: number | null,
): Promise<boolean> {
  const nk = (roleKey ?? '').trim();
  if (!nk) return true;
  const ref = (agentRef ?? '').trim();
  if (!ref) return false;
  const row = await loadAgentCapabilityRow(db, tenantId, ref);
  if (row && agentIsRoleCapable(row, nk)) return true;
  // Path 1 — the explicit pin. Checked even when the agent row is missing/unmatched:
  // a deliberate human assignment is the STRONGEST capability signal there is, and it
  // is the selector's highest-precedence path.
  return agentIsRolePinned(db, tenantId, ref, nk, projectId);
}

/** Is a human role-capable of `roleKey`? True when pinned to it (project_role_assignments)
 *  OR their member-profile discipline matches the role's. Empty roleKey ⇒ true. Used for
 *  default-deny RBAC on the sign-off route (managers bypass separately). */
export async function humanIsRoleCapable(db: Db, tenantId: number, userId: string | null | undefined, roleKey: string | null | undefined, projectId?: number | null): Promise<boolean> {
  const nk = (roleKey ?? '').trim();
  if (!nk) return true;
  const uid = (userId ?? '').trim();
  if (!uid) return false;
  const [pin] = await db
    .select({ ref: projectRoleAssignments.assigneeRef })
    .from(projectRoleAssignments)
    .where(and(
      eq(projectRoleAssignments.tenantId, tenantId), eq(projectRoleAssignments.roleKey, nk),
      eq(projectRoleAssignments.assigneeKind, 'human'), eq(projectRoleAssignments.assigneeRef, uid),
      projectId == null ? isNull(projectRoleAssignments.projectId) : or(eq(projectRoleAssignments.projectId, projectId), isNull(projectRoleAssignments.projectId)),
    ))
    .limit(1);
  if (pin) return true;
  const discipline = BUILTIN_ROLES.find((r) => r.key === nk)?.discipline;
  if (!discipline) return true; // custom role with no known discipline ⇒ don't over-restrict
  const [prof] = await db
    .select({ discipline: memberProfiles.discipline })
    .from(memberProfiles)
    .where(and(eq(memberProfiles.tenantId, tenantId), eq(memberProfiles.memberKind, 'human'), eq(memberProfiles.memberRef, uid)))
    .limit(1);
  return prof?.discipline === discipline;
}

/** Resolve a member's display name for the accountability record (never anonymous). */
export async function resolveMemberDisplayName(db: Db, tenantId: number, memberKind: string | null | undefined, memberRef: string | null | undefined): Promise<string | null> {
  const ref = (memberRef ?? '').trim();
  if (!ref) return null;
  if (memberKind === 'agent') {
    const [a] = await db.select({ name: ideAgents.name }).from(ideAgents).where(and(eq(ideAgents.tenantId, tenantId), eq(ideAgents.id, ref))).limit(1);
    return a?.name ?? ref;
  }
  const [u] = await db.select({ displayName: users.displayName, username: users.username, email: users.email }).from(users).where(eq(users.id, ref)).limit(1);
  return u ? (u.displayName || u.username || u.email || ref) : ref;
}

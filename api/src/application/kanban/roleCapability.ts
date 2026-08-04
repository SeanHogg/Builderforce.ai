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
 *
 * Note: 'decision' action type returns undefined because decision-type tasks complete
 * through written decisions rather than code production.
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
    // 'decision' action type: non-coding tasks completed through written decisions
    // (analysis, provisioning, architectural decisions) - no code producer role
    case 'decision':
      return undefined;
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

const rosterKey = (tenantId: number, projectId: number, v: string | number) =>
  `role-roster:tenant:${tenantId}:project:${projectId}:v:${v}`;

/** One agent's pin to a role, as far as capability cares. */
export interface RolePinRow {
  projectId: number | null;
  roleKey: string;
  assigneeRef: string;
  assigneeName: string | null;
}

/**
 * Every capability input for a project, loaded ONCE — the active roster plus the pins
 * that apply to it. Serializable, so it is what the read-through cache stores.
 */
export interface RoleRosterData {
  agents: RoleCapableAgentRow[];
  pins: RolePinRow[];
}

/**
 * THE CAPABILITY ORACLE. Pure, and the only place the precedence is written down.
 *
 * Agents capable of acting AS `roleKey`, strongest claim first:
 *   1) explicit `project_role_assignments` pin (project-specific beats workspace-wide),
 *   2) explicit `ide_agents.role_keys`,
 *   3) `builtin_kind`-derived,
 *   4) fuzzy title/skill fallback.
 *
 * ── WHY IT IS ONE FUNCTION ───────────────────────────────────────────────────────
 * "Can this agent act as role X?" has been answered independently by a GUARD and by a
 * SELECTOR three separate times, and all three times they diverged. The cost, in order:
 * an empty sign-off ledger (0 rows against 1,030 reviewer runs), 405 stalled tickets,
 * then 447. Each was fixed by widening whichever side was narrower, which fixes the
 * instance and preserves the seam.
 *
 * There is now no seam. Both sides resolve through this function — the guard via
 * {@link isAgentRefRoleCapable}, the selector via `bindStaffedAgentsToRoles` — so
 * narrowing one necessarily narrows the other, and `roleCapabilityParity.test.ts`
 * asserts the two agree over the whole role catalog.
 */
export function roleCandidatesFrom(
  data: RoleRosterData,
  projectId: number | null,
  roleKey: string,
): RoleCandidate[] {
  const nk = (roleKey ?? '').trim();
  if (!nk) return [];
  const byId = new Map(data.agents.map((a) => [a.id, a]));
  const out: RoleCandidate[] = [];
  const seen = new Set<string>();

  // 1) explicit pins. A project-specific pin outranks the workspace-wide default.
  const pins = data.pins
    .filter((p) => p.roleKey === nk && (projectId == null ? p.projectId == null : (p.projectId === projectId || p.projectId == null)))
    .sort((a, b) => Number(b.projectId === projectId) - Number(a.projectId === projectId));
  for (const p of pins) {
    if (seen.has(p.assigneeRef)) continue;
    const a = byId.get(p.assigneeRef);
    // A pin naming an agent that is not on the ACTIVE roster resolves to nobody: a
    // retired agent must not keep a stage looking staffed.
    if (!a) continue;
    out.push({ kind: 'agent', ref: p.assigneeRef, name: p.assigneeName ?? a.name ?? p.assigneeRef, via: 'assignment' });
    seen.add(p.assigneeRef);
  }

  // 2–4) capability-derived, tagged by the strongest reason each qualifies.
  for (const a of data.agents) {
    if (seen.has(a.id)) continue;
    const explicit = parseRoleKeys(a.roleKeys).includes(nk);
    const kind = !!a.builtinKind && (BUILTIN_KIND_ROLE_KEYS[a.builtinKind] ?? []).includes(nk);
    const fuzzy = !explicit && !kind && agentIsRoleCapable(a, nk);
    if (!explicit && !kind && !fuzzy) continue;
    out.push({ kind: 'agent', ref: a.id, name: a.name, via: explicit ? 'role-keys' : kind ? 'builtin-kind' : 'agent-skill' });
    seen.add(a.id);
  }
  return out;
}

/**
 * A project's roster, ready to answer capability questions in memory.
 *
 * This is what makes the parity affordable. The selector needs the answer for EVERY
 * authorized role on EVERY lane of a board — resolving each through its own query would
 * be the N+1 the caching rules forbid on a 675-ticket census. One cached load answers
 * all of them.
 */
export interface RoleRoster {
  /** Agents capable of `roleKey`, strongest claim first. */
  candidates(roleKey: string): RoleCandidate[];
}

export function buildRoleRoster(data: RoleRosterData, projectId: number | null): RoleRoster {
  const memo = new Map<string, RoleCandidate[]>();
  return {
    candidates(roleKey) {
      const nk = (roleKey ?? '').trim();
      let hit = memo.get(nk);
      if (!hit) {
        hit = roleCandidatesFrom(data, projectId, nk);
        memo.set(nk, hit);
      }
      return hit;
    },
  };
}

/**
 * The roster for a caller that deliberately does not bind agents.
 *
 * Exported so `roster` can be a REQUIRED parameter everywhere. An optional one is what
 * lets a new call site silently inherit the narrow behaviour this whole module exists to
 * end — the omission is then invisible at the call site and shows up as a stalled board.
 */
export const EMPTY_ROLE_ROSTER: RoleRoster = { candidates: () => [] };

/**
 * Load a project's capability inputs. Cached on the workforce-metrics version token,
 * which bumps whenever agents or role assignments change, so a hire or a pin is visible
 * on the very next resolution.
 *
 * `env` is optional only because two non-Worker callers (unit tests, the execution guard)
 * have none; `getOrSetCached` already contracts "no KV ⇒ straight to the loader".
 */
export async function loadRoleRosterData(
  env: Env | undefined,
  db: Db,
  tenantId: number,
  projectId: number | null,
): Promise<RoleRosterData> {
  const load = async (): Promise<RoleRosterData> => {
    const [agents, pins] = await Promise.all([
      db
        .select({ id: ideAgents.id, name: ideAgents.name, title: ideAgents.title, skills: ideAgents.skills, builtinKind: ideAgents.builtinKind, roleKeys: ideAgents.roleKeys })
        .from(ideAgents)
        .where(and(eq(ideAgents.tenantId, tenantId), eq(ideAgents.status, 'active'))),
      db
        .select({ projectId: projectRoleAssignments.projectId, roleKey: projectRoleAssignments.roleKey, assigneeRef: projectRoleAssignments.assigneeRef, assigneeName: projectRoleAssignments.assigneeName })
        .from(projectRoleAssignments)
        .where(and(
          eq(projectRoleAssignments.tenantId, tenantId),
          eq(projectRoleAssignments.assigneeKind, 'agent'),
          projectId == null
            ? isNull(projectRoleAssignments.projectId)
            : or(eq(projectRoleAssignments.projectId, projectId), isNull(projectRoleAssignments.projectId)),
        )),
    ]);
    return { agents, pins };
  };
  if (!env) return load();
  const version = await readWorkforceMetricsVersion(env, tenantId);
  return getOrSetCached(env, rosterKey(tenantId, projectId ?? 0, version), load);
}

/** {@link loadRoleRosterData}, ready to query. The selector's entry point. */
export async function loadRoleRoster(
  env: Env | undefined,
  db: Db,
  tenantId: number,
  projectId: number | null,
): Promise<RoleRoster> {
  return buildRoleRoster(await loadRoleRosterData(env, db, tenantId, projectId), projectId);
}

/**
 * The agents capable of acting AS `roleKey` for a project, in precedence order.
 * A thin wrapper over the oracle — kept because it reads better at its call sites.
 */
export async function resolveRoleCapableAgents(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  roleKey: string,
): Promise<RoleCandidate[]> {
  return (await loadRoleRoster(env, db, tenantId, projectId)).candidates(roleKey);
}

/**
 * Is the given agent ref capable of `roleKey`? Unknown ref ⇒ not capable (false)
 * when a role is required. Empty roleKey ⇒ true (no constraint).
 *
 * THIS IS THE GATE, and it accepts exactly what the SELECTOR dispatches — not by
 * agreement but by construction: both are `roleCandidatesFrom`, the gate asking whether
 * one ref is in the answer and the selector taking the head of it. There is no second
 * implementation left to drift.
 *
 * That drift is not hypothetical. This gate once read only `agentIsRoleCapable`
 * (role_keys ∪ builtin_kind ∪ fuzzy) while the selector also honoured an explicit
 * `project_role_assignments` pin, so an agent dispatched as a reviewer BECAUSE it was
 * pinned was then told `403 not authorized to sign off as role '<key>'` when it called
 * `kanban.signoff`. Measured: **0 rows in `ticket_role_signoffs` against 1,030 reviewer
 * runs**, 2,288 required slots stuck `assigned`. Widening the gate fixed that instance
 * and left the seam; routing both sides through one oracle removes the seam.
 *
 * Pass `projectId` wherever it is known so a project-scoped pin resolves; omitting it
 * still honours workspace-wide pins. Pass `env` wherever it is available so the roster
 * load is served from the read-through cache.
 */
export async function isAgentRefRoleCapable(
  db: Db,
  tenantId: number,
  agentRef: string | null | undefined,
  roleKey: string | null | undefined,
  projectId?: number | null,
  env?: Env,
): Promise<boolean> {
  const nk = (roleKey ?? '').trim();
  if (!nk) return true;
  const ref = (agentRef ?? '').trim();
  if (!ref) return false;
  const roster = await loadRoleRoster(env, db, tenantId, projectId ?? null);
  return roster.candidates(nk).some((c) => c.ref === ref);
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

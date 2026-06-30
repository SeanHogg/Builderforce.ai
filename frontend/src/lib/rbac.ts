'use client';

import { useOptionalAuth } from './AuthContext';

/**
 * Frontend mirror of the API's tenant RBAC model
 * (api/src/domain/shared/types.ts → TenantRole / ROLE_ORDER / hasMinRole).
 *
 * This is the SINGLE source of truth the whole UI consults to decide who can do
 * what. Consumers never recompute a `canX` boolean — they either call
 * {@link usePermission} or wrap the action in <RoleGate capability="…">, which
 * decides its own state (and, per product rule, DISABLES + indicates the role
 * needed rather than hiding the feature). Keep the capability map in lockstep
 * with the server-side requireRole() gates — the server is the real authority;
 * this layer is the honest UX signal.
 */

export type TenantRole = 'owner' | 'manager' | 'developer' | 'viewer';

// Higher index = more authority. Mirrors ROLE_ORDER on the API.
export const ROLE_ORDER: TenantRole[] = ['viewer', 'developer', 'manager', 'owner'];

export const ROLE_LABEL: Record<TenantRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  developer: 'Developer',
  viewer: 'Viewer',
};

export const ROLE_DESCRIPTION: Record<TenantRole, string> = {
  owner: 'Full control, including billing, API keys, and deleting the workspace.',
  manager: 'Invite people, manage roles & integrations, and see every insight lens.',
  developer: 'Build and run agents, work the board, and see delivery insights.',
  viewer: 'Read-only access to boards, work, and the workforce.',
};

/** Roles a manager/owner may assign through the Members UI (owner is owner-only). */
export const ASSIGNABLE_ROLES: TenantRole[] = ['viewer', 'developer', 'manager', 'owner'];

export function hasMinRole(actual: TenantRole | string | undefined | null, required: TenantRole): boolean {
  if (!actual) return false;
  const i = ROLE_ORDER.indexOf(actual as TenantRole);
  return i >= 0 && i >= ROLE_ORDER.indexOf(required);
}

/**
 * Capability → minimum role. Adding a capability here makes it gateable from
 * anywhere via <RoleGate> / usePermission with zero per-consumer logic.
 */
export const CAPABILITIES = {
  // Workspace & people
  'members.invite':       'manager',
  'members.manageRoles':  'manager',
  'members.remove':       'manager',
  'workspace.rename':     'manager',
  'workspace.delete':     'owner',
  'apiKeys.manage':       'owner',
  'billing.manage':       'manager',
  'integrations.manage':  'manager',

  // Workforce
  'agents.create':        'manager',
  'agents.manage':        'manager',

  // Board governance — override the execution-approval gate (whether high/urgent
  // tickets need manager sign-off before an agent runs them). Mirrors the API's
  // per-field requireRole(MANAGER) check on PATCH /api/boards/:id.
  'board.manageApproval': 'manager',

  // Enterprise insight lenses (the role-based dashboards from the platform
  // assessment). Gating them now means the lens surfaces light up for the right
  // audience the moment each is built — and show "Requires … role" until then.
  'insights.delivery':    'developer', // IC / Tech Lead / EM delivery + personal DORA (also gates SPACE lens)
  'insights.engineering': 'manager',   // CTO: DORA + AI-effectiveness
  'insights.aiImpact':    'manager',   // AI Impact: adoption trends, multi-tool eval, productivity score
  'insights.recommendations': 'manager', // AI-driven prescriptive recommendations + anomalies
  'insights.llmUsage':    'manager',   // LLM usage: token/request totals, model health & spend by source/project/user/team/repo
  'insights.finance':     'manager',   // CFO: FinOps / cost / budgets
  'insights.allocation':  'manager',   // EM / CFO: investment allocation + capex/opex + goals
  'insights.benchmarking': 'manager',  // Industry benchmarking — percentile vs cohort
  'insights.devex':       'manager',   // DevEx surveys & AI DevEx analysis lens
  'insights.portfolio':   'manager',   // PMO / CEO: portfolio rollup + innovation funnel
  'insights.compliance':  'manager',   // CISO: audit / evidence packs

  // Feature pages with their own destinations (manager-gated authoring).
  'devex.manage':         'manager',   // author DevEx survey templates & launch campaigns
  'dashboards.manage':    'manager',   // create/edit custom dashboards & widgets
  'finops.manage':        'manager',   // DevFinOps: R&D credits, SOC controls, audit reports

  // Alerts — threshold alert rules + firings on platform metrics. Manager-gated,
  // mirroring the API's requireRole(MANAGER) on /api/alerts/*.
  'alerts.manage':        'manager',

  // Diagnostics & Tools — the data-driven ("from your data") mode of any tool.
  'tools.runDataDriven':  'manager',   // run/save telemetry-derived tool results

  // Knowledge Management — SOPs, processes & docs. Any member (developer+) can
  // author; per-document edit/publish rights are then governed server-side by
  // ownership + invited collaborators (see knowledgeRoutes resolveAccess).
  // Assigning training and viewing the compliance audit stay manager+. Reading
  // & acknowledging is open to all.
  'knowledge.create':         'developer', // author new documents
  'knowledge.assignTraining': 'manager',   // assign documents as training, view audit

  // Product Quality — error observability. Any member sees the dashboard; managing
  // ingest sources and dispatching agent fixes are manager+ (server-enforced too).
  'quality.view':          'developer', // browse error groups + triage status
  'quality.manageSources': 'manager',   // create/rotate/delete ingest sources
  'quality.fix':           'manager',   // dispatch a cloud agent to fix an error
} as const satisfies Record<string, TenantRole>;

export type Capability = keyof typeof CAPABILITIES;

export function requiredRoleFor(cap: Capability): TenantRole {
  return CAPABILITIES[cap];
}

export interface PermissionResult {
  allowed: boolean;
  role: TenantRole | undefined;
  required: TenantRole;
  requiredLabel: string;
}

/** The current user's role in the active workspace (undefined when unknown or
 *  when rendered outside an AuthProvider — so RoleGate never crashes the tree). */
export function useRole(): TenantRole | undefined {
  const auth = useOptionalAuth();
  const role = auth?.tenant?.role as TenantRole | undefined;
  return role && ROLE_ORDER.includes(role) ? role : undefined;
}

/** Resolve a single capability against the current workspace role. */
export function usePermission(cap: Capability): PermissionResult {
  const role = useRole();
  const required = CAPABILITIES[cap];
  return { allowed: hasMinRole(role, required), role, required, requiredLabel: ROLE_LABEL[required] };
}

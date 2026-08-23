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
  // Per-seat AI spend caps (Teams). Owner-only: it governs how much of the
  // workspace's money each seat may spend. Mirrors requireRole(OWNER) on
  // PATCH /api/tenants/:id/spend-limits (+ the per-seat variant).
  'billing.spendLimits':  'owner',
  'integrations.manage':  'manager',
  // Institutional identity — enterprise SSO connections and LTI 1.3 platform
  // registrations. Mirrors requireRole(MANAGER) on /api/sso-connections and
  // /api/lti-registrations. Manager rather than owner because connecting a
  // university's IdP or LMS is the same class of act as connecting any other
  // external system, and it is already bounded by domain verification on one
  // side and a signed launch on the other.
  'identity.manageProviders': 'manager',

  // Year-end 1099 report: every recipient's legal name, address and tax-id
  // last-four in one file. Manager+, mirroring requireRole(MANAGER) on
  // GET /api/tax/report/:year (+ its CSV). A payee's OWN tax profile has no
  // capability gate — it's self-service, same as any own-account form.
  'tax.viewReport':       'manager',

  // Workforce
  'agents.create':        'manager',
  'agents.manage':        'manager',

  // Starting / cancelling / steering an agent run. Mirrors the API's
  // requireRole(DEVELOPER) on every dispatch-tier route in runtimeRoutes (submit,
  // cancel, messages, state, broadcast, telemetry). DEVELOPER — not manager —
  // because running agents IS the developer's job (see ROLE_DESCRIPTION.developer);
  // the manager control for a run is the SEPARATE governance approval gate, which
  // holds high/urgent tickets for sign-off in /api/approvals. Keeping both at
  // manager would collapse two distinct controls and make the approval queue moot.
  'runtime.execute':      'developer',
  // Workspace-wide emergency execution override. Manager-only because it stops
  // every member's manual runs as well as all autonomous/scheduled dispatch.
  'runtime.control':      'manager',
  // REVERTING a finished run — closing the PR it opened and deleting the branch it
  // wrote. Mirrors requireRole(MANAGER) on POST /api/runtime/executions/:id/revert.
  // Deliberately a tier ABOVE runtime.execute: starting a run is the developer's
  // job, but destroying its output (commits a human may already have reviewed) is
  // a governance action and irreversible.
  'runtime.revert':       'manager',
  // Manage a project's self-learning Evermind model (seed base, flip inference /
  // learning mode). Mirrors the API's requireRole(MANAGER) on the evermind routes.
  'project.manageEvermind': 'manager',

  // AI Manager — configure a project's manager policy (designate the manager,
  // toggle auto-scoring/assign/prioritize, set the PR-merge policy) and trigger a
  // manager run. Mirrors the API's requireRole(MANAGER) on PUT/POST /api/manager.
  'manager.manage':       'manager',

  // Board governance — override the execution-approval gate (whether high/urgent
  // tickets need manager sign-off before an agent runs them). Mirrors the API's
  // per-field requireRole(MANAGER) check on PATCH /api/boards/:id.
  'board.manageApproval': 'manager',

  // The board's COLUMNS — adding, renaming, reordering, merging away a swimlane,
  // and re-homing the tickets left in no column. Mirrors requireRole(DEVELOPER) on
  // the POST/PATCH/DELETE /api/boards/:id/swimlanes routes. DEVELOPER for the same
  // reason `runtime.execute` is: shaping the board you work on is the working
  // team's job, while the governance controls above stay a tier higher. A lane
  // edit re-files every ticket in it, which is why a viewer must not reach it.
  'board.manageLanes':    'developer',

  // Ceremony cadence — create/edit/delete the recurring standup & planning
  // schedules the cron sweep runs. Mirrors the API's requireRole(MANAGER) on the
  // POST/PATCH/DELETE /api/agile/ceremonies/schedules routes (reads are open).
  'ceremonies.manageSchedules': 'manager',

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
  'insights.autonomy':    'manager',   // Autonomy Health: per-origin lifecycle funnel, hop split & stall gates (mirrors requireRole(MANAGER) on /api/insights/autonomy)

  // OKR lineage: linking a ticket/epic/initiative to an objective. Mirrors
  // `requireRole(MANAGER)` on `POST /api/pmo/objectives/:id/links` so the ticket-side
  // picker is disabled — never hidden — for everyone the route would refuse.
  'pmo.objectives.link':  'manager',

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

  // The ATS — applications, the stage board, interview kits, decisions and offers. Any
  // member sees the pipeline; the acts with an external effect on a PERSON (moving them,
  // recording a decision, drafting and sending an offer) are manager+, mirroring the
  // requireRole(DEVELOPER)/requireRole(MANAGER) split on /api/ats.
  'hiring.view':           'developer',
  'hiring.manage':         'manager',

  // FACTS library — structured (subject,predicate,object) knowledge store. Reads
  // open to any member; writes developer+ (mirrors the API requireRole(DEVELOPER)).
  'facts.view':            'viewer',
  'facts.manage':          'developer',

  // RFP / RFQ Response — pre-sales proposal generation. Reads open to any member;
  // creating/generating is developer+ (mirrors the API requireRole(DEVELOPER)).
  'rfp.view':              'viewer',
  'rfp.manage':            'developer',

  // EMP buyer-checklist lenses (manager-gated, mirroring server requireRole(MANAGER)).
  'insights.crossTeam':      'manager', // EMP-5  internal cross-team benchmarking
  'insights.delayTaxonomy':  'manager', // EMP-9  delay root-cause taxonomy
  'insights.pulse':          'manager', // EMP-15 pulse aggregate/admin (submit is any-role)
  'finops.rdReconciliation': 'manager', // R&D derived-vs-reported reconciliation

  // Blended human+agent workforce planning + periodic lens review snapshots.
  'workforce.plan':          'manager',
  'insights.snapshots':      'manager',

  // Governance policy packs — the gates the agent runtime hard-enforces at its
  // tool-call seam. Reads are open to any member (you may see the posture you run
  // under); authoring mirrors the API's requireRole(MANAGER) on every write.
  'policies.manage':         'manager',

  // Learning paths, prerequisites and the workspace's own LRS. Everybody may see
  // the catalogue, their locks and their own progress — that is what a learner
  // comes for. Authoring a curriculum, enrolling somebody else and minting an
  // xAPI credential are manager+, mirroring the requireRole(MANAGER) split on
  // /api/learning.
  'learning.manage':         'manager',
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

/**
 * The current user's ACCOUNT TYPE. Distinct from workspace role: it's a GLOBAL
 * property (a freelancer works across many tenants). 'freelancer' = a restricted
 * gig/for-hire account that sees only the Profile / Find Work / Timecard shell.
 * Undefined outside an AuthProvider so callers never crash the tree.
 */
export function useAccountType(): 'standard' | 'freelancer' | 'sales' | undefined {
  const auth = useOptionalAuth();
  return auth?.user?.accountType;
}

/** True for referral / sales-associate accounts. */
export function useIsSalesAssociate(): boolean {
  return useAccountType() === 'sales';
}

/** True when the signed-in user is a freelancer (restricted gig shell). The ONE
 *  place this branch is decided, so nav/shell/route gating never drift. */
export function useIsFreelancer(): boolean {
  return useAccountType() === 'freelancer';
}

/**
 * True when the signed-in user has opted IN to being hired talent. Independent of
 * account type: a 'standard' builder can turn this on to publish a for-hire profile
 * and pick up gigs while keeping the full builder shell (a dedicated 'freelancer'
 * account is always for-hire). The ONE place this branch is decided, so the for-hire
 * nav destinations + opt-in UI never drift.
 */
export function useAvailableForHire(): boolean {
  const auth = useOptionalAuth();
  return auth?.user?.accountType === 'freelancer' || !!auth?.user?.availableForHire;
}

/**
 * First-party (built-in) MCP server — exposes the platform's OWN capabilities
 * (projects, tasks, …) as MCP tools through the same gateway endpoints that
 * relay external tenant MCP servers (`GET /v1/mcp/tools`, `POST /v1/mcp/call`).
 *
 * Unlike {@link mcpExtensionService} (which proxies a customer's remote server),
 * these tools run IN-PROCESS against the application services, scoped to the
 * caller's tenant. That makes platform actions callable from the browser Brain,
 * external MCP clients, and the agent-runtime alike — the server-side twin of
 * the frontend's `platformActions` manifest.
 *
 * Catalog scope: projects + tasks (CRUD), specs/workflows/prompts/approvals/
 * agents/boards/cron (read or simple CRUD), and the full strategy tier —
 * portfolios, initiatives, OKR objectives + key results + lineage links (CRUD,
 * segment-scoped). The dispatch + advertise wiring is the reusable part; adding a
 * domain is one `CATALOG` entry. Remaining web-Brain domains still to port (so
 * the web Brain can drop its client-side manifest) are tracked in the ROADMAP
 * Consolidated Gap Register.
 */

import { and, eq, desc, sql, type SQL } from 'drizzle-orm';
import { type ToolSchema } from '@builderforce/agent-tools';
import type { Db } from '../../infrastructure/database/connection';
import { ProjectService } from '../project/ProjectService';
import { TaskService } from '../task/TaskService';
import { addManagerDirective } from '../manager/managerDirectives';
import { createManagerCoachingTask, getEffectiveManagerPolicy } from '../manager/ManagerService';
import { resolveManagerAssignee } from '../manager/managerPolicy';
import { TicketParticipantsService } from '../kanban/ticketParticipants';
import { ProjectRepository } from '../../infrastructure/repositories/ProjectRepository';
import { TaskRepository } from '../../infrastructure/repositories/TaskRepository';
import { ProjectStatus, TaskPriority, TaskType, TenantRole } from '../../domain/shared/types';
import { parseJsonObject } from '../../domain/shared/json';
import { signJwt } from '../../infrastructure/auth/JwtService';
import { workflows, workflowDefinitions, specs, promptLibraryEntries, promptLibraryVersions, approvalRules, approvals, brainChats, agents, projectAgents, agentAssignments, savedDashboards, dashboardWidgets, alerts, alertEvents, activityLog, boards, cronJobs, portfolios, initiatives, objectives, objectiveLinks, keyResults, ideAgents, marketplaceSkills, artifactAssignments, socControls, socEvidence, pokerSessions, pokerStories, pokerVotes, retrospectives, retroItems, boardConnections, projectRepositories, pullRequests, chatSessions, chatMessages, swimlanes, swimlaneAgentAssignments, tenants, executions, usageSnapshots, toolAuditEvents, executionMessages, agentHosts, agentHostProjects, errorGroups, roadmapItems, projectRoleAssignments } from '../../infrastructure/database/schema';
import { resolveSegment } from '../../infrastructure/auth/segmentResolver';
import type { McpToolEntry } from './mcpExtensionService';
import type { Env } from '../../env';
import { integrationCredentials } from '../../infrastructure/database/schema';
import { fetchWebDocument } from '../web/webFetch';
import { encryptCredentials } from '../integrations/credentialCrypto';
import { MigrationService, type ImportMode } from '../migration/MigrationService';
import { createMigrationStore } from '../migration/migrationStore';
import { buildMigrationProviderFactory } from '../migration/buildProviderFactory';
import { BOARD_PROVIDERS, DISCOVERY_PROVIDER_IDS } from '../boardsync/providerCatalog';
import { maybeAutoRunOnLaneEntry } from '../../presentation/routes/taskRoutes';
import { evaluateTaskAutoRun, AUTO_RUN_REASON_TEXT, type AutoRunReason } from '../swimlane/evaluateAutoRun';
import { invalidateProjectsList } from '../../presentation/routes/projectRoutes';
import { recordActivity, resolveHumanActor, SYSTEM_ACTOR } from '../activity/activityLog';
import { pmoVersionKey } from '../../presentation/routes/pmoRoutes';
import { bumpCacheVersion, invalidateCached, trackerCacheKey, bumpTicketSearchVersion } from '../../infrastructure/cache/readThroughCache';
import { convertWorkItemType, promoteOrphanOkrEpics, ConvertError, type WorkItemKind } from '../workitem/convertWorkItemType';
import { buildRuntimeService } from '../../buildRuntimeService';
import { ChatTicketService } from '../brain/ChatTicketService';
import { BrainService } from '../brain/BrainService';
import { WorkDeltaService, type DeltaKind } from '../delta/WorkDeltaService';
import { ValidationService, type ReviewVerdict, type ReviewGapInput } from '../validation/ValidationService';
import { publishReviewToPr } from '../validation/publishReviewToPr';
import { SecurityAuditService, type FindingSeverity, type TrustCriterion } from '../security/SecurityAuditService';
import { IncidentService, type IncidentSeverity, type IncidentStatus } from '../incident/IncidentService';
import { OnCallService } from '../incident/OnCallService';
import { EscalationService } from '../incident/EscalationService';
import { recallSops } from '../knowledge/recallSops';
import { publishKnowledgeDoc } from '../knowledge/publishKnowledgeDoc';
import { SecurityTicketAccessService } from '../security/SecurityTicketAccessService';
import { recallProjectFacts, upsertProjectFact } from './projectFacts';
import type { Task } from '../../domain/task/Task';
import {
  amendActiveLegalDoc,
  getActiveLegalDoc,
  getLegalCurrent,
  isLegalDocType,
  publishLegalDoc,
} from '../legal/legalDocsService';
import { resolveIsSuperadmin } from '../../infrastructure/auth/superadminFlag';
import {
  modelPoolForPlan,
  productNameForPlan,
  isPremiumModelSelection,
} from './LlmProxyService';
import { PREMIUM_REQUEST_SURCHARGE_MILLICENTS } from './usageLedger';
import { catalogEntry, tierForModel, vendorForModel } from './vendors';
import { evaluatePremiumModelAccess } from '../../domain/tenant/planFeatures';
import { TenantPlan } from '../../domain/shared/types';

/** Sentinel extensionId the gateway routes to this in-process catalog. */
export const BUILTIN_EXTENSION_ID = 'builtin';

/** Map the gateway's string effectivePlan onto the plan enum the pure entitlement
 *  evaluators take. (The gateway speaks 'free'|'pro'|'teams'; the domain speaks the
 *  enum.) */
function toTenantPlanEnum(ep: 'free' | 'pro' | 'teams'): TenantPlan {
  if (ep === 'pro') return TenantPlan.PRO;
  if (ep === 'teams') return TenantPlan.TEAMS;
  return TenantPlan.FREE;
}

type Json = Record<string, unknown>;

interface BuiltinCtx {
  db: Db;
  tenantId: number;
  projects: ProjectService;
  tasks: TaskService;
  /** Worker env — present when the caller threads it (needed by tools that
   *  decrypt integration credentials / reach external providers, e.g. migration). */
  env?: Env;
  /** Authed user id (createdBy on migration runs), when known. */
  userId?: string | null;
  /** The caller's role — used to mint a replay JWT for gateway-key callers. */
  role?: TenantRole;
  /** The caller's raw Bearer token — forwarded on route replay when it's a JWT
   *  (a real user) so the replayed route runs with the caller's exact identity. */
  authToken?: string | null;
  /** The request's ExecutionContext — passed to `app.request` so replayed routes'
   *  `waitUntil` side-effects don't throw. */
  executionCtx?: ExecutionContext;
}

/** Best-effort invalidation after a strategy write (portfolio / initiative /
 *  objective / key-result). Bumps BOTH caches these rows feed:
 *   - the tenant PMO version token → orphans the (version-keyed) `pmo.tree` +
 *     `pmo.rollup` caches, so a structure/OKR change is visible on the next read
 *     (without this, an MCP-created portfolio never appeared in the tree — its
 *     cache is version-keyed with no TTL, and only the HTTP CRUD path bumped it);
 *   - the projects-list cache the Project 360 reads (linked-goal count / Direction).
 *  No-op when the caller didn't thread the Worker env. */
async function bumpPmo(ctx: BuiltinCtx): Promise<void> {
  if (!ctx.env) return;
  await bumpCacheVersion(ctx.env, pmoVersionKey(ctx.tenantId)).catch(() => {});
  await invalidateProjectsList(ctx.env, ctx.tenantId).catch(() => {});
}

/** Guard a legal-document WRITE: the rows are platform-global, so only a verified
 *  platform superadmin may change them (a tenant-scoped caller must not be able to
 *  rewrite every tenant's Terms/Privacy). Reads stay open (public info). */
async function assertLegalWrite(ctx: BuiltinCtx): Promise<void> {
  if (!ctx.env) throw new Error('Legal documents can only be changed with the platform environment available.');
  const ok = await resolveIsSuperadmin(ctx.env, ctx.userId);
  if (!ok) throw new Error('Legal documents are platform-global — only a platform superadmin may change them.');
}

/** Invalidate the roadmap tracker cache (the portfolio `:all` key + the row's project
 *  key) so a Brain-driven roadmap write is visible on the next /api/product/roadmap
 *  read — the SAME keys segmentTrackerRoutes caches (via trackerCacheKey). No-op when
 *  the caller didn't thread the Worker env. */
async function invalidateRoadmap(ctx: BuiltinCtx, segmentId: string, projectId: number | null): Promise<void> {
  if (!ctx.env) return;
  await invalidateCached(ctx.env, trackerCacheKey('roadmap', ctx.tenantId, segmentId)).catch(() => {});
  if (projectId != null) {
    await invalidateCached(ctx.env, trackerCacheKey('roadmap', ctx.tenantId, segmentId, projectId)).catch(() => {});
  }
  // Roadmap items are a link-picker ticket kind — refresh its typeahead cache.
  await bumpTicketSearchVersion(ctx.env, ctx.tenantId);
}

/**
 * Run a platform action by REPLAYING the real `/api/*` route in-process (reuses
 * its logic AND its role-gate authz — the single source of truth). Forwards the
 * caller's JWT when present (real-user identity/role/segment); mints a short-lived
 * tenant JWT for gateway-key callers (bfk_/bfa_). Used for the heavy/computed/auth
 * tail that isn't a simple table op (executions dispatch, decks, analytics, …).
 */
async function replayRoute(
  ctx: BuiltinCtx,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: Json,
  /** Send `body.text` as a raw text/plain body instead of JSON (e.g. project file
   *  contents, whose route reads `c.req.text()`). */
  opts?: { rawText?: string },
): Promise<unknown> {
  if (!ctx.env) throw new Error('route replay unavailable in this context');
  // Dynamic import avoids a static import cycle (index → routes → this module).
  const { buildApp } = await import('../../index');
  const app = buildApp(ctx.env);
  const tok = ctx.authToken ?? '';
  const isGatewayKey = /^(bfk_|bfa_|clk_)/.test(tok);
  const bearer = tok && !isGatewayKey
    ? tok
    : await signJwt(
        { sub: ctx.userId && !isGatewayKey ? ctx.userId : 'agentHost:mcp', tid: ctx.tenantId, role: ctx.role ?? TenantRole.DEVELOPER },
        ctx.env.JWT_SECRET,
      );
  const headers: Record<string, string> = { authorization: `Bearer ${bearer}` };
  const rawText = opts?.rawText;
  if (rawText !== undefined) headers['content-type'] = 'text/plain';
  else if (body !== undefined) headers['content-type'] = 'application/json';
  const req = new Request(`https://internal${path}`, {
    method,
    headers,
    body: rawText !== undefined ? rawText : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const noopCtx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
  const res = await app.request(req, {}, ctx.env, ctx.executionCtx ?? noopCtx);
  const text = await res.text();
  let parsed: unknown;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!res.ok) {
    const detail = typeof parsed === 'object' && parsed ? JSON.stringify(parsed) : String(parsed);
    throw new Error(`${method} ${path} → ${res.status} ${detail}`.slice(0, 400));
  }
  return parsed;
}

interface BuiltinTool {
  /** `<domain>.<method>` — the relay name passed back on /v1/mcp/call. */
  tool: string;
  description: string;
  parameters: Json;
  /** Whether the tool changes state (parity with the frontend manifest). */
  mutates: boolean;
  run: (ctx: BuiltinCtx, args: Json) => Promise<unknown>;
}

// --- tiny JSON-schema helpers ----------------------------------------------
const S = { type: 'string' } as const;
const N = { type: 'number' } as const;
const B = { type: 'boolean' } as const;
const obj = (properties: Json, required: string[] = []): Json => ({ type: 'object', properties, required });
const num = (v: unknown): number => Number(v);
const str = (v: unknown): string => String(v ?? '');
/** Coerce an ISO date string arg to a Date for a timestamp column (undefined when absent/invalid). */
const dt = (v: unknown): Date | undefined => {
  if (v == null || str(v) === '') return undefined;
  const d = new Date(str(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
};
/** Parse the `tenants.settings` JSON-as-text blob into a mutable object (embed lives at .embed). */
const parseTenantSettings = (raw: string | null | undefined): Json => parseJsonObject<Json>(raw);

/** Normalize a title for idempotent-create dedup: whitespace-collapsed, trimmed, lowercased. */
const normTitle = (v: unknown): string => str(v).replace(/\s+/g, ' ').trim().toLowerCase();

/** True when an uploads R2 key belongs to this tenant. Upload keys are minted as
 *  `${tenantId}/${userId}/${file}` (see brainRoutes `/uploads`), so the leading path
 *  segment is the owning tenant; also rejects traversal. Mirrors the route's own
 *  `isKeyOwnedByTenant` so the attachment tools can't read/write across tenants. */
const keyOwnedByTenant = (key: string, tenantId: number): boolean =>
  typeof key === 'string' && key.length > 0 && !key.includes('..') && key.split('/')[0] === String(tenantId);

// ---------------------------------------------------------------------------
// List projections — keep the Brain's context window bounded
// ---------------------------------------------------------------------------
//
// The Brain re-sends its whole transcript to the model every turn, so an
// unbounded `*.list` result (e.g. `tasks.list` returning 352 full rows, every
// column, tens of KB) accumulates across tool calls and eventually exhausts the
// model's context window — the run "dies after several executions". These tools
// therefore return a COMPACT projection + a `total`/`truncated` envelope so the
// model knows to narrow its query; full per-record detail stays available via
// the matching `*.get` tool.

/** Default page size for a list tool, and the hard ceiling a caller can request. */
const LIST_DEFAULT_LIMIT = 50;
const LIST_MAX_LIMIT = 200;
/** Clamp a caller-supplied `limit` into `[1, LIST_MAX_LIMIT]`, defaulting when absent. */
const clampLimit = (v: unknown): number =>
  Math.max(1, Math.min(v != null ? num(v) : LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT));

/** A bounded, single-line description hint — never the full (often huge) blob. */
const snippet = (d: unknown, n = 160): string | undefined => {
  if (typeof d !== 'string' || !d) return undefined;
  const one = d.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
};

/**
 * Project a full task row to the fields an orchestrator actually needs to plan
 * and route work. Drops the heavy/rarely-needed columns (full description,
 * git branch/PR, review + business-value metadata, timestamps) — fetch those
 * per-task with `tasks.get`.
 */
const TASK_LIST_FIELDS = [
  'id', 'projectId', 'key', 'title', 'status', 'priority', 'taskType',
  'parentTaskId', 'assignedUserId', 'assignedAgentRef', 'assignedAgentHostId',
  'storyPoints', 'dueDate', 'archived',
  // Present + true on a SECURITY ticket masked for a viewer without clearance.
  'restricted',
] as const;
function compactTask(plain: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of TASK_LIST_FIELDS) if (plain[f] !== undefined) out[f] = plain[f];
  const s = snippet(plain.description);
  if (s) out.descriptionSnippet = s;
  return out;
}

/** Project a full project row to the identity + status fields a planner needs. */
const PROJECT_LIST_FIELDS = ['id', 'key', 'name', 'status', 'modality', 'template'] as const;
function compactProject(plain: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of PROJECT_LIST_FIELDS) if (plain[f] !== undefined) out[f] = plain[f];
  const s = snippet(plain.description);
  if (s) out.descriptionSnippet = s;
  return out;
}

/** Project a full spec/PRD row to identity + status, dropping the huge `prd` /
 *  `archSpec` / `taskList` bodies (a single PRD can be tens of KB — listing 200 of
 *  them in full is what blew the Brain's context window). The model gets the goal +
 *  a short PRD snippet here and reads the full document with specs.get on demand. */
const SPEC_LIST_FIELDS = ['id', 'projectId', 'goal', 'status', 'kind', 'createdAt', 'updatedAt'] as const;
function compactSpec(plain: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of SPEC_LIST_FIELDS) if (plain[f] !== undefined) out[f] = plain[f];
  const s = snippet(plain.prd);
  if (s) out.prdSnippet = s;
  return out;
}

/** Project a workflow-definition row to identity fields, dropping the serialized
 *  `definition` graph JSON (unbounded — nodes+edges of a visual workflow). The model
 *  reads the full graph with workflow_definitions.get when it actually needs it. */
const WORKFLOW_DEF_LIST_FIELDS = ['id', 'name', 'projectId', 'runTargetRuntime', 'executionScope', 'createdAt', 'updatedAt'] as const;
function compactWorkflowDef(plain: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of WORKFLOW_DEF_LIST_FIELDS) if (plain[f] !== undefined) out[f] = plain[f];
  const s = snippet(plain.description);
  if (s) out.descriptionSnippet = s;
  return out;
}

/** Wrap a projected page in the standard `{ items, total, returned, truncated }`
 *  envelope so the model can see there's more and re-query with a tighter filter. */
function listEnvelope<T>(key: string, all: T[], limit: number): Record<string, unknown> {
  const page = all.slice(0, limit);
  return { [key]: page, total: all.length, returned: page.length, truncated: all.length > page.length };
}

// Strategy-tier + library list projections — same "identity/status + a description
// snippet, drop the heavy body" rule as the compactors above, so listing 200+ of them
// stays inside the Brain's context budget. Full detail is one `*.get` away.
const WORKFLOW_LIST_FIELDS = ['id', 'projectId', 'workflowDefinitionId', 'workflowType', 'status', 'runtime', 'createdAt', 'completedAt', 'updatedAt'] as const;
const PORTFOLIO_LIST_FIELDS = ['id', 'name', 'status', 'ownerUserId', 'targetDate', 'costClass', 'updatedAt'] as const;
const INITIATIVE_LIST_FIELDS = ['id', 'portfolioId', 'name', 'status', 'ownerUserId', 'startDate', 'targetDate', 'costClass', 'updatedAt'] as const;
const OBJECTIVE_LIST_FIELDS = ['id', 'portfolioId', 'initiativeId', 'projectId', 'title', 'status', 'period', 'startDate', 'endDate', 'ownerUserId', 'updatedAt'] as const;
const KEY_RESULT_LIST_FIELDS = ['id', 'objectiveId', 'title', 'metricType', 'currentValue', 'targetValue', 'unit', 'status'] as const;
const PROMPT_LIST_FIELDS = ['id', 'slug', 'title', 'category', 'visibility', 'authorName', 'currentVersion', 'usageCount', 'starCount', 'isFeatured', 'updatedAt'] as const;

/** Project `fields` off a plain row, and (when `descFrom` is set) attach a bounded
 *  description snippet from that column. The shared body of the six compactors below. */
function compactRow(plain: Record<string, unknown>, fields: readonly string[], descFrom?: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) if (plain[f] !== undefined) out[f] = plain[f];
  if (descFrom) { const s = snippet(plain[descFrom]); if (s) out.descriptionSnippet = s; }
  return out;
}

/** Roll a per-model status array (from LlmProxyService.status()) into vendor counts +
 *  only the actionable (unavailable / cooling-down) models by name. The full ~40-entry
 *  array is what bloats a diagnostic tool result in the run trace — it stays behind
 *  `verbose:true`. */
function summarizeModelStatuses(arr: Array<Record<string, unknown>>): Record<string, unknown> {
  const byVendor: Record<string, { total: number; available: number; keyBound: number }> = {};
  let available = 0, keyBound = 0;
  for (const m of arr) {
    const v = String(m.vendor ?? 'unknown');
    const b = (byVendor[v] ??= { total: 0, available: 0, keyBound: 0 });
    b.total++;
    if (m.available) { b.available++; available++; }
    if (m.keyBound) { b.keyBound++; keyBound++; }
  }
  return {
    total: arr.length, available, keyBound, byVendor,
    cooldowns: arr.filter((m) => m.available !== true || m.cooldownUntil != null)
      .map((m) => ({ model: m.model, vendor: m.vendor, cooldownUntil: m.cooldownUntil ?? null })),
  };
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

const CATALOG: BuiltinTool[] = [
  // ---- Session ----
  {
    tool: 'session.current_model', mutates: false,
    description:
      'Report which LLM model is serving this conversation — id, vendor, tier, label, the plan/product billing it, and whether it is a PREMIUM (any-paid-OpenRouter) selection carrying the flat per-request surcharge. '
      + 'Call this to answer "what model are you running on?" / "what model was used?". '
      + 'The caller normally supplies `model` (the id it observed on the turn, from the x-builderforce-model response header) — then the answer is exact. '
      + 'With no `model` the gateway auto-selects per turn, so this reports the plan default instead and says so via `source`.',
    parameters: obj({ model: S }),
    run: async (ctx, a) => {
      if (!ctx.env) throw new Error('Model info requires the platform environment.');
      // Dynamic import: `llmRoutes` imports THIS module, so a static import would be a
      // cycle. Same escape hatch `replayRoute` uses.
      const { resolveTenantPlan } = await import('../../presentation/routes/llmRoutes');
      const access = await resolveTenantPlan(ctx.env, ctx.tenantId);

      const observed = str(a.model).trim();
      // With no observed id, report what the plan would resolve to. This is the plan's
      // pool leader, NOT a promise: auto-select re-decides per turn (a connected BYO
      // account or the learned reorder can lead), which `source` makes explicit.
      const planPool = modelPoolForPlan(access.effectivePlan, access.premiumOverride);
      const model = observed || planPool[0] || '';
      if (!model) return { model: null, source: 'unknown', plan: access.effectivePlan };

      const entry = catalogEntry(model);
      const premiumSelection = isPremiumModelSelection(model, access.effectivePlan, access.premiumOverride);
      const premiumAccess = evaluatePremiumModelAccess({
        effectivePlan: toTenantPlanEnum(access.effectivePlan),
        premiumOverride: access.premiumOverride,
        isSuperadmin: await resolveIsSuperadmin(ctx.env, ctx.userId),
        cardValidated: access.cardValidated,
      });

      return {
        model,
        // 'observed' → the id that actually served the turn (exact).
        // 'plan_default' → nothing observed was supplied; the gateway auto-selects per
        //   turn, so this is the plan's leading model, not necessarily what ran.
        source: observed ? 'observed' : 'plan_default',
        vendor: vendorForModel(model),
        tier: tierForModel(model),
        label: entry?.label ?? null,
        brand: entry?.brand ?? null,
        contextWindow: entry?.contextWindow ?? null,
        plan: access.effectivePlan,
        product: productNameForPlan(access.effectivePlan, access.premiumOverride),
        inPlanPool: planPool.includes(model),
        premiumSelection,
        ...(premiumSelection ? { premiumSurchargeMillicents: PREMIUM_REQUEST_SURCHARGE_MILLICENTS } : {}),
        premiumAccess: { entitled: premiumAccess.entitled, reason: premiumAccess.reason, ...(premiumAccess.unlock ? { unlock: premiumAccess.unlock } : {}) },
      };
    },
  },
  // ---- Projects ----
  {
    tool: 'projects.list', mutates: false,
    description: 'List projects (compact: id/key/name/status/modality + a short description snippet), capped by limit (default 50, max 200). Use projects.get for one project\'s full detail.',
    parameters: obj({ limit: N }),
    run: async (ctx, a) => {
      const rows = (await ctx.projects.listProjects(ctx.tenantId)).map((p) => compactProject(p.toPlain() as unknown as Record<string, unknown>));
      return listEnvelope('projects', rows, clampLimit(a.limit));
    },
  },
  { tool: 'projects.get', mutates: false, description: 'Get one project by id.', parameters: obj({ id: N }, ['id']), run: (ctx, a) => ctx.projects.getProject(num(a.id), ctx.tenantId).then((p) => p.toPlain()) },
  {
    tool: 'projects.create', mutates: true,
    description: 'Create a new project. modality: designer (app builder) | mobile (phone app) | video | llm.',
    parameters: obj({ name: S, description: S, template: S, modality: { type: 'string', enum: ['designer', 'mobile', 'video', 'llm'] } }, ['name']),
    run: async (ctx, a) => {
      const name = str(a.name).trim();
      if (!name) throw new Error('name is required');
      const p = await ctx.projects.createProject({
        tenantId: ctx.tenantId,
        key: await ctx.projects.buildUniqueKey(ctx.tenantId, name),
        name,
        description: a.description != null ? str(a.description) : null,
        template: a.template != null ? str(a.template) : null,
        modality: a.modality != null ? str(a.modality) : null,
      });
      return p.toPlain();
    },
  },
  {
    tool: 'projects.update', mutates: true,
    description: "Update a project's name/description/status/modality.",
    parameters: obj({ id: N, name: S, description: S, status: S, modality: S }, ['id']),
    run: (ctx, a) => ctx.projects.updateProject(num(a.id), {
      name: a.name != null ? str(a.name) : undefined,
      description: a.description != null ? str(a.description) : undefined,
      status: a.status != null ? (str(a.status) as ProjectStatus) : undefined,
      modality: a.modality != null ? str(a.modality) : undefined,
    }, ctx.tenantId).then((p) => p.toPlain()),
  },
  { tool: 'projects.delete', mutates: true, description: 'Delete a project permanently.', parameters: obj({ id: N }, ['id']), run: (ctx, a) => ctx.projects.deleteProject(num(a.id), ctx.tenantId).then(() => ({ deleted: num(a.id) })) },

  // ---- Project memory (shared write-through facts, migration 0276) ----
  // The SAME store VS Code, on-prem, and cloud runs read/write, so a belief one
  // surface forms is recalled by all others on the project.
  {
    tool: 'project_facts.recall', mutates: false,
    description: 'Recall durable facts remembered for a project — the shared memory every agent (cloud/on-prem/editor) reads. Optionally rank by a query.',
    parameters: obj({ projectId: N, query: S, limit: N }, ['projectId']),
    run: async (ctx, a) => {
      if (!ctx.env) throw new Error('project memory unavailable');
      const facts = await recallProjectFacts(ctx.env, ctx.db, ctx.tenantId, num(a.projectId), {
        ...(a.query != null ? { query: str(a.query) } : {}),
        ...(a.limit != null ? { limit: num(a.limit) } : {}),
      });
      return { facts };
    },
  },
  {
    tool: 'project_facts.remember', mutates: false,
    description: 'Remember a durable fact about a project under a STABLE key (write-through: a new fact for the same key REPLACES the old one, never duplicates). Shared with every agent on the project — use for decisions, conventions, and locations worth recalling across runs and surfaces.',
    parameters: obj({ projectId: N, key: S, content: S }, ['projectId', 'key', 'content']),
    run: async (ctx, a) => {
      if (!ctx.env) throw new Error('project memory unavailable');
      const ok = await upsertProjectFact(ctx.env, ctx.db, ctx.tenantId, num(a.projectId), str(a.key), str(a.content), 'brain');
      return { ok, key: str(a.key) };
    },
  },

  // ---- Team Chat (the always-there group chat, migration 0294) ----
  // The ONE conversation the whole team shares — humans AND agents post into it.
  // A PM/manager agent uses team_chat.post to ask the team for status updates or to
  // share a burndown, and team_chat.read to catch up on what the team has said.
  // Scope: pass projectId for that project's team chat, teamId for a named workforce
  // team's chat, or omit both for the tenant-wide "broader team" chat. Everyone lands
  // in the SAME thread (idempotent get-or-create).
  {
    tool: 'team_chat.read', mutates: false,
    description: 'Read the recent transcript of the team chat — the shared group conversation for a team. Scope it: pass projectId for that project\'s team chat, teamId for a named workforce team\'s chat, or omit both for the tenant-wide "broader team" chat. Returns { chatId, messages } (oldest→newest), capped by limit (default 30, max 100).',
    parameters: obj({ projectId: N, teamId: N, limit: N }),
    run: async (ctx, a) => {
      const svc = new BrainService(ctx.db);
      const res = await svc.readTeamChat(
        ctx.tenantId,
        { projectId: a.projectId != null ? num(a.projectId) : null, teamId: a.teamId != null ? num(a.teamId) : null },
        a.limit != null ? num(a.limit) : 30,
      );
      if ('error' in res) throw new Error(res.error);
      return res;
    },
  },
  {
    tool: 'team_chat.post', mutates: true,
    description: 'Post a message INTO the team chat so the whole team sees it — e.g. ask everyone for a status update on their tickets, or share a burndown / summary. Scope it: pass projectId for that project\'s team chat, teamId for a named workforce team\'s chat, or omit both for the tenant-wide "broader team" chat. `fromName` is your display name (e.g. "Project Manager") for attribution. Returns { chatId, message }.',
    parameters: obj({ message: S, projectId: N, teamId: N, fromName: S }, ['message']),
    run: async (ctx, a) => {
      const svc = new BrainService(ctx.db);
      const res = await svc.postToTeamChat(
        ctx.tenantId,
        { projectId: a.projectId != null ? num(a.projectId) : null, teamId: a.teamId != null ? num(a.teamId) : null },
        str(a.message),
        { fromName: a.fromName != null ? str(a.fromName) : undefined, fromRef: ctx.userId ?? undefined },
      );
      if ('error' in res) throw new Error(res.error);
      return res;
    },
  },

  // ---- Attachments (files the user uploaded into the chat) ----
  // A Brain upload lives in R2 read-only-by-signature; before these tools there
  // was NO way to write one back, so a model asked to "update the attached file"
  // could only hallucinate success. attachments.write is the real persistence
  // path; attachments.read paginates so a large doc no longer reports "too large".
  {
    tool: 'attachments.read', mutates: false,
    description: 'Read the text of a file the user ATTACHED to this chat (a Brain upload — e.g. a roadmap/spec .md, .txt, .csv, .json). `key` is the path AFTER `/uploads/` in the attachment URL (e.g. "12/ab.../1699-x.md"). Large files are paginated: `offset` is a character index (default 0), `limit` caps returned chars (default 20000, max 100000). Returns { key, content, offset, returned, total, truncated }; when `truncated`, call again with offset = offset + returned. Use this to actually READ an attachment instead of guessing — including when a direct fetch reported the file "too large".',
    parameters: obj({ key: S, offset: N, limit: N }, ['key']),
    run: async (ctx, a) => {
      const uploads = ctx.env?.UPLOADS;
      if (!uploads) throw new Error('file storage unavailable in this context');
      const key = str(a.key);
      if (!keyOwnedByTenant(key, ctx.tenantId)) throw new Error('attachment not found');
      const object = await uploads.get(key);
      if (!object) throw new Error('attachment not found');
      const full = await object.text();
      const offset = Math.max(0, a.offset != null ? num(a.offset) : 0);
      const limit = Math.max(1, Math.min(a.limit != null ? num(a.limit) : 20000, 100000));
      const content = full.slice(offset, offset + limit);
      return { key, content, offset, returned: content.length, total: full.length, truncated: offset + content.length < full.length };
    },
  },
  {
    tool: 'attachments.write', mutates: true,
    description: 'Overwrite the text of an attached file (Brain upload) IN PLACE — e.g. to write traceability IDs back into a roadmap the user attached. `key` is the path after `/uploads/` in the attachment URL; `content` is the FULL new document (this REPLACES the file — it is NOT a patch, so read it first with attachments.read, edit the whole thing in memory, then write it all back). Text files only. Returns { key, size, updated }. This is the ONLY way to persist a change to an attached file — there is no other "save" / "update the file" path for an upload, so never tell the user you saved or updated an attachment unless an attachments.write call has actually succeeded.',
    parameters: obj({ key: S, content: S }, ['key', 'content']),
    run: async (ctx, a) => {
      const uploads = ctx.env?.UPLOADS;
      if (!uploads) throw new Error('file storage unavailable in this context');
      const key = str(a.key);
      if (!keyOwnedByTenant(key, ctx.tenantId)) throw new Error('attachment not found');
      // head() both proves the object exists (no create-by-write of a foreign key)
      // and lets us preserve its content-type + custom metadata across the overwrite.
      const head = await uploads.head(key);
      if (!head) throw new Error('attachment not found');
      const content = str(a.content);
      await uploads.put(key, content, {
        httpMetadata: { contentType: head.httpMetadata?.contentType ?? 'text/plain; charset=utf-8' },
        customMetadata: head.customMetadata,
      });
      return { key, size: content.length, updated: true };
    },
  },

  // ---- Tasks ----
  {
    tool: 'tasks.list', mutates: false,
    description: 'List tasks as a COMPACT projection (id/key/title/status/priority/type/parent/assignee/points/dueDate + a short description snippet). Filter by projectId and/or status; capped by limit (default 50, max 200). The result is { tasks, total, returned, truncated } — when truncated, narrow with projectId/status/limit. Use tasks.get for one task\'s full description and detail.',
    parameters: obj({ projectId: N, status: S, limit: N }),
    run: async (ctx, a) => {
      const all = await ctx.tasks.listTasks(ctx.tenantId, a.projectId != null ? num(a.projectId) : undefined);
      const status = a.status != null ? str(a.status) : undefined;
      let rows = all.map((t) => t.toPlain() as unknown as Record<string, unknown>);
      if (status) rows = rows.filter((r) => r.status === status);
      // SECURITY tickets are included but MASKED for a caller without clearance
      // (surfaced-not-hidden; governed by security_ticket_access).
      rows = await maskSecurityTasks(ctx, rows);
      return listEnvelope('tasks', rows.map(compactTask), clampLimit(a.limit));
    },
  },
  { tool: 'tasks.get', mutates: false, description: 'Get a task by id.', parameters: obj({ id: N }, ['id']), run: async (ctx, a) => {
    const plain = (await getTenantTask(ctx, num(a.id))).toPlain() as unknown as Record<string, unknown>;
    // A SECURITY ticket is returned MASKED (restricted: true) for a caller without
    // clearance — surfaced, not hidden. Same shared gate as the board.
    const [masked] = await maskSecurityTasks(ctx, [plain]);
    return masked ?? plain;
  } },
  {
    tool: 'tasks.create', mutates: true,
    description: 'Create an ACCOUNTABLE ticket on a project board. The assignee is the ticket Coordinator/Manager (not necessarily its producer): pass exactly one of assignedUserId, assignedAgentRef, or assignedAgentHostId. If omitted, the project Delivery Manager is assigned, falling back to the requesting human. Creation also derives the board process-template participation manifest. AFTER creation, scope the required workforce with kanban.assess_resource for every role implied by the work, inspect kanban.accountability, and use kanban.materialize_work_items to create one child task per resource. Set taskType="epic" for a planning Epic, "gap" for missing follow-up work, or parentTaskId to nest under an Epic. An Epic is not an OKR. Idempotent by project + normalized title; reconciliation also repairs missing coordination/manifest data on the existing ticket. The result carries `autoRun: { dispatched, reason, detail }` when the created ticket landed in a lane that could start work — `dispatched:false` means no agent picked it up, so relay `detail` rather than implying work started.',
    parameters: obj({ projectId: N, title: S, description: S, priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] }, dueDate: S, taskType: { type: 'string', enum: ['task', 'epic', 'gap'] }, parentTaskId: N, assignedUserId: S, assignedAgentRef: S, assignedAgentHostId: N }, ['projectId', 'title']),
    run: async (ctx, a) => {
      const title = str(a.title).trim(); if (!title) throw new Error('title is required');
      const projectId = num(a.projectId);
      // Idempotent create: a task with this title already on the board is returned
      // (flagged `deduped`) rather than duplicated — the caller (e.g. the Brain
      // reconciling a roadmap, often across retries) gets the existing id back.
      const existingTasks = (await ctx.tasks.listTasks(ctx.tenantId, projectId)) ?? [];
      const dupeTask = existingTasks.find((t) => normTitle((t.toPlain() as { title?: unknown }).title) === normTitle(title));
      const explicitAssignee = {
        assignedUserId: a.assignedUserId != null ? str(a.assignedUserId) : null,
        assignedAgentRef: a.assignedAgentRef != null ? str(a.assignedAgentRef) : null,
        assignedAgentHostId: a.assignedAgentHostId != null ? num(a.assignedAgentHostId) : null,
      };
      if ([explicitAssignee.assignedUserId, explicitAssignee.assignedAgentRef, explicitAssignee.assignedAgentHostId].filter((v) => v != null).length > 1) {
        throw new Error('A ticket must have exactly one Coordinator; pass only one assignee field.');
      }
      const hasExplicitAssignee = Object.values(explicitAssignee).some((v) => v != null);
      const policyAssignee = hasExplicitAssignee
        ? { assignedUserId: null, assignedAgentRef: null, assignedAgentHostId: null }
        : resolveManagerAssignee((await getEffectiveManagerPolicy(ctx.db, ctx.tenantId, projectId)).managerRef);
      const coordinator = hasExplicitAssignee
        ? explicitAssignee
        : Object.values(policyAssignee).some((v) => v != null)
          ? policyAssignee
          : { assignedUserId: ctx.userId ?? null, assignedAgentRef: null, assignedAgentHostId: null };
      if (!Object.values(coordinator).some((v) => v != null)) {
        throw new Error('Every ticket requires a Coordinator. Configure a project Delivery Manager or pass an assignee returned by tasks.assignees.');
      }
      if (dupeTask) {
        let reconciled = dupeTask;
        const plain = dupeTask.toPlain();
        if (!plain.assignedUserId && !plain.assignedAgentRef && plain.assignedAgentHostId == null) {
          reconciled = await ctx.tasks.updateTask(Number(plain.id), coordinator);
        }
        if (ctx.env) await new TicketParticipantsService(ctx.db).deriveManifest(ctx.env, ctx.tenantId, Number(plain.id));
        return { deduped: true, ...(reconciled.toPlain() as object) };
      }
      const created = await ctx.tasks.createTask({
        projectId,
        title,
        description: a.description != null ? str(a.description) : null,
        priority: a.priority != null ? (str(a.priority) as TaskPriority) : undefined,
        dueDate: a.dueDate != null ? str(a.dueDate) : null,
        taskType: a.taskType != null ? (str(a.taskType) as TaskType) : undefined,
        parentTaskId: a.parentTaskId != null ? num(a.parentTaskId) : undefined,
        ...coordinator,
      }, ctx.tenantId);
      if (ctx.env) await new TicketParticipantsService(ctx.db).deriveManifest(ctx.env, ctx.tenantId, Number(created.id));
      // A ticket created straight into a staffed lane auto-runs, same as the board's
      // POST path (a create lands in the Backlog lane — fires only if that lane is staffed).
      const autoRun = await fireLaneAutoRun(ctx, created);
      return { ...(created.toPlain() as object), ...(autoRun ? { autoRun } : {}) };
    },
  },
  {
    tool: 'tasks.update', mutates: true,
    description: 'Update a task (title, description, status/lane, priority, dueDate, archived). Reclassify with taskType, re-parent under an Epic with parentTaskId (null to detach), or (re)assign via exactly one of assignedUserId/assignedAgentRef/assignedAgentHostId (null unassigns). Omitted fields are left untouched. When a lane move or a (re)assignment could start work, the result carries `autoRun: { dispatched, reason, detail, agentRef, runNowCandidate? }` — the autonomy verdict. ALWAYS read it: `dispatched:false` means NO agent started, so report `detail` to the user instead of claiming work has begun.',
    parameters: obj({ id: N, title: S, description: S, status: S, priority: S, dueDate: S, archived: B, taskType: { type: 'string', enum: ['task', 'epic'] }, parentTaskId: { type: ['number', 'null'] }, assignedUserId: { type: ['string', 'null'] }, assignedAgentRef: { type: ['string', 'null'] }, assignedAgentHostId: { type: ['number', 'null'] } }, ['id']),
    run: async (ctx, a) => {
      // tenant-scope guard (service.updateTask doesn't check) + capture the prior
      // lane AND owner so the autonomous triggers fire only on a genuine lane change /
      // a genuine reassignment.
      const before = await getTenantTask(ctx, num(a.id));
      const beforePlain = before.toPlain() as { status: string; assignedAgentRef?: string | null };
      const previousStatus = beforePlain.status;
      const previousAgentRef = beforePlain.assignedAgentRef ?? null;
      const updated = await ctx.tasks.updateTask(num(a.id), {
        title: a.title != null ? str(a.title) : undefined,
        description: a.description != null ? str(a.description) : undefined,
        status: a.status != null ? str(a.status) : undefined,
        priority: a.priority != null ? (str(a.priority) as TaskPriority) : undefined,
        dueDate: a.dueDate != null ? str(a.dueDate) : undefined,
        archived: typeof a.archived === 'boolean' ? a.archived : undefined,
        taskType: a.taskType != null ? (str(a.taskType) as TaskType) : undefined,
        parentTaskId: a.parentTaskId !== undefined ? (a.parentTaskId === null ? null : num(a.parentTaskId)) : undefined,
        assignedUserId: a.assignedUserId !== undefined ? (a.assignedUserId === null ? null : str(a.assignedUserId)) : undefined,
        assignedAgentRef: a.assignedAgentRef !== undefined ? (a.assignedAgentRef === null ? null : str(a.assignedAgentRef)) : undefined,
        assignedAgentHostId: a.assignedAgentHostId !== undefined ? (a.assignedAgentHostId === null ? null : num(a.assignedAgentHostId)) : undefined,
      });
      // The ticket may have just entered a new lane — run that lane's configured
      // agent (AS the lane agent; the ticket's own assignee is left untouched).
      const laneOutcome = await fireLaneAutoRun(ctx, updated, previousStatus);
      // Assignment → work handoff: reassigning the ticket to a NEW cloud agent is itself
      // a "go" — start that owner's run AND bring it into the ticket's linked chats (the
      // MCP path used to do neither, so a dev agent assigned by the Brain never picked up
      // the ticket or joined the conversation).
      const assignOutcome = await fireAgentAssignmentHandoff(ctx, updated, previousAgentRef);
      // REPORT the autonomy verdict. Both triggers are best-effort and backgrounded, so
      // the result used to say nothing about whether work actually started — a caller
      // that moved seven tickets to a coder was told each write succeeded while every
      // dispatch was declined. Prefer whichever trigger dispatched; else the first
      // decision made (the lane move is evaluated before the reassignment).
      const autoRun = [laneOutcome, assignOutcome].find((o) => o?.dispatched)
        ?? laneOutcome ?? assignOutcome;
      return { ...(updated.toPlain() as object), ...(autoRun ? { autoRun } : {}) };
    },
  },
  { tool: 'tasks.delete', mutates: true, description: 'Delete a task.', parameters: obj({ id: N }, ['id']), run: async (ctx, a) => { await getTenantTask(ctx, num(a.id)); await ctx.tasks.deleteTask(num(a.id)); return { deleted: num(a.id) }; } },
  { tool: 'tasks.move', mutates: true, description: 'Move a task to another project board (re-keys it).', parameters: obj({ id: N, projectId: N }, ['id', 'projectId']), run: (ctx, a) => ctx.tasks.moveTask(num(a.id), num(a.projectId), ctx.tenantId).then((t) => t.toPlain()) },

  // ---- Work-delta capture + Validator review (0270) ----
  {
    tool: 'tickets.from_delta', mutates: true,
    description: 'Record a code CHANGE you just made as a classified work delta AND open the associated ticket so the work is visible on the board. Call this whenever your turn added or changed code (a feature, fix, or bug repair) that is not already tracked by an existing ticket. kind: improvement (new/better behaviour) | fix (repaired something) | bug (a defect you are logging). Pass files you touched and, when working in a Brain chat, the chatId so the ticket is tied back to this conversation. The ticket opens in review and completes automatically when the change is merged + deployed.',
    parameters: obj({
      projectId: N, summary: S, detail: S,
      kind: { type: 'string', enum: ['improvement', 'fix', 'bug'] },
      files: { type: 'array', items: S }, modality: S, chatId: N,
      createTicket: B,
    }, ['projectId', 'summary']),
    run: async (ctx, a) => {
      if (!ctx.env) throw new Error('work-delta recording requires the worker env');
      const files = Array.isArray(a.files) ? (a.files as unknown[]).map(str) : undefined;
      return new WorkDeltaService(ctx.db, ctx.env).record(ctx.tenantId, ctx.userId ?? null, {
        projectId: num(a.projectId),
        summary: str(a.summary),
        detail: a.detail != null ? str(a.detail) : null,
        kind: a.kind != null ? (str(a.kind) as DeltaKind) : undefined,
        files,
        modality: a.modality != null ? str(a.modality) : 'mcp',
        chatId: a.chatId != null ? num(a.chatId) : null,
        createdBy: ctx.userId ?? null,
        createTicket: typeof a.createTicket === 'boolean' ? a.createTicket : true,
      });
    },
  },
  {
    tool: 'reviews.record', mutates: true,
    description: 'Report the outcome of reviewing a Done work item against the codebase (Validator agent). verdict: complete (the delivered code fully satisfies the ticket) | gaps (work is missing). For every gap, pass an entry in gaps[] — each becomes a first-class GAP task tied back to the reviewed item so it is scheduled, not lost. When a gap is about a SPECIFIC line of code, set path (repo-relative) and line: those gaps are posted as inline comments on the pull request, anchored to that line, so the reviewer sees them against the code. Omit path/line for gaps about missing work ("no tests added") — they go in the review summary instead, which is equally visible. Provide a one-paragraph summary of what you checked. A Done item may be reviewed repeatedly; each call is one recorded pass.',
    parameters: obj({
      taskId: N,
      verdict: { type: 'string', enum: ['complete', 'gaps'] },
      summary: S,
      reviewerRef: S,
      gaps: {
        type: 'array',
        items: obj({
          title: S,
          detail: S,
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
          path: { type: 'string', description: 'Repo-relative file path this gap is about, e.g. src/api/handler.ts. Only set it if the file is part of this change.' },
          line: { type: 'number', description: 'Line number in the changed file that the gap refers to.' },
        }, ['title']),
      },
    }, ['taskId']),
    run: async (ctx, a) => {
      const gaps: ReviewGapInput[] = Array.isArray(a.gaps)
        ? (a.gaps as Json[]).map((g) => ({
            title: str(g.title),
            detail: g.detail != null ? str(g.detail) : null,
            priority: g.priority != null ? (str(g.priority) as TaskPriority) : undefined,
            path: g.path != null ? str(g.path) : null,
            line: g.line != null ? num(g.line) : null,
          }))
        : [];
      const taskId = num(a.taskId);
      const summary = a.summary != null ? str(a.summary) : null;
      const result = await new ValidationService(ctx.db).recordReview(ctx.tenantId, {
        taskId,
        verdict: a.verdict != null ? (str(a.verdict) as ReviewVerdict) : undefined,
        summary,
        reviewerRef: a.reviewerRef != null ? str(a.reviewerRef) : (ctx.userId ?? null),
        gaps,
      });

      // Publish the review onto the ticket's pull request. This is the point of
      // the whole review: a verdict that lives only in Builderforce is invisible
      // to whoever is actually deciding whether to merge.
      //
      // Best-effort and after the fact — the review is already durably recorded
      // above, and a GitHub outage must not fail the tool call or lose the gaps.
      if (ctx.env) {
        await publishReviewToPr(ctx.env, ctx.db, ctx.tenantId, taskId, {
          verdict: result.verdict,
          summary,
          gaps,
          reviewerRef: a.reviewerRef != null ? str(a.reviewerRef) : (ctx.userId ?? null),
        }).catch(() => { /* best-effort */ });
      }
      return result;
    },
  },

  // ---- Security agent (SOC 2 audit) ----
  {
    tool: 'security.record_finding', mutates: true,
    description: 'File ONE SOC 2 audit finding (Security agent). Each call mints an access-restricted SECURITY ticket in the audited project carrying the severity, the Trust Service Criterion the finding maps to, a location, and a concrete recommendation. severity: critical|high|medium|low|info. tsc: security (Common Criteria) | availability | processing_integrity | confidentiality | privacy. Pass auditId to attach to the current run (else it attaches to the tenant\'s latest running audit).',
    parameters: obj({
      title: S,
      detail: S,
      severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
      tsc: { type: 'string', enum: ['security', 'availability', 'processing_integrity', 'confidentiality', 'privacy'] },
      location: S,
      recommendation: S,
      auditId: N,
    }, ['title']),
    run: (ctx, a) => new SecurityAuditService(ctx.db).recordFinding(ctx.tenantId, {
      auditId: a.auditId != null ? num(a.auditId) : null,
      title: str(a.title),
      detail: a.detail != null ? str(a.detail) : null,
      severity: a.severity != null ? (str(a.severity) as FindingSeverity) : undefined,
      tsc: a.tsc != null ? (str(a.tsc) as TrustCriterion) : undefined,
      location: a.location != null ? str(a.location) : null,
      recommendation: a.recommendation != null ? str(a.recommendation) : null,
    }),
  },
  {
    tool: 'security.get_access', mutates: false,
    description: 'Read who can see this workspace\'s access-restricted SECURITY tickets: the audience toggles (humans/hired/talent) and the explicit user/agent allowlists.',
    parameters: obj({}),
    run: (ctx) => new SecurityTicketAccessService(ctx.db, ctx.env).getConfig(ctx.tenantId),
  },
  {
    tool: 'security.configure_access', mutates: true,
    description: 'Configure who can see the access-restricted SECURITY tickets (setup). audiences toggles whole populations on/off (humans = team members, hired = agents, talent = freelancers); allowUserIds / allowAgentRefs grant specific users/agents. Default is deny-all (only Owner/Manager see them). Admin action — not available to unattended cloud agents.',
    parameters: obj({
      audiences: obj({ humans: B, hired: B, talent: B }),
      allowUserIds: { type: 'array', items: S },
      allowAgentRefs: { type: 'array', items: S },
    }),
    run: async (ctx, a) => {
      const aud = (a.audiences ?? undefined) as { humans?: unknown; hired?: unknown; talent?: unknown } | undefined;
      return new SecurityTicketAccessService(ctx.db, ctx.env).setConfig(ctx.tenantId, {
        audiences: aud ? { humans: !!aud.humans, hired: !!aud.hired, talent: !!aud.talent } : undefined,
        allowUserIds: Array.isArray(a.allowUserIds) ? (a.allowUserIds as unknown[]).map((x) => str(x)) : undefined,
        allowAgentRefs: Array.isArray(a.allowAgentRefs) ? (a.allowAgentRefs as unknown[]).map((x) => str(x)) : undefined,
      }, ctx.userId ?? null);
    },
  },

  // ---- Incident Manager (help-desk triage, on-call paging & escalation) ----
  {
    tool: 'incidents.open', mutates: true,
    description: 'Open a new incident (Incident Manager agent). Mints a bridged INCIDENT board ticket + an incident record. severity: sev1 (most severe) … sev4. Pass affectedSystem once you have worked out which system the issue pertains to (or use incidents.classify later). Set openWarRoom to start the on-call war-room chat. Returns { incidentId, boardTaskId, warRoomChatId, created }.',
    parameters: obj({
      title: S, description: S,
      severity: { type: 'string', enum: ['sev1', 'sev2', 'sev3', 'sev4'] },
      source: S, affectedSystem: S, externalRef: S, externalUrl: S, openWarRoom: B,
    }, ['title']),
    run: (ctx, a) => new IncidentService(ctx.db).openIncident(ctx.tenantId, {
      title: str(a.title),
      description: a.description != null ? str(a.description) : null,
      severity: a.severity != null ? (str(a.severity) as IncidentSeverity) : undefined,
      source: a.source != null ? str(a.source) : 'agent',
      affectedSystem: a.affectedSystem != null ? str(a.affectedSystem) : null,
      externalRef: a.externalRef != null ? str(a.externalRef) : null,
      externalUrl: a.externalUrl != null ? str(a.externalUrl) : null,
      openWarRoom: a.openWarRoom === true,
      actorRef: 'agent',
    }),
  },
  {
    tool: 'incidents.classify', mutates: true,
    description: 'Record which SYSTEM an incident pertains to, once you have analysed the ticket (e.g. "Payments", "Authentication", "Database"). Updates the incident + its board ticket. Params: incidentId, system.',
    parameters: obj({ incidentId: S, system: S }, ['incidentId', 'system']),
    run: async (ctx, a) => { await new IncidentService(ctx.db).classify(ctx.tenantId, str(a.incidentId), str(a.system), 'agent'); return { ok: true }; },
  },
  {
    tool: 'incidents.update', mutates: true,
    description: 'Update an incident: severity (sev1..sev4), status (open|acknowledged|mitigated|resolved), impact, rootCause. Acknowledging or mitigating an incident STOPS further escalation pages. Resolving it stamps the MTTR resolve time and closes the board ticket lifecycle.',
    parameters: obj({
      incidentId: S,
      severity: { type: 'string', enum: ['sev1', 'sev2', 'sev3', 'sev4'] },
      status: { type: 'string', enum: ['open', 'acknowledged', 'mitigated', 'resolved'] },
      impact: S, rootCause: S,
    }, ['incidentId']),
    run: async (ctx, a) => {
      await new IncidentService(ctx.db).updateIncident(ctx.tenantId, str(a.incidentId), {
        severity: a.severity != null ? (str(a.severity) as IncidentSeverity) : undefined,
        status: a.status != null ? (str(a.status) as IncidentStatus) : undefined,
        impact: a.impact != null ? str(a.impact) : undefined,
        rootCause: a.rootCause != null ? str(a.rootCause) : undefined,
        actorRef: 'agent',
      });
      return { ok: true };
    },
  },
  {
    tool: 'incidents.add_note', mutates: true,
    description: 'Post an update onto the incident timeline / war-room feed (what you are seeing, what you are doing). Params: incidentId, message.',
    parameters: obj({ incidentId: S, message: S }, ['incidentId', 'message']),
    run: async (ctx, a) => { await new IncidentService(ctx.db).addEvent(ctx.tenantId, str(a.incidentId), { kind: 'note', actorRef: 'agent', message: str(a.message) }); return { ok: true }; },
  },
  { tool: 'incidents.list', mutates: false, description: 'List incidents in the workspace, newest first. Pass activeOnly:true to exclude resolved ones.', parameters: obj({ activeOnly: B }), run: (ctx, a) => new IncidentService(ctx.db).listIncidents(ctx.tenantId, { activeOnly: a.activeOnly === true }) },
  { tool: 'incidents.get', mutates: false, description: 'Get one incident + its timeline (the war-room detail). Params: incidentId.', parameters: obj({ incidentId: S }, ['incidentId']), run: (ctx, a) => new IncidentService(ctx.db).getIncident(ctx.tenantId, str(a.incidentId)) },
  {
    tool: 'oncall.page', mutates: true,
    description: 'Page the on-call list for an incident right now via the matching escalation policy (Teams / Slack / email). Use after opening an incident to notify whoever is on call. Params: incidentId.',
    parameters: obj({ incidentId: S }, ['incidentId']),
    run: async (ctx, a) => {
      if (!ctx.env) throw new Error('paging requires the worker environment');
      await new EscalationService(ctx.db).pageInitial(ctx.env, ctx.tenantId, str(a.incidentId));
      return { paged: true };
    },
  },
  { tool: 'oncall.list', mutates: false, description: 'List on-call rotations and who is currently on call for each.', parameters: obj({}), run: (ctx) => new OnCallService(ctx.db).listRotations(ctx.tenantId) },
  {
    tool: 'incidents.postmortem', mutates: true,
    description: 'Publish a post-incident review (RCA / lessons-learned) for a RESOLVED incident. Authors a first-class, versioned Knowledge article (docType "postmortem", or "known_error" for a documented known error + workaround), files each action item as a linked remediation task, and back-links the incident. Also feeds the learning into Evermind so the workforce stops repeating the cause. Do this once the incident is resolved and you understand the root cause. Params: incidentId (required), summary, rootCause, impact, contributingFactors, resolution, whatWentWell, whatWentWrong, actionItems[{title,detail}], docType.',
    parameters: obj({
      incidentId: S, summary: S, rootCause: S, impact: S, contributingFactors: S, resolution: S, whatWentWell: S, whatWentWrong: S,
      docType: { type: 'string', enum: ['postmortem', 'known_error'] },
      actionItems: { type: 'array', items: obj({ title: S, detail: S }, ['title']) },
    }, ['incidentId']),
    run: async (ctx, a) => {
      const actionItems = Array.isArray(a.actionItems)
        ? (a.actionItems as Json[]).map((g) => ({ title: str(g.title), detail: g.detail != null ? str(g.detail) : null })).filter((g) => g.title)
        : [];
      const res = await new IncidentService(ctx.db).publishPostmortem(ctx.tenantId, str(a.incidentId), {
        summary: a.summary != null ? str(a.summary) : null,
        rootCause: a.rootCause != null ? str(a.rootCause) : null,
        impact: a.impact != null ? str(a.impact) : null,
        contributingFactors: a.contributingFactors != null ? str(a.contributingFactors) : null,
        resolution: a.resolution != null ? str(a.resolution) : null,
        whatWentWell: a.whatWentWell != null ? str(a.whatWentWell) : null,
        whatWentWrong: a.whatWentWrong != null ? str(a.whatWentWrong) : null,
        actionItems,
        docType: a.docType != null ? (str(a.docType) as 'postmortem' | 'known_error') : undefined,
        actorRef: 'agent',
      }, ctx.env);
      return res;
    },
  },
  {
    tool: 'knowledge.search', mutates: false,
    description: 'Search the workspace Knowledge base (published docs) for the most relevant articles — SOPs, processes, and especially prior incident RCAs / known-errors. Use this DURING triage to find how a similar issue was handled before, so a recurring incident is resolved fast instead of from scratch. Returns ranked { id, title, docType, excerpt }[]. Params: query (required), topK (default 5), includePostmortems (default true).',
    parameters: obj({ query: S, topK: N, includePostmortems: B }, ['query']),
    run: (ctx, a) => {
      const docTypes = a.includePostmortems === false
        ? ['sop', 'process']
        : ['sop', 'process', 'doc', 'postmortem', 'known_error'];
      return recallSops(ctx.db, ctx.tenantId, str(a.query), a.topK != null ? num(a.topK) : 5, docTypes);
    },
  },
  {
    tool: 'knowledge.create', mutates: true,
    description: 'Author + PUBLISH a standalone Knowledge article (SOP / process / doc / known-error) so it is first-class, versioned, searchable, and read-acknowledgeable. Use this to write a runbook, standard-operating-procedure, or known-error entry directly — NOT for incident RCAs (use incidents.postmortem, which back-links the incident). Params: title + content required; docType (sop|process|doc|known_error, default doc); optional summary, projectId, tags[].',
    parameters: obj({ title: S, content: S, docType: S, summary: S, projectId: N, tags: { type: 'array', items: S } }, ['title', 'content']),
    run: async (ctx, a) => {
      const title = str(a.title).trim();
      const content = str(a.content).trim();
      if (!title) throw new Error('title is required');
      if (!content) throw new Error('content is required');
      // postmortem is deliberately excluded here — it must ride incidents.postmortem so
      // it back-links the incident and files the action items.
      const allowed = ['sop', 'process', 'doc', 'known_error'];
      const docType = a.docType != null && allowed.includes(str(a.docType)) ? str(a.docType) : 'doc';
      if (a.projectId != null) await ctx.projects.getProject(num(a.projectId), ctx.tenantId); // tenant-ownership guard
      const segmentId = await resolveSegment(ctx.db, ctx.tenantId).catch(() => null);
      const tags = Array.isArray(a.tags) ? (a.tags as unknown[]).map((t) => str(t)).filter(Boolean) : undefined;
      const { id } = await publishKnowledgeDoc(ctx.db, ctx.env, {
        tenantId: ctx.tenantId, segmentId, projectId: a.projectId != null ? num(a.projectId) : null,
        docType, title, content, summary: a.summary != null ? str(a.summary) : null, tags, createdBy: ctx.userId ?? null,
      });
      return { id, docType, title };
    },
  },

  // ---- Workflows (read) — tenant-scoped direct queries [1296] ----
  { tool: 'workflows.list', mutates: false, description: 'List workflow runs (compact: id/type/status/runtime + timestamps + a description snippet), capped by limit (default 50, max 200).', parameters: obj({ limit: N }), run: async (ctx, a) => { const rows = await ctx.db.select().from(workflows).where(eq(workflows.tenantId, ctx.tenantId)).orderBy(desc(workflows.updatedAt)).limit(LIST_MAX_LIMIT); return listEnvelope('workflows', rows.map((r) => compactRow(r as unknown as Record<string, unknown>, WORKFLOW_LIST_FIELDS, 'description')), clampLimit(a.limit)); } },
  { tool: 'workflows.get', mutates: false, description: 'Get one workflow by id.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => (await ctx.db.select().from(workflows).where(and(eq(workflows.id, str(a.id)), eq(workflows.tenantId, ctx.tenantId))).limit(1))[0] ?? null },

  // ---- Specs / PRDs (read) ----
  { tool: 'specs.list', mutates: false, description: 'List specs / PRDs (compact: id/projectId/goal/status/kind + a short PRD snippet), optionally filtered by project, capped by limit (default 50, max 200). Use specs.get for one spec\'s full PRD / arch-spec / task-list body.', parameters: obj({ projectId: N, limit: N }), run: async (ctx, a) => { const rows = await ctx.db.select().from(specs).where(a.projectId != null ? and(eq(specs.tenantId, ctx.tenantId), eq(specs.projectId, num(a.projectId))) : eq(specs.tenantId, ctx.tenantId)).orderBy(desc(specs.updatedAt)).limit(LIST_MAX_LIMIT); return listEnvelope('specs', rows.map((r) => compactSpec(r as unknown as Record<string, unknown>)), clampLimit(a.limit)); } },
  { tool: 'specs.get', mutates: false, description: 'Get one spec / PRD by id.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => (await ctx.db.select().from(specs).where(and(eq(specs.id, str(a.id)), eq(specs.tenantId, ctx.tenantId))).limit(1))[0] ?? null },
  {
    tool: 'specs.create', mutates: true,
    description: 'Create a spec / PRD. goal is required; optionally attach to a project and include the PRD body.',
    parameters: obj({ goal: S, projectId: N, prd: S }, ['goal']),
    run: async (ctx, a) => {
      const goal = str(a.goal).trim();
      if (!goal) throw new Error('goal is required');
      if (a.projectId != null) await ctx.projects.getProject(num(a.projectId), ctx.tenantId); // tenant-ownership guard (no cross-tenant attach)
      const [row] = await ctx.db.insert(specs).values({
        id: crypto.randomUUID(),
        tenantId: ctx.tenantId,
        goal,
        projectId: a.projectId != null ? num(a.projectId) : null,
        prd: a.prd != null ? str(a.prd) : null,
      }).returning();
      return row;
    },
  },
  { tool: 'specs.delete', mutates: true, description: 'Delete a spec / PRD by id.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const rows = await ctx.db.delete(specs).where(and(eq(specs.id, str(a.id)), eq(specs.tenantId, ctx.tenantId))).returning({ id: specs.id }); return { deleted: rows.length > 0 ? str(a.id) : null }; } },

  // ---- Product roadmap (roadmap_items — a project/segment-scoped product artifact) ----
  // NOT a planning-spine node: its own uuid-keyed table. A chat can be tied to a roadmap
  // item (chats.link_ticket kind='roadmap'); these tools let the Brain read + create +
  // maintain them. Writes invalidate the SAME tracker cache the /api/product/roadmap
  // route serves (one key format via trackerCacheKey — no drift, no stale page reads).
  { tool: 'roadmap.list', mutates: false, description: 'List product roadmap items, optionally for one project (pass projectId). The UI groups them by horizon (now / next / later).', parameters: obj({ projectId: N }), run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const conds = [eq(roadmapItems.tenantId, ctx.tenantId), eq(roadmapItems.segmentId, seg)];
      if (a.projectId != null) conds.push(eq(roadmapItems.projectId, num(a.projectId)));
      return ctx.db.select().from(roadmapItems).where(and(...conds)).orderBy(desc(roadmapItems.updatedAt)).limit(200);
    } },
  { tool: 'roadmap.get', mutates: false, description: 'Get one roadmap item by id (uuid).', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => (await ctx.db.select().from(roadmapItems).where(and(eq(roadmapItems.id, str(a.id)), eq(roadmapItems.tenantId, ctx.tenantId))).limit(1))[0] ?? null },
  {
    tool: 'roadmap.create', mutates: true,
    description: 'Create a product roadmap item. title is required; horizon = now|next|later (default now); status defaults to "planned" (set "shipped" to mark it delivered). Optionally attach to a project (projectId) and set theme / priority / targetDate (ISO) / notes.',
    parameters: obj({ title: S, horizon: S, status: S, theme: S, priority: S, targetDate: S, notes: S, projectId: N }, ['title']),
    run: async (ctx, a) => {
      const title = str(a.title).trim(); if (!title) throw new Error('title is required');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const projectId = a.projectId != null ? num(a.projectId) : null;
      if (projectId != null) await ctx.projects.getProject(projectId, ctx.tenantId); // tenant-ownership guard (no cross-tenant attach)
      const [row] = await ctx.db.insert(roadmapItems).values({
        tenantId: ctx.tenantId, segmentId: seg, projectId, title,
        ...(a.horizon != null ? { horizon: str(a.horizon) } : {}),
        ...(a.status != null ? { status: str(a.status) } : {}),
        theme: a.theme != null ? str(a.theme) : null,
        priority: a.priority != null ? str(a.priority) : null,
        targetDate: dt(a.targetDate) ?? null,
        notes: a.notes != null ? str(a.notes) : null,
      }).returning();
      await invalidateRoadmap(ctx, seg, projectId);
      return row;
    },
  },
  {
    tool: 'roadmap.update', mutates: true,
    description: 'Update a roadmap item (title / horizon / status / theme / priority / targetDate / notes / projectId). Set status="shipped" to mark it delivered.',
    parameters: obj({ id: S, title: S, horizon: S, status: S, theme: S, priority: S, targetDate: S, notes: S, projectId: N }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.title != null) patch.title = str(a.title);
      if (a.horizon != null) patch.horizon = str(a.horizon);
      if (a.status != null) patch.status = str(a.status);
      if (a.theme != null) patch.theme = str(a.theme);
      if (a.priority != null) patch.priority = str(a.priority);
      if (a.targetDate != null) patch.targetDate = dt(a.targetDate) ?? null;
      if (a.notes != null) patch.notes = str(a.notes);
      if (a.projectId != null) patch.projectId = num(a.projectId);
      const [row] = await ctx.db.update(roadmapItems).set(patch).where(and(eq(roadmapItems.id, str(a.id)), eq(roadmapItems.tenantId, ctx.tenantId), eq(roadmapItems.segmentId, seg))).returning();
      if (!row) throw new Error('roadmap item not found');
      await invalidateRoadmap(ctx, seg, (row as { projectId?: number | null }).projectId ?? null);
      return row;
    },
  },
  { tool: 'roadmap.delete', mutates: true, description: 'Delete a roadmap item by id.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const rows = await ctx.db.delete(roadmapItems).where(and(eq(roadmapItems.id, str(a.id)), eq(roadmapItems.tenantId, ctx.tenantId), eq(roadmapItems.segmentId, seg))).returning({ id: roadmapItems.id, projectId: roadmapItems.projectId });
      if (rows[0]) await invalidateRoadmap(ctx, seg, rows[0].projectId ?? null);
      return { deleted: rows.length > 0 ? str(a.id) : null };
    } },

  // ---- Legal documents (platform Terms of Use / Privacy Policy) ----
  //  These rows are PLATFORM-GLOBAL (no tenant scope): one active `terms` and one
  //  active `privacy` for the whole platform. Reading is public info; WRITES are
  //  gated to a platform superadmin (assertLegalWrite) because a single row backs
  //  every tenant's legal pages. Writes go through the SAME service the admin UI
  //  and public /legal endpoints use — no logic drift. The Brain, being an LLM,
  //  drafts/improves the Markdown itself and passes it to legal.set / legal.publish.
  { tool: 'legal.get', mutates: false, description: 'Get the active platform legal documents (Terms of Use + Privacy Policy) — version, title and full Markdown content. Pass docType ("terms" | "privacy") for just one.', parameters: obj({ docType: S }), run: async (ctx, a) => {
      if (a.docType != null) {
        if (!isLegalDocType(a.docType)) throw new Error('docType must be "terms" or "privacy"');
        return getActiveLegalDoc(ctx.db, a.docType);
      }
      return getLegalCurrent(ctx.db);
    } },
  {
    tool: 'legal.set', mutates: true,
    description: 'Amend the ACTIVE legal document in place (no new version unless you change `version`). Use this to edit the current Terms of Use or Privacy Policy. docType and content (full Markdown) are required; title and version are optional. Superadmin only.',
    parameters: obj({ docType: S, content: S, title: S, version: S }, ['docType', 'content']),
    run: async (ctx, a) => {
      await assertLegalWrite(ctx);
      if (!isLegalDocType(a.docType)) throw new Error('docType must be "terms" or "privacy"');
      return amendActiveLegalDoc(ctx.db, a.docType, {
        content: str(a.content),
        title: a.title != null ? str(a.title) : undefined,
        version: a.version != null ? str(a.version) : undefined,
      }, ctx.userId ?? null);
    },
  },
  {
    tool: 'legal.publish', mutates: true,
    description: 'Publish a NEW version of a legal document and make it the active one (the old version is retired). docType, version (must be new, e.g. "1.1.0") and content (full Markdown) are required; title optional. Superadmin only.',
    parameters: obj({ docType: S, version: S, content: S, title: S }, ['docType', 'version', 'content']),
    run: async (ctx, a) => {
      await assertLegalWrite(ctx);
      if (!isLegalDocType(a.docType)) throw new Error('docType must be "terms" or "privacy"');
      return publishLegalDoc(
        ctx.db,
        a.docType,
        { version: str(a.version), content: str(a.content), title: a.title != null ? str(a.title) : undefined },
        ctx.userId ?? null,
      );
    },
  },

  // ---- Strategy: Portfolios ▸ Initiatives ▸ OKRs (objectives + key results) ----
  // OKRs live in their OWN tables (segment-scoped), NOT on the task board. A board
  // Epic is a delivery container; an Objective is a strategic goal whose progress
  // rolls up from its Key Results. Capture OKRs with objectives.create +
  // key_results.create, then link the delivering epics/initiatives via
  // objectives.add_link. This is the single server-side source both the web Brain
  // and the VS Code chat consume.
  { tool: 'portfolios.list', mutates: false, description: 'List portfolios (top of the strategy hierarchy; compact: id/name/status/owner/targetDate + snippet), capped by limit (default 50, max 200).', parameters: obj({ limit: N }), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const rows = await ctx.db.select().from(portfolios).where(and(eq(portfolios.tenantId, ctx.tenantId), eq(portfolios.segmentId, seg))).orderBy(desc(portfolios.updatedAt)).limit(LIST_MAX_LIMIT); return listEnvelope('portfolios', rows.map((r) => compactRow(r as unknown as Record<string, unknown>, PORTFOLIO_LIST_FIELDS, 'description')), clampLimit(a.limit)); } },
  {
    tool: 'portfolios.create', mutates: true,
    description: 'Create a portfolio (a strategic grouping that initiatives and OKRs attach to).',
    parameters: obj({ name: S, description: S, status: S, targetDate: S }, ['name']),
    run: async (ctx, a) => {
      const name = str(a.name).trim(); if (!name) throw new Error('name is required');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [row] = await ctx.db.insert(portfolios).values({ tenantId: ctx.tenantId, segmentId: seg, name, description: a.description != null ? str(a.description) : null, ...(a.status != null ? { status: str(a.status) } : {}), targetDate: dt(a.targetDate) }).returning();
      await bumpPmo(ctx);
      return row;
    },
  },
  {
    tool: 'portfolios.update', mutates: true,
    description: "Update a portfolio (name/description/status/targetDate).",
    parameters: obj({ id: S, name: S, description: S, status: S, targetDate: S }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.name != null) patch.name = str(a.name);
      if (a.description != null) patch.description = str(a.description);
      if (a.status != null) patch.status = str(a.status);
      if (a.targetDate != null) patch.targetDate = dt(a.targetDate);
      const [row] = await ctx.db.update(portfolios).set(patch).where(and(eq(portfolios.id, str(a.id)), eq(portfolios.tenantId, ctx.tenantId), eq(portfolios.segmentId, seg))).returning();
      if (!row) throw new Error('portfolio not found');
      await bumpPmo(ctx);
      return row;
    },
  },
  { tool: 'portfolios.delete', mutates: true, description: 'Delete a portfolio.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const rows = await ctx.db.delete(portfolios).where(and(eq(portfolios.id, str(a.id)), eq(portfolios.tenantId, ctx.tenantId), eq(portfolios.segmentId, seg))).returning({ id: portfolios.id }); await bumpPmo(ctx); return { deleted: rows.length > 0 ? str(a.id) : null }; } },

  { tool: 'initiatives.list', mutates: false, description: 'List initiatives (programs of work under a portfolio; compact: id/portfolioId/name/status/owner/dates + snippet), capped by limit (default 50, max 200).', parameters: obj({ limit: N }), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const rows = await ctx.db.select().from(initiatives).where(and(eq(initiatives.tenantId, ctx.tenantId), eq(initiatives.segmentId, seg))).orderBy(desc(initiatives.updatedAt)).limit(LIST_MAX_LIMIT); return listEnvelope('initiatives', rows.map((r) => compactRow(r as unknown as Record<string, unknown>, INITIATIVE_LIST_FIELDS, 'description')), clampLimit(a.limit)); } },
  {
    tool: 'initiatives.create', mutates: true,
    description: 'Create an initiative under a portfolio (pass portfolioId).',
    parameters: obj({ name: S, description: S, status: S, portfolioId: S, startDate: S, targetDate: S }, ['name']),
    run: async (ctx, a) => {
      const name = str(a.name).trim(); if (!name) throw new Error('name is required');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [row] = await ctx.db.insert(initiatives).values({ tenantId: ctx.tenantId, segmentId: seg, name, description: a.description != null ? str(a.description) : null, ...(a.status != null ? { status: str(a.status) } : {}), portfolioId: a.portfolioId != null ? str(a.portfolioId) : null, startDate: dt(a.startDate), targetDate: dt(a.targetDate) }).returning();
      await bumpPmo(ctx);
      return row;
    },
  },
  {
    tool: 'initiatives.update', mutates: true,
    description: 'Update an initiative (name/description/status/portfolioId/dates). Pass portfolioId to MOVE the initiative into that portfolio, or portfolioId=null to unassign it (make it a top-level initiative under no portfolio).',
    parameters: obj({ id: S, name: S, description: S, status: S, portfolioId: { type: ['string', 'null'] }, startDate: S, targetDate: S }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.name != null) patch.name = str(a.name);
      if (a.description != null) patch.description = str(a.description);
      if (a.status != null) patch.status = str(a.status);
      if ('portfolioId' in a) patch.portfolioId = a.portfolioId != null ? str(a.portfolioId) : null;
      if (a.startDate != null) patch.startDate = dt(a.startDate);
      if (a.targetDate != null) patch.targetDate = dt(a.targetDate);
      const [row] = await ctx.db.update(initiatives).set(patch).where(and(eq(initiatives.id, str(a.id)), eq(initiatives.tenantId, ctx.tenantId), eq(initiatives.segmentId, seg))).returning();
      if (!row) throw new Error('initiative not found');
      await bumpPmo(ctx);
      return row;
    },
  },
  { tool: 'initiatives.delete', mutates: true, description: 'Delete an initiative.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const rows = await ctx.db.delete(initiatives).where(and(eq(initiatives.id, str(a.id)), eq(initiatives.tenantId, ctx.tenantId), eq(initiatives.segmentId, seg))).returning({ id: initiatives.id }); await bumpPmo(ctx); return { deleted: rows.length > 0 ? str(a.id) : null }; } },

  { tool: 'objectives.list', mutates: false, description: 'List OKR objectives — the strategic goals on the Portfolio ▸ OKRs tab, NOT board Epics (compact: id/title/status/period/owner + snippet), capped by limit (default 50, max 200).', parameters: obj({ limit: N }), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const rows = await ctx.db.select().from(objectives).where(and(eq(objectives.tenantId, ctx.tenantId), eq(objectives.segmentId, seg))).orderBy(desc(objectives.updatedAt)).limit(LIST_MAX_LIMIT); return listEnvelope('objectives', rows.map((r) => compactRow(r as unknown as Record<string, unknown>, OBJECTIVE_LIST_FIELDS, 'description')), clampLimit(a.limit)); } },
  {
    tool: 'objectives.create', mutates: true,
    description: 'Create an OKR Objective — a strategic, qualitative goal (e.g. "Unlock recurring revenue"). This populates the Portfolio ▸ OKRs tab. Do NOT model OKRs as board Epics. SCOPE the objective by passing exactly one of projectId (a goal FOR a specific project — this is what satisfies that project\'s "Direction" / "goal or OKR linked" health check), initiativeId, or portfolioId (omit all three for a workspace/org-level objective). Then add measurable targets with key_results.create and link the delivering epics/initiatives with objectives.add_link. status: active|achieved|missed|archived; period is an optional label like "2026-Q2". Idempotent: an objective with the same title already in this workspace is returned ({ deduped: true, … }) instead of duplicated.',
    parameters: obj({ title: S, description: S, period: S, status: { type: 'string', enum: ['active', 'achieved', 'missed', 'archived'] }, projectId: N, portfolioId: S, initiativeId: S, startDate: S, endDate: S }, ['title']),
    run: async (ctx, a) => {
      const title = str(a.title).trim(); if (!title) throw new Error('title is required');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      // Idempotent create — a same-title objective in this tenant/segment is returned
      // rather than duplicated (guards roadmap-reconciliation reruns).
      const existingObjectives = await ctx.db.select().from(objectives).where(and(eq(objectives.tenantId, ctx.tenantId), eq(objectives.segmentId, seg)));
      const dupeObjective = (existingObjectives as Array<{ title?: unknown }>).find((o) => normTitle(o.title) === normTitle(title));
      if (dupeObjective) return { deduped: true, ...(dupeObjective as object) };
      const [row] = await ctx.db.insert(objectives).values({
        tenantId: ctx.tenantId, segmentId: seg, title,
        description: a.description != null ? str(a.description) : null,
        period: a.period != null ? str(a.period) : null,
        ...(a.status != null ? { status: str(a.status) } : {}),
        projectId: a.projectId != null ? num(a.projectId) : null,
        portfolioId: a.portfolioId != null ? str(a.portfolioId) : null,
        initiativeId: a.initiativeId != null ? str(a.initiativeId) : null,
        startDate: dt(a.startDate), endDate: dt(a.endDate),
      }).returning();
      await bumpPmo(ctx);
      return row;
    },
  },
  {
    tool: 'objectives.update', mutates: true,
    description: 'Update an OKR objective (title/description/status/period/OWNER/dates). REASSIGN the objective\'s owner (the parent scope shown on the Portfolio ▸ OKRs tab) by passing exactly ONE of portfolioId / initiativeId / projectId and setting the other two to null — e.g. { portfolioId: "pf_123", initiativeId: null, projectId: null } attaches it to that portfolio. Pass all three null to make it an org-level (workspace) objective owned by nothing. Omit a field entirely to leave it unchanged.',
    parameters: obj({ id: S, title: S, description: S, period: S, status: { type: 'string', enum: ['active', 'achieved', 'missed', 'archived'] }, projectId: { type: ['number', 'null'] }, portfolioId: { type: ['string', 'null'] }, initiativeId: { type: ['string', 'null'] }, startDate: S, endDate: S }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.title != null) patch.title = str(a.title);
      if (a.description != null) patch.description = str(a.description);
      if (a.period != null) patch.period = str(a.period);
      if (a.status != null) patch.status = str(a.status);
      if ('projectId' in a) patch.projectId = a.projectId != null ? num(a.projectId) : null;
      if ('portfolioId' in a) patch.portfolioId = a.portfolioId != null ? str(a.portfolioId) : null;
      if ('initiativeId' in a) patch.initiativeId = a.initiativeId != null ? str(a.initiativeId) : null;
      if (a.startDate != null) patch.startDate = dt(a.startDate);
      if (a.endDate != null) patch.endDate = dt(a.endDate);
      const [row] = await ctx.db.update(objectives).set(patch).where(and(eq(objectives.id, str(a.id)), eq(objectives.tenantId, ctx.tenantId), eq(objectives.segmentId, seg))).returning();
      if (!row) throw new Error('objective not found');
      await bumpPmo(ctx);
      return row;
    },
  },
  { tool: 'objectives.delete', mutates: true, description: 'Delete an OKR objective (and its key results).', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const rows = await ctx.db.delete(objectives).where(and(eq(objectives.id, str(a.id)), eq(objectives.tenantId, ctx.tenantId), eq(objectives.segmentId, seg))).returning({ id: objectives.id }); await bumpPmo(ctx); return { deleted: rows.length > 0 ? str(a.id) : null }; } },
  {
    tool: 'objectives.add_link', mutates: true,
    description: 'Link a delivery work-item to an OKR objective — the lineage edge. linkKind="initiative" needs initiativeId; "epic"/"task" needs the numeric taskId (an Epic IS a task with taskType="epic"). Connects board work to the objective it advances.',
    parameters: obj({ objectiveId: S, linkKind: { type: 'string', enum: ['initiative', 'epic', 'task'] }, initiativeId: S, taskId: N }, ['objectiveId', 'linkKind']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [own] = await ctx.db.select({ id: objectives.id }).from(objectives).where(and(eq(objectives.id, str(a.objectiveId)), eq(objectives.tenantId, ctx.tenantId), eq(objectives.segmentId, seg))).limit(1);
      if (!own) throw new Error('objective not found');
      const linkKind = str(a.linkKind);
      const [row] = await ctx.db.insert(objectiveLinks).values({
        tenantId: ctx.tenantId, segmentId: seg, objectiveId: str(a.objectiveId), linkKind,
        initiativeId: linkKind === 'initiative' && a.initiativeId != null ? str(a.initiativeId) : null,
        taskId: (linkKind === 'epic' || linkKind === 'task') && a.taskId != null ? num(a.taskId) : null,
      }).returning();
      await bumpPmo(ctx);
      return row;
    },
  },
  { tool: 'objectives.remove_link', mutates: true, description: 'Remove an objective ▸ work-item link by linkId.', parameters: obj({ objectiveId: S, linkId: S }, ['objectiveId', 'linkId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const rows = await ctx.db.delete(objectiveLinks).where(and(eq(objectiveLinks.id, str(a.linkId)), eq(objectiveLinks.objectiveId, str(a.objectiveId)), eq(objectiveLinks.tenantId, ctx.tenantId), eq(objectiveLinks.segmentId, seg))).returning({ id: objectiveLinks.id }); await bumpPmo(ctx); return { deleted: rows.length > 0 ? str(a.linkId) : null }; } },
  {
    tool: 'work_items.convert_type', mutates: true,
    description: 'Change a work-item\'s TYPE across the board ⇄ OKR boundary. Use this to fix items modelled as the wrong type — e.g. an Epic named "OKR 1 …" that should be a real OKR Objective (so it appears on the OKRs tab + satisfies the project 360 "Direction"). fromKind = what it is now (task|epic = a board task; objective = an OKR); id = the numeric task id, or the objective uuid; toKind = what to make it. Promoting a board item to an objective re-links its child tasks to the new objective and scopes it to the item\'s project; demoting an objective to a task/epic re-parents its linked tasks and DROPS its key results. For objective → task/epic on an objective with no project, pass projectId.',
    parameters: obj({ fromKind: { type: 'string', enum: ['task', 'epic', 'objective'] }, id: S, toKind: { type: 'string', enum: ['task', 'epic', 'objective'] }, projectId: N }, ['fromKind', 'id', 'toKind']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      try {
        return await convertWorkItemType(
          { db: ctx.db, tasks: ctx.tasks, env: ctx.env },
          {
            tenantId: ctx.tenantId,
            segmentId: seg,
            sourceKind: str(a.fromKind) as WorkItemKind,
            sourceId: str(a.id),
            target: str(a.toKind) as WorkItemKind,
            projectId: a.projectId != null ? num(a.projectId) : undefined,
          },
        );
      } catch (e) {
        if (e instanceof ConvertError) throw new Error(e.message);
        throw e;
      }
    },
  },
  {
    tool: 'objectives.promote_orphans', mutates: true,
    description: 'Bulk-fix OKRs modelled as the wrong TYPE: promote EVERY board Epic whose title starts with "OKR" (e.g. "OKR 1 — Grow revenue") into a real OKR Objective, so it appears on the Portfolio ▸ OKRs tab and satisfies each project\'s 360 "Direction". One call sweeps the whole workspace; pass projectId to limit it to one board. Skips Epics already linked to an objective. Manager action. Returns { promoted, ids }.',
    parameters: obj({ projectId: N }),
    run: async (ctx, a) => {
      const res = await promoteOrphanOkrEpics(
        { db: ctx.db, tasks: ctx.tasks, env: ctx.env },
        { tenantId: ctx.tenantId, projectId: a.projectId != null ? num(a.projectId) : undefined },
      );
      await bumpPmo(ctx);
      return res;
    },
  },

  { tool: 'key_results.list', mutates: false, description: 'List key results (the measurable targets under OKR objectives; compact: id/objectiveId/title/metric/current/target/unit/status), capped by limit (default 50, max 200).', parameters: obj({ limit: N }), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const rows = await ctx.db.select().from(keyResults).where(and(eq(keyResults.tenantId, ctx.tenantId), eq(keyResults.segmentId, seg))).orderBy(desc(keyResults.updatedAt)).limit(LIST_MAX_LIMIT); return listEnvelope('key_results', rows.map((r) => compactRow(r as unknown as Record<string, unknown>, KEY_RESULT_LIST_FIELDS)), clampLimit(a.limit)); } },
  {
    tool: 'key_results.create', mutates: true,
    description: 'Create a measurable Key Result under an Objective (objectiveId). A KR moves startValue→targetValue; progress rolls up into the objective and the OKR dashboard. metricType: number|percent|currency|boolean; status: on_track|at_risk|off_track|done. Give each objective 2–5. Idempotent: a KR with the same title already under that objective is returned ({ deduped: true, … }) instead of duplicated.',
    parameters: obj({ objectiveId: S, title: S, metricType: { type: 'string', enum: ['number', 'percent', 'currency', 'boolean'] }, startValue: N, targetValue: N, currentValue: N, unit: S, status: { type: 'string', enum: ['on_track', 'at_risk', 'off_track', 'done'] } }, ['objectiveId', 'title']),
    run: async (ctx, a) => {
      const title = str(a.title).trim(); if (!title) throw new Error('title is required');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [own] = await ctx.db.select({ id: objectives.id }).from(objectives).where(and(eq(objectives.id, str(a.objectiveId)), eq(objectives.tenantId, ctx.tenantId), eq(objectives.segmentId, seg))).limit(1);
      if (!own) throw new Error('objective not found');
      // Idempotent create — a same-title KR already under this objective is returned
      // rather than duplicated.
      const existingKrs = await ctx.db.select().from(keyResults).where(and(eq(keyResults.tenantId, ctx.tenantId), eq(keyResults.segmentId, seg), eq(keyResults.objectiveId, str(a.objectiveId))));
      const dupeKr = (existingKrs as Array<{ title?: unknown }>).find((k) => normTitle(k.title) === normTitle(title));
      if (dupeKr) return { deduped: true, ...(dupeKr as object) };
      const [row] = await ctx.db.insert(keyResults).values({
        tenantId: ctx.tenantId, segmentId: seg, objectiveId: str(a.objectiveId), title,
        ...(a.metricType != null ? { metricType: str(a.metricType) } : {}),
        ...(a.startValue != null ? { startValue: num(a.startValue) } : {}),
        ...(a.targetValue != null ? { targetValue: num(a.targetValue) } : {}),
        ...(a.currentValue != null ? { currentValue: num(a.currentValue) } : {}),
        unit: a.unit != null ? str(a.unit) : null,
        ...(a.status != null ? { status: str(a.status) } : {}),
      }).returning();
      await bumpPmo(ctx);
      return row;
    },
  },
  {
    tool: 'key_results.update', mutates: true,
    description: 'Update a key result — most often currentValue to record progress (also title/metricType/start/target/unit/status).',
    parameters: obj({ id: S, title: S, metricType: { type: 'string', enum: ['number', 'percent', 'currency', 'boolean'] }, startValue: N, targetValue: N, currentValue: N, unit: S, status: { type: 'string', enum: ['on_track', 'at_risk', 'off_track', 'done'] } }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.title != null) patch.title = str(a.title);
      if (a.metricType != null) patch.metricType = str(a.metricType);
      if (a.startValue != null) patch.startValue = num(a.startValue);
      if (a.targetValue != null) patch.targetValue = num(a.targetValue);
      if (a.currentValue != null) patch.currentValue = num(a.currentValue);
      if (a.unit != null) patch.unit = str(a.unit);
      if (a.status != null) patch.status = str(a.status);
      const [row] = await ctx.db.update(keyResults).set(patch).where(and(eq(keyResults.id, str(a.id)), eq(keyResults.tenantId, ctx.tenantId), eq(keyResults.segmentId, seg))).returning();
      if (!row) throw new Error('key result not found');
      await bumpPmo(ctx);
      return row;
    },
  },
  { tool: 'key_results.delete', mutates: true, description: 'Delete a key result.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const rows = await ctx.db.delete(keyResults).where(and(eq(keyResults.id, str(a.id)), eq(keyResults.tenantId, ctx.tenantId), eq(keyResults.segmentId, seg))).returning({ id: keyResults.id }); await bumpPmo(ctx); return { deleted: rows.length > 0 ? str(a.id) : null }; } },

  // ---- Prompt library (read) ----
  { tool: 'prompts.list', mutates: false, description: 'List prompt-library entries (compact: id/slug/title/category/visibility/author/version/usage + snippet; the prompt body lives in versions), capped by limit (default 50, max 200).', parameters: obj({ limit: N }), run: async (ctx, a) => { const rows = await ctx.db.select().from(promptLibraryEntries).where(eq(promptLibraryEntries.tenantId, ctx.tenantId)).orderBy(desc(promptLibraryEntries.updatedAt)).limit(LIST_MAX_LIMIT); return listEnvelope('prompts', rows.map((r) => compactRow(r as unknown as Record<string, unknown>, PROMPT_LIST_FIELDS, 'description')), clampLimit(a.limit)); } },

  // ---- Approval rules (CRUD — simple single-table domain, segment_id auto-filled by the 0056 trigger) ----
  { tool: 'approvals.list', mutates: false, description: 'List the workspace approval rules.', parameters: obj({}), run: (ctx) => ctx.db.select().from(approvalRules).where(eq(approvalRules.tenantId, ctx.tenantId)).limit(200) },
  {
    tool: 'approvals.create', mutates: true,
    description: 'Create an approval rule. Auto-approve when estimated cost / files-changed are at or below the given caps; null = ignore that cap.',
    parameters: obj({ name: S, actionType: S, maxEstimatedCost: N, maxFilesChanged: N, isEnabled: B }, ['name']),
    run: async (ctx, a) => {
      const name = str(a.name).trim();
      if (!name) throw new Error('name is required');
      const [row] = await ctx.db.insert(approvalRules).values({
        tenantId: ctx.tenantId,
        name,
        actionType: a.actionType != null ? str(a.actionType) : null,
        maxEstimatedCost: a.maxEstimatedCost != null ? num(a.maxEstimatedCost) : null,
        maxFilesChanged: a.maxFilesChanged != null ? num(a.maxFilesChanged) : null,
        ...(typeof a.isEnabled === 'boolean' ? { isEnabled: a.isEnabled } : {}),
      }).returning();
      return row;
    },
  },
  { tool: 'approvals.delete', mutates: true, description: 'Delete an approval rule by id.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const rows = await ctx.db.delete(approvalRules).where(and(eq(approvalRules.id, str(a.id)), eq(approvalRules.tenantId, ctx.tenantId))).returning({ id: approvalRules.id }); return { deleted: rows.length > 0 ? str(a.id) : null }; } },

  // ---- Registered agents (read) ----
  { tool: 'agents.list', mutates: false, description: 'List registered agents in the workspace.', parameters: obj({}), run: (ctx) => ctx.db.select().from(agents).where(eq(agents.tenantId, ctx.tenantId)).limit(200) },

  // ---- Boards (read) ----
  { tool: 'boards.list', mutates: false, description: 'List project boards in the workspace.', parameters: obj({}), run: (ctx) => ctx.db.select().from(boards).where(eq(boards.tenantId, ctx.tenantId)).limit(200) },

  // ---- Cron jobs (read) ----
  { tool: 'cron.list', mutates: false, description: 'List scheduled cron jobs in the workspace.', parameters: obj({}), run: (ctx) => ctx.db.select().from(cronJobs).where(eq(cronJobs.tenantId, ctx.tenantId)).limit(200) },

  // ---- Specs / PRDs (write) ----
  // specs is segment-scoped (tenant_id + segment_id). specs.get/list/create/delete already exist above.
  {
    tool: 'specs.patch', mutates: true,
    description: 'Update a spec / PRD (goal/status/prd).',
    parameters: obj({ id: S, goal: S, status: S, prd: S }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.goal != null) patch.goal = str(a.goal);
      if (a.status != null) patch.status = str(a.status);
      if (a.prd != null) patch.prd = str(a.prd);
      const [row] = await ctx.db.update(specs).set(patch).where(and(eq(specs.id, str(a.id)), eq(specs.tenantId, ctx.tenantId), eq(specs.segmentId, seg))).returning();
      if (!row) throw new Error('spec not found');
      return row;
    },
  },

  // ---- Approval requests (human-in-the-loop) — the `approvals` REQUEST table, distinct from the
  //       `approvalRules` table the approvals.list/create/delete tools above read. Segment-scoped. ----
  { tool: 'approvals.get', mutates: false, description: 'Get a pending/decided approval request by id.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return (await ctx.db.select().from(approvals).where(and(eq(approvals.id, str(a.id)), eq(approvals.tenantId, ctx.tenantId), eq(approvals.segmentId, seg))).limit(1))[0] ?? null; } },
  {
    tool: 'approvals.decide', mutates: true,
    description: 'Approve, reject, or answer an approval request. status: approved|rejected|answered. (Records the decision; does not itself start any downstream run.)',
    parameters: obj({ id: S, status: { type: 'string', enum: ['approved', 'rejected', 'answered'] }, reviewNote: S, responseText: S }, ['id', 'status']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { status: str(a.status), updatedAt: new Date() };
      if (a.reviewNote != null) patch.reviewNote = str(a.reviewNote);
      if (a.responseText != null) patch.responseText = str(a.responseText);
      const [row] = await ctx.db.update(approvals).set(patch).where(and(eq(approvals.id, str(a.id)), eq(approvals.tenantId, ctx.tenantId), eq(approvals.segmentId, seg))).returning();
      if (!row) throw new Error('approval not found');
      return row;
    },
  },

  // ---- Prompt library (write) — promptLibraryEntries is segment-scoped; versions hang off an
  //       entry (FK entryId), so every version op first asserts the parent entry's tenant+segment. ----
  { tool: 'prompts.get', mutates: false, description: 'Get a prompt-library entry by id.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return (await ctx.db.select().from(promptLibraryEntries).where(and(eq(promptLibraryEntries.id, str(a.id)), eq(promptLibraryEntries.tenantId, ctx.tenantId), eq(promptLibraryEntries.segmentId, seg))).limit(1))[0] ?? null; } },
  { tool: 'prompts.browse_public', mutates: false, description: 'Browse the public prompt gallery (published prompts across all workspaces).', parameters: obj({ q: S, category: S, limit: N }), run: (ctx, a) => ctx.db.select().from(promptLibraryEntries).where(eq(promptLibraryEntries.visibility, 'public')).orderBy(desc(promptLibraryEntries.starCount)).limit(a.limit != null ? num(a.limit) : 100) },
  {
    tool: 'prompts.create', mutates: true,
    description: 'Create a prompt template (title + body). visibility: private|tenant|public.',
    parameters: obj({ title: S, body: S, description: S, category: S, visibility: { type: 'string', enum: ['private', 'tenant', 'public'] } }, ['title', 'body']),
    run: async (ctx, a) => {
      const title = str(a.title).trim(); if (!title) throw new Error('title is required');
      const body = str(a.body); if (!body) throw new Error('body is required');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 200) || 'prompt'}-${crypto.randomUUID().slice(0, 8)}`;
      const [entry] = await ctx.db.insert(promptLibraryEntries).values({
        tenantId: ctx.tenantId, segmentId: seg, slug, title,
        description: a.description != null ? str(a.description) : null,
        category: a.category != null ? str(a.category) : null,
        ...(a.visibility != null ? { visibility: str(a.visibility) } : {}),
      }).returning();
      if (!entry) throw new Error('failed to create prompt');
      await ctx.db.insert(promptLibraryVersions).values({ entryId: entry.id, version: 1, body }).returning();
      return entry;
    },
  },
  {
    tool: 'prompts.update', mutates: true,
    description: "Update a prompt entry's metadata (title/description/category/visibility).",
    parameters: obj({ id: S, title: S, description: S, category: S, visibility: S }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.title != null) patch.title = str(a.title);
      if (a.description != null) patch.description = str(a.description);
      if (a.category != null) patch.category = str(a.category);
      if (a.visibility != null) patch.visibility = str(a.visibility);
      const [row] = await ctx.db.update(promptLibraryEntries).set(patch).where(and(eq(promptLibraryEntries.id, str(a.id)), eq(promptLibraryEntries.tenantId, ctx.tenantId), eq(promptLibraryEntries.segmentId, seg))).returning();
      if (!row) throw new Error('prompt not found');
      return row;
    },
  },
  {
    tool: 'prompts.add_version', mutates: true,
    description: 'Add a new version (body) to a prompt entry and make it current.',
    parameters: obj({ id: S, body: S, notes: S }, ['id', 'body']),
    run: async (ctx, a) => {
      const body = str(a.body); if (!body) throw new Error('body is required');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [entry] = await ctx.db.select().from(promptLibraryEntries).where(and(eq(promptLibraryEntries.id, str(a.id)), eq(promptLibraryEntries.tenantId, ctx.tenantId), eq(promptLibraryEntries.segmentId, seg))).limit(1);
      if (!entry) throw new Error('prompt not found');
      const nextVersion = (entry.currentVersion ?? 0) + 1;
      const [row] = await ctx.db.insert(promptLibraryVersions).values({ entryId: entry.id, version: nextVersion, body, notes: a.notes != null ? str(a.notes) : null }).returning();
      await ctx.db.update(promptLibraryEntries).set({ currentVersion: nextVersion, updatedAt: new Date() }).where(and(eq(promptLibraryEntries.id, entry.id), eq(promptLibraryEntries.tenantId, ctx.tenantId), eq(promptLibraryEntries.segmentId, seg)));
      return row;
    },
  },
  { tool: 'prompts.remove', mutates: true, description: 'Delete a prompt entry (and its versions).', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const [entry] = await ctx.db.select({ id: promptLibraryEntries.id }).from(promptLibraryEntries).where(and(eq(promptLibraryEntries.id, str(a.id)), eq(promptLibraryEntries.tenantId, ctx.tenantId), eq(promptLibraryEntries.segmentId, seg))).limit(1); if (!entry) return { deleted: null }; await ctx.db.delete(promptLibraryVersions).where(eq(promptLibraryVersions.entryId, entry.id)); await ctx.db.delete(promptLibraryEntries).where(and(eq(promptLibraryEntries.id, entry.id), eq(promptLibraryEntries.tenantId, ctx.tenantId), eq(promptLibraryEntries.segmentId, seg))); return { deleted: str(a.id) }; } },

  // ---- Brain chats (CRUD) — the LIVE unified `brain_chats` table
  // (origin='brainstorm'), the SAME rows the web + VS Code Brain read/write, so a
  // chat created via MCP shows up in the actual Brain (these tools used to target
  // the old orphaned Brain-only table, dropped in 0272). Scoped by tenant +
  // origin, and by user when the caller is a real user (gateway keys are
  // tenant-wide). summarize SKIPPED (needs an LLM call, not a table op). ----
  { tool: 'brain.list', mutates: false, description: 'List Brain chats, optionally filtered by project.', parameters: obj({ projectId: N, limit: N }), run: async (ctx, a) => { const conds = [eq(brainChats.tenantId, ctx.tenantId), eq(brainChats.origin, 'brainstorm'), eq(brainChats.isArchived, false)]; if (ctx.userId) conds.push(eq(brainChats.userId, ctx.userId)); if (a.projectId != null) conds.push(eq(brainChats.projectId, num(a.projectId))); return ctx.db.select().from(brainChats).where(and(...conds)).orderBy(desc(brainChats.updatedAt)).limit(a.limit != null ? num(a.limit) : 100); } },
  { tool: 'brain.get', mutates: false, description: 'Get a Brain chat by id.', parameters: obj({ id: N }, ['id']), run: async (ctx, a) => { const conds = [eq(brainChats.id, num(a.id)), eq(brainChats.tenantId, ctx.tenantId), eq(brainChats.origin, 'brainstorm')]; if (ctx.userId) conds.push(eq(brainChats.userId, ctx.userId)); return (await ctx.db.select().from(brainChats).where(and(...conds)).limit(1))[0] ?? null; } },
  {
    tool: 'brain.create', mutates: true,
    description: 'Create a new Brain chat.',
    parameters: obj({ title: S, projectId: N }),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [row] = await ctx.db.insert(brainChats).values({ tenantId: ctx.tenantId, segmentId: seg, userId: ctx.userId ?? 'system', origin: 'brainstorm', ...(a.title != null ? { title: str(a.title) } : {}), projectId: a.projectId != null ? num(a.projectId) : null }).returning();
      return row;
    },
  },
  {
    tool: 'brain.update', mutates: true,
    description: 'Rename a Brain chat or move it to a project.',
    parameters: obj({ id: N, title: S, projectId: N }, ['id']),
    run: async (ctx, a) => {
      const patch: Json = { updatedAt: new Date() };
      if (a.title != null) patch.title = str(a.title);
      if (a.projectId !== undefined) patch.projectId = a.projectId === null ? null : num(a.projectId);
      const conds = [eq(brainChats.id, num(a.id)), eq(brainChats.tenantId, ctx.tenantId), eq(brainChats.origin, 'brainstorm')];
      if (ctx.userId) conds.push(eq(brainChats.userId, ctx.userId));
      const [row] = await ctx.db.update(brainChats).set(patch).where(and(...conds)).returning();
      if (!row) throw new Error('chat not found');
      return row;
    },
  },
  { tool: 'brain.delete', mutates: true, description: 'Archive a Brain chat.', parameters: obj({ id: N }, ['id']), run: async (ctx, a) => { const conds = [eq(brainChats.id, num(a.id)), eq(brainChats.tenantId, ctx.tenantId), eq(brainChats.origin, 'brainstorm')]; if (ctx.userId) conds.push(eq(brainChats.userId, ctx.userId)); const [row] = await ctx.db.update(brainChats).set({ isArchived: true, updatedAt: new Date() }).where(and(...conds)).returning({ id: brainChats.id }); return { archived: row != null }; } },

  // ---- Chat ↔ ticket links, lineage, consolidation, agent invites ----
  // Tie a Brain chat to work items of ANY tier (portfolio | objective/OKR |
  // initiative | epic | task), MANY-to-MANY, with a health (% done) summary and
  // chat↔ticket lineage; merge chats into one; invite/tag agents to execute.
  // All logic lives in ChatTicketService (shared with the HTTP routes).
  { tool: 'chats.get_messages', mutates: false, description: "Read a Brain chat's message transcript (role + content, in order). Use to REVIEW a conversation's history — e.g. before deciding which chats to merge/consolidate, or to see what a chat produced.", parameters: obj({ chatId: N, limit: N }, ['chatId']), run: async (ctx, a) => { const svc = new ChatTicketService(ctx.db, ctx.env as Env); const r = await svc.listMessages(ctx.tenantId, num(a.chatId), ctx.userId ?? null, a.limit != null ? num(a.limit) : 200); if (!Array.isArray(r)) throw new Error(r.error); return r; } },
  { tool: 'chats.list_tickets', mutates: false, description: "List the work items (portfolio/objective/initiative/roadmap/spec/epic/gap/task) a Brain chat is tied to, each with a health summary (% done). Use to show a chat's ticket status.", parameters: obj({ chatId: N }, ['chatId']), run: async (ctx, a) => { const svc = new ChatTicketService(ctx.db, ctx.env as Env); const r = await svc.listTicketsForChat(ctx.tenantId, num(a.chatId), ctx.userId ?? null); if (!Array.isArray(r)) throw new Error(r.error); return r; } },
  { tool: 'chats.link_ticket', mutates: true, description: "Tie a Brain chat to a work item. kind = portfolio|objective|initiative|roadmap|spec|epic|gap|task; ref = the task/epic/gap id (number) or the portfolio/objective/initiative/roadmap/spec UUID. linkType='created' records that this chat SPAWNED the ticket (lineage); 'linked' (default) attaches an existing one.", parameters: obj({ chatId: N, kind: { type: 'string', enum: ['portfolio', 'objective', 'initiative', 'roadmap', 'spec', 'epic', 'gap', 'task'] }, ref: S, linkType: { type: 'string', enum: ['linked', 'created'] } }, ['chatId', 'kind', 'ref']), run: async (ctx, a) => { const svc = new ChatTicketService(ctx.db, ctx.env as Env); const r = await svc.linkTicket(ctx.tenantId, num(a.chatId), ctx.userId ?? null, { kind: str(a.kind), ref: str(a.ref), linkType: a.linkType === 'created' ? 'created' : 'linked' }); if ('error' in r) throw new Error(r.error); return r; } },
  { tool: 'chats.unlink_ticket', mutates: true, description: 'Remove a chat ↔ ticket link.', parameters: obj({ chatId: N, kind: S, ref: S }, ['chatId', 'kind', 'ref']), run: async (ctx, a) => { const svc = new ChatTicketService(ctx.db, ctx.env as Env); const r = await svc.unlinkTicket(ctx.tenantId, num(a.chatId), ctx.userId ?? null, str(a.kind), str(a.ref)); if ('error' in r) throw new Error(r.error); return r; } },
  { tool: 'chats.ticket_lineage', mutates: false, description: 'List every Brain chat that references a work item — the lineage (which conversations shaped it, and which SPAWNED it). kind/ref identify the ticket.', parameters: obj({ kind: S, ref: S }, ['kind', 'ref']), run: async (ctx, a) => { const svc = new ChatTicketService(ctx.db, ctx.env as Env); return svc.listChatsForTicket(ctx.tenantId, str(a.kind), str(a.ref)); } },
  { tool: 'chats.consolidate', mutates: true, description: 'Merge one or more source Brain chats INTO a target chat: source messages are appended in time order, their ticket links + agent invites move to the target, and each source is archived and redirected to the target (so any ticket still resolves to the one surviving chat). Use to de-duplicate scattered conversations about the same work.', parameters: obj({ targetChatId: N, sourceChatIds: { type: 'array', items: N } }, ['targetChatId', 'sourceChatIds']), run: async (ctx, a) => { const svc = new ChatTicketService(ctx.db, ctx.env as Env); const ids = Array.isArray(a.sourceChatIds) ? (a.sourceChatIds as unknown[]).map((x) => num(x)) : []; const r = await svc.consolidate(ctx.tenantId, ctx.userId ?? null, { targetChatId: num(a.targetChatId), sourceChatIds: ids }); if ('error' in r) throw new Error(r.error); return r; } },
  { tool: 'chats.list_agents', mutates: false, description: 'List the agents invited into a Brain chat.', parameters: obj({ chatId: N }, ['chatId']), run: async (ctx, a) => { const svc = new ChatTicketService(ctx.db, ctx.env as Env); const r = await svc.listAgents(ctx.tenantId, num(a.chatId), ctx.userId ?? null); if ('error' in r) throw new Error(r.error); return r; } },
  { tool: 'chats.invite_agent', mutates: true, description: 'Invite an agent into a Brain chat as a participant (agentRef = cloud agent id / workforce ref). Once invited it can be tagged to take action; use chats.dispatch_agent to have it execute a linked ticket.', parameters: obj({ chatId: N, agentRef: S, agentKind: S, role: S }, ['chatId', 'agentRef']), run: async (ctx, a) => { const svc = new ChatTicketService(ctx.db, ctx.env as Env); const r = await svc.inviteAgent(ctx.tenantId, num(a.chatId), ctx.userId ?? null, { agentRef: str(a.agentRef), agentKind: a.agentKind != null ? str(a.agentKind) : undefined, role: a.role != null ? str(a.role) : undefined }); if ('error' in r) throw new Error(r.error); return r; } },
  {
    tool: 'chats.dispatch_agent', mutates: true,
    description: "Tag an invited agent to EXECUTE: assign it to a task/epic (typically one linked to the chat — see chats.list_tickets) and start a run immediately. Returns the started execution. Only task/epic tickets are runnable.",
    parameters: obj({ chatId: N, agentRef: S, taskId: N }, ['chatId', 'agentRef', 'taskId']),
    run: async (ctx, a) => {
      if (!ctx.env) throw new Error('dispatch unavailable in this context');
      const svc = new ChatTicketService(ctx.db, ctx.env);
      // Record the agent as a chat participant (idempotent).
      const invited = await svc.inviteAgent(ctx.tenantId, num(a.chatId), ctx.userId ?? null, { agentRef: str(a.agentRef) });
      if ('error' in invited) throw new Error(invited.error);
      // Assign the agent to the ticket, then start a run — reuses the real routes'
      // authz + the single cloud-run dispatcher (no duplicated dispatch logic).
      await replayRoute(ctx, 'PATCH', `/api/tasks/${num(a.taskId)}`, { assignedAgentRef: str(a.agentRef) });
      return replayRoute(ctx, 'POST', `/api/tasks/${num(a.taskId)}/run-now`, {});
    },
  },

  // ---- AI Manager: coaching (chat → standing directive) ----
  // Turns a "coaching session" (the human telling the manager how to manage) into a
  // durable directive the background manager pass honors on every run — the chat-side
  // twin of the Manager tab's coaching box. Same store, so guidance given in chat and
  // guidance given on the tab are one list.
  { tool: 'manager.coach', mutates: true,
    description: "Coach the AI Manager. mode='directive' (default) gives STANDING direction it honors on every backlog pass — e.g. 'focus the payments epic', 'hold merges on release/* until QA signs off' (scope='tenant' applies to EVERY project the manager runs; default 'project' applies to the given projectId only). mode='task' instead hands the manager ONE discrete task to execute once (owned by the designated manager, e.g. 'reorganize the payments epic and rank its backlog'). Use directive for how-to-manage guidance, task for a concrete one-off job.",
    parameters: obj({ projectId: N, directive: S, scope: { type: 'string', enum: ['project', 'tenant'] }, mode: { type: 'string', enum: ['directive', 'task'] } }, ['projectId', 'directive']),
    run: async (ctx, a) => {
      const projectId = num(a.projectId);
      if (a.mode === 'task') {
        if (!ctx.env) throw new Error('task mode requires the worker runtime');
        const taskId = await createManagerCoachingTask(ctx.env, ctx.db, buildRuntimeService(ctx.env, ctx.db), {
          tenantId: ctx.tenantId, projectId, directive: str(a.directive), createdBy: ctx.userId ?? null,
        });
        if (taskId == null) throw new Error('could not create manager task');
        return { mode: 'task', taskId, directive: str(a.directive) };
      }
      const scopeProjectId = a.scope === 'tenant' ? null : projectId;
      const id = await addManagerDirective(ctx.db, {
        tenantId: ctx.tenantId, projectId: scopeProjectId, directive: str(a.directive),
        createdBy: ctx.userId ?? null, source: 'chat',
      });
      if (!id) throw new Error('directive is too short');
      return { mode: 'directive', id, scope: scopeProjectId == null ? 'tenant' : 'project', directive: str(a.directive) };
    },
  },

  // ---- Agents: registered (read) + per-project + assignments ----
  // registered_agents.list mirrors the existing agents.list (the tenant `agents` table) under the
  // web Brain's domain name so the dispatch layer (keyed on domain.method) reaches it.
  { tool: 'registered_agents.list', mutates: false, description: 'List tenant-registered endpoint agents (claude/openai/ollama/http).', parameters: obj({}), run: (ctx) => ctx.db.select().from(agents).where(eq(agents.tenantId, ctx.tenantId)).limit(200) },
  // project_agents is tenant-scoped (NO segment_id).
  { tool: 'project_agents.list', mutates: false, description: 'List agents attached to a project.', parameters: obj({ projectId: N }, ['projectId']), run: (ctx, a) => ctx.db.select().from(projectAgents).where(and(eq(projectAgents.tenantId, ctx.tenantId), eq(projectAgents.projectId, num(a.projectId)))).limit(200) },
  {
    tool: 'project_agents.add', mutates: true,
    description: 'Attach an agent to a project. agentKind: workforce|registered.',
    parameters: obj({ projectId: N, agentKind: { type: 'string', enum: ['workforce', 'registered'] }, agentRef: S, name: S, role: S }, ['projectId', 'agentKind', 'agentRef', 'name']),
    run: async (ctx, a) => {
      await ctx.projects.getProject(num(a.projectId), ctx.tenantId); // tenant-ownership guard
      const [row] = await ctx.db.insert(projectAgents).values({ tenantId: ctx.tenantId, projectId: num(a.projectId), agentKind: str(a.agentKind), agentRef: str(a.agentRef), name: str(a.name), ...(a.role != null ? { role: str(a.role) } : {}) }).returning();
      return row;
    },
  },
  { tool: 'project_agents.remove', mutates: true, description: 'Detach an agent from a project.', parameters: obj({ id: N }, ['id']), run: async (ctx, a) => { const rows = await ctx.db.delete(projectAgents).where(and(eq(projectAgents.id, num(a.id)), eq(projectAgents.tenantId, ctx.tenantId))).returning({ id: projectAgents.id }); return { deleted: rows.length > 0 ? num(a.id) : null }; } },
  // agent_assignments is segment-scoped.
  { tool: 'agent_assignments.list', mutates: false, description: 'List agents assigned to a scope (project/workflow/security/swimlane/brain/global).', parameters: obj({ scope: S, scopeId: S }, ['scope']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const where = a.scopeId != null ? and(eq(agentAssignments.tenantId, ctx.tenantId), eq(agentAssignments.segmentId, seg), eq(agentAssignments.scope, str(a.scope)), eq(agentAssignments.scopeId, str(a.scopeId))) : and(eq(agentAssignments.tenantId, ctx.tenantId), eq(agentAssignments.segmentId, seg), eq(agentAssignments.scope, str(a.scope))); return ctx.db.select().from(agentAssignments).where(where).limit(200); } },
  {
    tool: 'agent_assignments.assign', mutates: true,
    description: 'Assign a registered agent to a scope (project/workflow/security/swimlane/brain/global).',
    parameters: obj({ agentKind: S, agentRef: S, scope: S, scopeId: S, role: S }, ['agentKind', 'agentRef', 'scope']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [row] = await ctx.db.insert(agentAssignments).values({ tenantId: ctx.tenantId, segmentId: seg, agentKind: str(a.agentKind), agentRef: str(a.agentRef), scope: str(a.scope), scopeId: a.scopeId != null ? str(a.scopeId) : null, ...(a.role != null ? { role: str(a.role) } : {}) }).returning();
      return row;
    },
  },
  { tool: 'agent_assignments.remove', mutates: true, description: 'Remove an agent assignment by id.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const rows = await ctx.db.delete(agentAssignments).where(and(eq(agentAssignments.id, str(a.id)), eq(agentAssignments.tenantId, ctx.tenantId), eq(agentAssignments.segmentId, seg))).returning({ id: agentAssignments.id }); return { deleted: rows.length > 0 ? str(a.id) : null }; } },

  // ---- Saved dashboards (segment-scoped) + widgets (tenant-scoped via parent dashboard) ----
  // data/query SKIPPED — they resolve metric values via computation, not a table read.
  { tool: 'dashboards.list', mutates: false, description: "List the workspace's saved dashboards (with their widgets).", parameters: obj({}), run: async (ctx) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const ds = await ctx.db.select().from(savedDashboards).where(and(eq(savedDashboards.tenantId, ctx.tenantId), eq(savedDashboards.segmentId, seg))).orderBy(desc(savedDashboards.updatedAt)).limit(200); const widgets = await ctx.db.select().from(dashboardWidgets).where(eq(dashboardWidgets.tenantId, ctx.tenantId)); return ds.map((d) => ({ ...d, widgets: widgets.filter((w) => w.dashboardId === d.id) })); } },
  {
    tool: 'dashboards.create', mutates: true,
    description: 'Create a saved dashboard.',
    parameters: obj({ name: S, isDefault: B }, ['name']),
    run: async (ctx, a) => {
      const name = str(a.name).trim(); if (!name) throw new Error('name is required');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [row] = await ctx.db.insert(savedDashboards).values({ tenantId: ctx.tenantId, segmentId: seg, name, ...(typeof a.isDefault === 'boolean' ? { isDefault: a.isDefault } : {}) }).returning();
      return row;
    },
  },
  {
    tool: 'dashboards.update', mutates: true,
    description: 'Rename a dashboard or set it as the default.',
    parameters: obj({ id: N, name: S, isDefault: B }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.name != null) patch.name = str(a.name);
      if (typeof a.isDefault === 'boolean') patch.isDefault = a.isDefault;
      const [row] = await ctx.db.update(savedDashboards).set(patch).where(and(eq(savedDashboards.id, num(a.id)), eq(savedDashboards.tenantId, ctx.tenantId), eq(savedDashboards.segmentId, seg))).returning();
      if (!row) throw new Error('dashboard not found');
      return row;
    },
  },
  { tool: 'dashboards.delete', mutates: true, description: 'Delete a saved dashboard (and its widgets).', parameters: obj({ id: N }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const [d] = await ctx.db.select({ id: savedDashboards.id }).from(savedDashboards).where(and(eq(savedDashboards.id, num(a.id)), eq(savedDashboards.tenantId, ctx.tenantId), eq(savedDashboards.segmentId, seg))).limit(1); if (!d) return { deleted: null }; await ctx.db.delete(dashboardWidgets).where(and(eq(dashboardWidgets.dashboardId, d.id), eq(dashboardWidgets.tenantId, ctx.tenantId))); await ctx.db.delete(savedDashboards).where(and(eq(savedDashboards.id, d.id), eq(savedDashboards.tenantId, ctx.tenantId), eq(savedDashboards.segmentId, seg))); return { deleted: num(a.id) }; } },
  {
    tool: 'dashboards.add_widget', mutates: true,
    description: 'Add a widget charting a whitelisted metric to a dashboard. viz: stat|bar|line|gauge.',
    parameters: obj({ dashboardId: N, metricKey: S, viz: { type: 'string', enum: ['stat', 'bar', 'line', 'gauge'] }, title: S, position: N }, ['dashboardId', 'metricKey']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [d] = await ctx.db.select({ id: savedDashboards.id }).from(savedDashboards).where(and(eq(savedDashboards.id, num(a.dashboardId)), eq(savedDashboards.tenantId, ctx.tenantId), eq(savedDashboards.segmentId, seg))).limit(1);
      if (!d) throw new Error('dashboard not found');
      const [row] = await ctx.db.insert(dashboardWidgets).values({ tenantId: ctx.tenantId, dashboardId: d.id, metricKey: str(a.metricKey), ...(a.viz != null ? { viz: str(a.viz) } : {}), title: a.title != null ? str(a.title) : null, ...(a.position != null ? { position: num(a.position) } : {}) }).returning();
      return row;
    },
  },
  {
    tool: 'dashboards.update_widget', mutates: true,
    description: 'Update a dashboard widget (metric, viz, title or position).',
    parameters: obj({ dashboardId: N, widgetId: N, metricKey: S, viz: { type: 'string', enum: ['stat', 'bar', 'line', 'gauge'] }, title: S, position: N }, ['dashboardId', 'widgetId']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [d] = await ctx.db.select({ id: savedDashboards.id }).from(savedDashboards).where(and(eq(savedDashboards.id, num(a.dashboardId)), eq(savedDashboards.tenantId, ctx.tenantId), eq(savedDashboards.segmentId, seg))).limit(1);
      if (!d) throw new Error('dashboard not found');
      const patch: Json = {};
      if (a.metricKey != null) patch.metricKey = str(a.metricKey);
      if (a.viz != null) patch.viz = str(a.viz);
      if (a.title != null) patch.title = str(a.title);
      if (a.position != null) patch.position = num(a.position);
      const [row] = await ctx.db.update(dashboardWidgets).set(patch).where(and(eq(dashboardWidgets.id, num(a.widgetId)), eq(dashboardWidgets.dashboardId, d.id), eq(dashboardWidgets.tenantId, ctx.tenantId))).returning();
      if (!row) throw new Error('widget not found');
      return row;
    },
  },
  { tool: 'dashboards.remove_widget', mutates: true, description: 'Remove a widget from a dashboard.', parameters: obj({ dashboardId: N, widgetId: N }, ['dashboardId', 'widgetId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const [d] = await ctx.db.select({ id: savedDashboards.id }).from(savedDashboards).where(and(eq(savedDashboards.id, num(a.dashboardId)), eq(savedDashboards.tenantId, ctx.tenantId), eq(savedDashboards.segmentId, seg))).limit(1); if (!d) return { deleted: null }; const rows = await ctx.db.delete(dashboardWidgets).where(and(eq(dashboardWidgets.id, num(a.widgetId)), eq(dashboardWidgets.dashboardId, d.id), eq(dashboardWidgets.tenantId, ctx.tenantId))).returning({ id: dashboardWidgets.id }); return { deleted: rows.length > 0 ? num(a.widgetId) : null }; } },

  // ---- Alerts (segment-scoped rules) + alert events (tenant-scoped) ----
  { tool: 'alerts.list', mutates: false, description: 'List threshold alert rules defined on platform metrics.', parameters: obj({}), run: async (ctx) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(alerts).where(and(eq(alerts.tenantId, ctx.tenantId), eq(alerts.segmentId, seg))).orderBy(desc(alerts.createdAt)).limit(200); } },
  {
    tool: 'alerts.create', mutates: true,
    description: 'Create a threshold alert rule. It fires when metric over windowDays satisfies comparator vs threshold. comparator: gt|lt|gte|lte; scopeKind: tenant|project|team.',
    parameters: obj({ name: S, metric: S, comparator: { type: 'string', enum: ['gt', 'lt', 'gte', 'lte'] }, threshold: N, windowDays: N, scopeKind: { type: 'string', enum: ['tenant', 'project', 'team'] }, notifySlack: B, notifyEmail: B }, ['name', 'metric', 'comparator', 'threshold']),
    run: async (ctx, a) => {
      const name = str(a.name).trim(); if (!name) throw new Error('name is required');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [row] = await ctx.db.insert(alerts).values({
        tenantId: ctx.tenantId, segmentId: seg, name, metric: str(a.metric), comparator: str(a.comparator), threshold: num(a.threshold),
        ...(a.windowDays != null ? { windowDays: num(a.windowDays) } : {}),
        ...(a.scopeKind != null ? { scopeKind: str(a.scopeKind) } : {}),
        ...(typeof a.notifySlack === 'boolean' ? { notifySlack: a.notifySlack } : {}),
        ...(typeof a.notifyEmail === 'boolean' ? { notifyEmail: a.notifyEmail } : {}),
      }).returning();
      return row;
    },
  },
  {
    tool: 'alerts.update', mutates: true,
    description: 'Update an alert rule (toggle enabled, change threshold/comparator/metric/window/scope/notify channels).',
    parameters: obj({ id: S, name: S, metric: S, comparator: { type: 'string', enum: ['gt', 'lt', 'gte', 'lte'] }, threshold: N, windowDays: N, scopeKind: { type: 'string', enum: ['tenant', 'project', 'team'] }, notifySlack: B, notifyEmail: B, enabled: B, cooldownHours: N }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.name != null) patch.name = str(a.name);
      if (a.metric != null) patch.metric = str(a.metric);
      if (a.comparator != null) patch.comparator = str(a.comparator);
      if (a.threshold != null) patch.threshold = num(a.threshold);
      if (a.windowDays != null) patch.windowDays = num(a.windowDays);
      if (a.scopeKind != null) patch.scopeKind = str(a.scopeKind);
      if (typeof a.notifySlack === 'boolean') patch.notifySlack = a.notifySlack;
      if (typeof a.notifyEmail === 'boolean') patch.notifyEmail = a.notifyEmail;
      if (typeof a.enabled === 'boolean') patch.enabled = a.enabled;
      if (a.cooldownHours != null) patch.cooldownHours = num(a.cooldownHours);
      const [row] = await ctx.db.update(alerts).set(patch).where(and(eq(alerts.id, str(a.id)), eq(alerts.tenantId, ctx.tenantId), eq(alerts.segmentId, seg))).returning();
      if (!row) throw new Error('alert not found');
      return row;
    },
  },
  { tool: 'alerts.delete', mutates: true, description: 'Delete an alert rule.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const rows = await ctx.db.delete(alerts).where(and(eq(alerts.id, str(a.id)), eq(alerts.tenantId, ctx.tenantId), eq(alerts.segmentId, seg))).returning({ id: alerts.id }); return { deleted: rows.length > 0 ? str(a.id) : null }; } },
  { tool: 'alerts.events', mutates: false, description: 'List recent alert firings (events), optionally filtered by status (triggered|acknowledged|resolved).', parameters: obj({ limit: N, status: { type: 'string', enum: ['triggered', 'acknowledged', 'resolved'] } }), run: (ctx, a) => { const where = a.status != null ? and(eq(alertEvents.tenantId, ctx.tenantId), eq(alertEvents.status, str(a.status))) : eq(alertEvents.tenantId, ctx.tenantId); return ctx.db.select().from(alertEvents).where(where).orderBy(desc(alertEvents.createdAt)).limit(a.limit != null ? num(a.limit) : 100); } },
  { tool: 'alerts.acknowledge', mutates: true, description: 'Acknowledge an alert firing (event).', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const [row] = await ctx.db.update(alertEvents).set({ status: 'acknowledged', acknowledgedAt: new Date() }).where(and(eq(alertEvents.id, str(a.id)), eq(alertEvents.tenantId, ctx.tenantId))).returning(); if (!row) throw new Error('alert event not found'); return row; } },

  // ---- Audit / activity (read from the unified activity_log stream) ----
  { tool: 'audit.list', mutates: false, description: 'List activity/audit events for the workspace (who did what, to what, when), optionally filtered by verb (e.g. "task.created", "user.login") / targetType (e.g. "task", "deployment").', parameters: obj({ limit: N, verb: S, targetType: S }), run: (ctx, a) => { const conds: SQL[] = [eq(activityLog.tenantId, ctx.tenantId)]; if (a.verb != null) conds.push(eq(activityLog.verb, str(a.verb))); if (a.targetType != null) conds.push(eq(activityLog.targetType, str(a.targetType))); return ctx.db.select().from(activityLog).where(and(...conds)).orderBy(desc(activityLog.id)).limit(a.limit != null ? num(a.limit) : 100); } },

  // ---- Workflow DEFINITIONS (design-time graphs) — distinct from the `workflows` (RUNS) table the
  //       workflows.list/get tools above read. New `workflow_definitions` domain to avoid name collision.
  //       Segment-scoped. (run / import_yaml SKIPPED — they dispatch executions / parse YAML, not table ops.) ----
  { tool: 'workflow_definitions.list', mutates: false, description: 'List workflow DEFINITIONS (the visually-authored agentic graphs; compact: id/name/projectId + snippet — the full node/edge graph is dropped here, read it with workflow_definitions.get), distinct from workflow runs. Capped by limit (default 50, max 200).', parameters: obj({ limit: N }), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const rows = await ctx.db.select().from(workflowDefinitions).where(and(eq(workflowDefinitions.tenantId, ctx.tenantId), eq(workflowDefinitions.segmentId, seg))).orderBy(desc(workflowDefinitions.updatedAt)).limit(LIST_MAX_LIMIT); return listEnvelope('workflowDefinitions', rows.map((r) => compactWorkflowDef(r as unknown as Record<string, unknown>)), clampLimit(a.limit)); } },
  { tool: 'workflow_definitions.get', mutates: false, description: 'Get one workflow definition (with its graph) by id.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return (await ctx.db.select().from(workflowDefinitions).where(and(eq(workflowDefinitions.id, str(a.id)), eq(workflowDefinitions.tenantId, ctx.tenantId), eq(workflowDefinitions.segmentId, seg))).limit(1))[0] ?? null; } },
  {
    tool: 'workflow_definitions.create', mutates: true,
    description: 'Create a workflow definition (name + optional description/project).',
    parameters: obj({ name: S, description: S, projectId: N }, ['name']),
    run: async (ctx, a) => {
      const name = str(a.name).trim(); if (!name) throw new Error('name is required');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      if (a.projectId != null) await ctx.projects.getProject(num(a.projectId), ctx.tenantId); // tenant-ownership guard
      const [row] = await ctx.db.insert(workflowDefinitions).values({ id: crypto.randomUUID(), tenantId: ctx.tenantId, segmentId: seg, name, description: a.description != null ? str(a.description) : null, projectId: a.projectId != null ? num(a.projectId) : null }).returning();
      return row;
    },
  },
  {
    tool: 'workflow_definitions.update', mutates: true,
    description: 'Update a workflow definition (name/description/project).',
    parameters: obj({ id: S, name: S, description: S, projectId: N }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.name != null) patch.name = str(a.name);
      if (a.description != null) patch.description = str(a.description);
      if (a.projectId != null) patch.projectId = num(a.projectId);
      const [row] = await ctx.db.update(workflowDefinitions).set(patch).where(and(eq(workflowDefinitions.id, str(a.id)), eq(workflowDefinitions.tenantId, ctx.tenantId), eq(workflowDefinitions.segmentId, seg))).returning();
      if (!row) throw new Error('workflow definition not found');
      return row;
    },
  },
  { tool: 'workflow_definitions.remove', mutates: true, description: 'Delete a workflow definition.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const rows = await ctx.db.delete(workflowDefinitions).where(and(eq(workflowDefinitions.id, str(a.id)), eq(workflowDefinitions.tenantId, ctx.tenantId), eq(workflowDefinitions.segmentId, seg))).returning({ id: workflowDefinitions.id }); return { deleted: rows.length > 0 ? str(a.id) : null }; } },

  // ---- Workflow RUNS (executions) — extends the existing workflows.list/get (the `workflows` table). ----
  { tool: 'workflow_runs.list', mutates: false, description: 'List workflow runs (executions), optionally filtered by status / project.', parameters: obj({ status: S, projectId: N }), run: (ctx, a) => { const conds: SQL[] = [eq(workflows.tenantId, ctx.tenantId)]; if (a.status != null) conds.push(eq(workflows.status, str(a.status) as never)); if (a.projectId != null) conds.push(eq(workflows.projectId, num(a.projectId))); return ctx.db.select().from(workflows).where(and(...conds)).orderBy(desc(workflows.createdAt)).limit(200); } },
  { tool: 'workflow_runs.get', mutates: false, description: 'Get a workflow run by id.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => (await ctx.db.select().from(workflows).where(and(eq(workflows.id, str(a.id)), eq(workflows.tenantId, ctx.tenantId))).limit(1))[0] ?? null },

  // ---- Cron jobs (write) — agentHost-owned schedules. The host association + sync live in the
  //       /api/agent-hosts/:id/cron route; here we persist the tenant-scoped cron_jobs row directly
  //       (segment-scoped). agentHostId is required (cron_jobs.agentHostId is NOT NULL). ----
  {
    tool: 'cron.create', mutates: true,
    description: 'Create a cron job (name + cron schedule) on an agent host.',
    parameters: obj({ agentHostId: N, name: S, schedule: S, taskId: N, projectId: N, enabled: B }, ['agentHostId', 'name', 'schedule']),
    run: async (ctx, a) => {
      const name = str(a.name).trim(); if (!name) throw new Error('name is required');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [row] = await ctx.db.insert(cronJobs).values({
        tenantId: ctx.tenantId, segmentId: seg, agentHostId: num(a.agentHostId), name, schedule: str(a.schedule),
        taskId: a.taskId != null ? num(a.taskId) : null,
        projectId: a.projectId != null ? num(a.projectId) : null,
        ...(typeof a.enabled === 'boolean' ? { enabled: a.enabled } : {}),
      }).returning();
      return row;
    },
  },
  {
    tool: 'cron.update', mutates: true,
    description: 'Update a cron job (name/schedule/enabled).',
    parameters: obj({ jobId: S, name: S, schedule: S, enabled: B }, ['jobId']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.name != null) patch.name = str(a.name);
      if (a.schedule != null) patch.schedule = str(a.schedule);
      if (typeof a.enabled === 'boolean') patch.enabled = a.enabled;
      const [row] = await ctx.db.update(cronJobs).set(patch).where(and(eq(cronJobs.id, str(a.jobId)), eq(cronJobs.tenantId, ctx.tenantId), eq(cronJobs.segmentId, seg))).returning();
      if (!row) throw new Error('cron job not found');
      return row;
    },
  },
  { tool: 'cron.delete', mutates: true, description: 'Delete a cron job by id.', parameters: obj({ jobId: S }, ['jobId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const rows = await ctx.db.delete(cronJobs).where(and(eq(cronJobs.id, str(a.jobId)), eq(cronJobs.tenantId, ctx.tenantId), eq(cronJobs.segmentId, seg))).returning({ id: cronJobs.id }); return { deleted: rows.length > 0 ? str(a.jobId) : null }; } },

  // ---- Cloud agents (CRUD) — `ide_agents` rows with project_id NULL. Tenant-scoped (NO
  //       segment_id; id is a client-generated UUID stored as text). create/update/delete
  //       are tenant-owned writes; list_mine/list_purchased read this tenant's view. ----
  { tool: 'cloud_agents.list_mine', mutates: false, description: "The workspace's own cloud agents (any publish state).", parameters: obj({}), run: (ctx) => ctx.db.select().from(ideAgents).where(eq(ideAgents.tenantId, ctx.tenantId)).orderBy(desc(ideAgents.createdAt)).limit(200) },
  { tool: 'cloud_agents.list_purchased', mutates: false, description: 'Cloud agents this workspace acquired from the marketplace.', parameters: obj({}), run: async (ctx) => (await ctx.db.execute(sql`SELECT a.* FROM ide_agents a JOIN agent_purchases p ON p.agent_id = a.id WHERE p.tenant_id = ${ctx.tenantId} AND p.unhired_at IS NULL AND a.status = 'active' ORDER BY p.created_at DESC LIMIT 200`)).rows },
  {
    tool: 'cloud_agents.create', mutates: true,
    description: 'Create a cloud agent. The engine is always the current agent version (no selection).',
    parameters: obj({ name: S, title: S, bio: S, skills: { type: 'array', items: S }, baseModel: S, published: B }, ['name']),
    run: async (ctx, a) => {
      const name = str(a.name).trim(); if (!name) throw new Error('name is required');
      const [row] = await ctx.db.insert(ideAgents).values({
        id: crypto.randomUUID(), tenantId: ctx.tenantId, projectId: null, name,
        title: a.title != null ? str(a.title) : name,
        bio: a.bio != null ? str(a.bio) : '',
        skills: JSON.stringify(Array.isArray(a.skills) ? a.skills : []),
        baseModel: a.baseModel != null ? str(a.baseModel) : 'builderforce-default',
        runtimeSurface: 'durable',
        ...(typeof a.published === 'boolean' ? { published: a.published } : {}),
      }).returning();
      return row;
    },
  },
  {
    tool: 'cloud_agents.update', mutates: true,
    description: 'Update a cloud agent (metadata or publish status).',
    parameters: obj({ agentId: S, name: S, title: S, bio: S, published: B, status: S }, ['agentId']),
    run: async (ctx, a) => {
      const patch: Json = { updatedAt: new Date() };
      if (a.name != null) patch.name = str(a.name);
      if (a.title != null) patch.title = str(a.title);
      if (a.bio != null) patch.bio = str(a.bio);
      if (typeof a.published === 'boolean') patch.published = a.published;
      if (a.status != null) patch.status = str(a.status);
      const [row] = await ctx.db.update(ideAgents).set(patch).where(and(eq(ideAgents.id, str(a.agentId)), eq(ideAgents.tenantId, ctx.tenantId))).returning();
      if (!row) throw new Error('agent not found');
      return row;
    },
  },
  { tool: 'cloud_agents.delete', mutates: true, description: 'Delete a cloud agent.', parameters: obj({ agentId: S }, ['agentId']), run: async (ctx, a) => { const rows = await ctx.db.delete(ideAgents).where(and(eq(ideAgents.id, str(a.agentId)), eq(ideAgents.tenantId, ctx.tenantId))).returning({ id: ideAgents.id }); return { deleted: rows.length > 0 ? str(a.agentId) : null }; } },

  // ---- Marketplace: published agents + skills (PUBLIC, world-readable registries) ----
  // agents_published is the cross-tenant marketplace view of ide_agents (published+active).
  // It is intentionally NOT tenant-scoped — it is the same public registry for everyone
  // (mirrors GET /api/workforce/agents). hire SKIPPED (purchase/billing flow).
  { tool: 'agents_published.list', mutates: false, description: 'List published workforce agents (the public marketplace registry).', parameters: obj({}), run: (ctx) => ctx.db.select().from(ideAgents).where(and(eq(ideAgents.published, true), eq(ideAgents.status, 'active'))).orderBy(desc(ideAgents.hireCount)).limit(200) },
  { tool: 'agents_published.get', mutates: false, description: 'Get a published marketplace agent by id.', parameters: obj({ agentId: S }, ['agentId']), run: async (ctx, a) => (await ctx.db.select().from(ideAgents).where(and(eq(ideAgents.id, str(a.agentId)), eq(ideAgents.published, true), eq(ideAgents.status, 'active'))).limit(1))[0] ?? null },
  // skills_marketplace is the public published-skills catalog (no tenant column).
  { tool: 'skills_marketplace.list', mutates: false, description: 'Browse published marketplace skills (public).', parameters: obj({ category: S, q: S, limit: N }), run: (ctx, a) => ctx.db.select().from(marketplaceSkills).where(a.category != null ? and(eq(marketplaceSkills.published, true), eq(marketplaceSkills.category, str(a.category))) : eq(marketplaceSkills.published, true)).orderBy(desc(marketplaceSkills.downloads)).limit(a.limit != null ? num(a.limit) : 100) },

  // ---- Artifact assignments (skill/persona/content → scope). Tenant-scoped (NO segment_id);
  //       composite PK (tenantId, artifactType, artifactSlug, scope, scopeId). ----
  { tool: 'artifact_assignments.list', mutates: false, description: 'List artifacts (skill/persona/content) assigned to a scope.', parameters: obj({ scope: S, scopeId: N, artifactType: { type: 'string', enum: ['skill', 'persona', 'content'] } }, ['scope', 'scopeId']), run: (ctx, a) => { const conds: SQL[] = [eq(artifactAssignments.tenantId, ctx.tenantId), eq(artifactAssignments.scope, str(a.scope) as never), eq(artifactAssignments.scopeId, num(a.scopeId))]; if (a.artifactType != null) conds.push(eq(artifactAssignments.artifactType, str(a.artifactType) as never)); return ctx.db.select().from(artifactAssignments).where(and(...conds)).limit(200); } },
  {
    tool: 'artifact_assignments.assign', mutates: true,
    description: 'Attach a skill/persona/content artifact to a scope.',
    parameters: obj({ artifactType: { type: 'string', enum: ['skill', 'persona', 'content'] }, artifactSlug: S, scope: S, scopeId: N, config: S }, ['artifactType', 'artifactSlug', 'scope', 'scopeId']),
    run: async (ctx, a) => {
      const [row] = await ctx.db.insert(artifactAssignments).values({ tenantId: ctx.tenantId, artifactType: str(a.artifactType) as never, artifactSlug: str(a.artifactSlug), scope: str(a.scope) as never, scopeId: num(a.scopeId), config: a.config != null ? str(a.config) : null }).onConflictDoUpdate({ target: [artifactAssignments.tenantId, artifactAssignments.artifactType, artifactAssignments.artifactSlug, artifactAssignments.scope, artifactAssignments.scopeId], set: { config: a.config != null ? str(a.config) : null } }).returning();
      return row;
    },
  },
  { tool: 'artifact_assignments.unassign', mutates: true, description: 'Detach an artifact from a scope.', parameters: obj({ artifactType: { type: 'string', enum: ['skill', 'persona', 'content'] }, artifactSlug: S, scope: S, scopeId: N }, ['artifactType', 'artifactSlug', 'scope', 'scopeId']), run: async (ctx, a) => { const rows = await ctx.db.delete(artifactAssignments).where(and(eq(artifactAssignments.tenantId, ctx.tenantId), eq(artifactAssignments.artifactType, str(a.artifactType) as never), eq(artifactAssignments.artifactSlug, str(a.artifactSlug)), eq(artifactAssignments.scope, str(a.scope) as never), eq(artifactAssignments.scopeId, num(a.scopeId)))).returning({ slug: artifactAssignments.artifactSlug }); return { deleted: rows.length > 0 ? str(a.artifactSlug) : null }; } },

  // ---- Governance (SOC 2) — soc_controls + soc_evidence. Both segment-scoped. The
  //       finops collision table was renamed to finops_soc_controls (mig 0254); these
  //       are the GOVERNANCE tables. seed SKIPPED (bulk control-set generation). ----
  { tool: 'governance_soc2.list_controls', mutates: false, description: 'List SOC 2 controls and their status.', parameters: obj({}), run: async (ctx) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(socControls).where(and(eq(socControls.tenantId, ctx.tenantId), eq(socControls.segmentId, seg))).orderBy(socControls.controlRef).limit(500); } },
  {
    tool: 'governance_soc2.patch_control', mutates: true,
    description: 'Update a SOC 2 control (status/owner/notes). status: not_started|in_progress|ready|out_of_scope.',
    parameters: obj({ id: S, status: { type: 'string', enum: ['not_started', 'in_progress', 'ready', 'out_of_scope'] }, ownerId: S, notes: S }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.status != null) patch.status = str(a.status);
      if (a.ownerId != null) patch.ownerId = str(a.ownerId);
      if (a.notes != null) patch.notes = str(a.notes);
      const [row] = await ctx.db.update(socControls).set(patch).where(and(eq(socControls.id, str(a.id)), eq(socControls.tenantId, ctx.tenantId), eq(socControls.segmentId, seg))).returning();
      if (!row) throw new Error('control not found');
      return row;
    },
  },
  {
    tool: 'governance_soc2.add_evidence', mutates: true,
    description: 'Attach evidence to a SOC 2 control (verified via the parent control, tenant+segment-scoped).',
    parameters: obj({ id: S, title: S, evidenceType: S, url: S, note: S }, ['id', 'title', 'evidenceType']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [control] = await ctx.db.select({ id: socControls.id }).from(socControls).where(and(eq(socControls.id, str(a.id)), eq(socControls.tenantId, ctx.tenantId), eq(socControls.segmentId, seg))).limit(1);
      if (!control) throw new Error('control not found');
      const [row] = await ctx.db.insert(socEvidence).values({ tenantId: ctx.tenantId, segmentId: seg, controlId: control.id, title: str(a.title), evidenceType: str(a.evidenceType), url: a.url != null ? str(a.url) : null, note: a.note != null ? str(a.note) : null }).returning();
      return row;
    },
  },

  // ---- Agile: planning poker — sessions + stories + votes. All segment-scoped; stories/votes
  //       are verified via their tenant+segment-scoped parent before any child write. ----
  { tool: 'poker.list_sessions', mutates: false, description: 'List planning-poker sessions.', parameters: obj({}), run: async (ctx) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(pokerSessions).where(and(eq(pokerSessions.tenantId, ctx.tenantId), eq(pokerSessions.segmentId, seg))).orderBy(desc(pokerSessions.updatedAt)).limit(200); } },
  {
    tool: 'poker.create_session', mutates: true,
    description: 'Create a planning-poker session. votingSystem: fibonacci|t_shirt|powers_of_2 (default fibonacci).',
    parameters: obj({ name: S, votingSystem: S }, ['name']),
    run: async (ctx, a) => {
      const name = str(a.name).trim(); if (!name) throw new Error('name is required');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [row] = await ctx.db.insert(pokerSessions).values({ tenantId: ctx.tenantId, segmentId: seg, name, ...(a.votingSystem != null ? { votingSystem: str(a.votingSystem) } : {}) }).returning();
      return row;
    },
  },
  { tool: 'poker.get_session', mutates: false, description: 'Get a poker session (with its stories).', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const [session] = await ctx.db.select().from(pokerSessions).where(and(eq(pokerSessions.id, str(a.id)), eq(pokerSessions.tenantId, ctx.tenantId), eq(pokerSessions.segmentId, seg))).limit(1); if (!session) return null; const stories = await ctx.db.select().from(pokerStories).where(and(eq(pokerStories.sessionId, session.id), eq(pokerStories.tenantId, ctx.tenantId), eq(pokerStories.segmentId, seg))).orderBy(pokerStories.position); return { ...session, stories }; } },
  {
    tool: 'poker.add_story', mutates: true,
    description: 'Add a story to a poker session.',
    parameters: obj({ sessionId: S, title: S, description: S }, ['sessionId', 'title']),
    run: async (ctx, a) => {
      const title = str(a.title).trim(); if (!title) throw new Error('title is required');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [session] = await ctx.db.select({ id: pokerSessions.id }).from(pokerSessions).where(and(eq(pokerSessions.id, str(a.sessionId)), eq(pokerSessions.tenantId, ctx.tenantId), eq(pokerSessions.segmentId, seg))).limit(1);
      if (!session) throw new Error('session not found');
      const [row] = await ctx.db.insert(pokerStories).values({ tenantId: ctx.tenantId, segmentId: seg, sessionId: session.id, title, description: a.description != null ? str(a.description) : null }).returning();
      return row;
    },
  },
  {
    tool: 'poker.vote', mutates: true,
    description: 'Cast a vote on a story (system user). One vote per story is kept (upsert by story).',
    parameters: obj({ storyId: S, value: S }, ['storyId', 'value']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [story] = await ctx.db.select({ id: pokerStories.id }).from(pokerStories).where(and(eq(pokerStories.id, str(a.storyId)), eq(pokerStories.tenantId, ctx.tenantId), eq(pokerStories.segmentId, seg))).limit(1);
      if (!story) throw new Error('story not found');
      const [row] = await ctx.db.insert(pokerVotes).values({ tenantId: ctx.tenantId, segmentId: seg, storyId: story.id, userId: 'system', value: str(a.value) }).returning();
      return row;
    },
  },
  {
    tool: 'poker.reveal', mutates: true,
    description: 'Reveal all votes on a story.',
    parameters: obj({ storyId: S }, ['storyId']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [story] = await ctx.db.select({ id: pokerStories.id }).from(pokerStories).where(and(eq(pokerStories.id, str(a.storyId)), eq(pokerStories.tenantId, ctx.tenantId), eq(pokerStories.segmentId, seg))).limit(1);
      if (!story) throw new Error('story not found');
      await ctx.db.update(pokerVotes).set({ isRevealed: true, updatedAt: new Date() }).where(and(eq(pokerVotes.storyId, story.id), eq(pokerVotes.tenantId, ctx.tenantId), eq(pokerVotes.segmentId, seg)));
      return { revealed: str(a.storyId) };
    },
  },

  // ---- Agile: retrospectives — retros + items. Both segment-scoped; items verified via parent. ----
  { tool: 'retro.list', mutates: false, description: 'List retrospectives.', parameters: obj({}), run: async (ctx) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(retrospectives).where(and(eq(retrospectives.tenantId, ctx.tenantId), eq(retrospectives.segmentId, seg))).orderBy(desc(retrospectives.updatedAt)).limit(200); } },
  {
    tool: 'retro.create', mutates: true,
    description: 'Create a retrospective. template: start_stop_continue|mad_sad_glad|4ls (default start_stop_continue).',
    parameters: obj({ name: S, template: S }, ['name']),
    run: async (ctx, a) => {
      const name = str(a.name).trim(); if (!name) throw new Error('name is required');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [row] = await ctx.db.insert(retrospectives).values({ tenantId: ctx.tenantId, segmentId: seg, name, ...(a.template != null ? { template: str(a.template) } : {}) }).returning();
      return row;
    },
  },
  { tool: 'retro.get', mutates: false, description: 'Get a retrospective (with its items).', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const [retro] = await ctx.db.select().from(retrospectives).where(and(eq(retrospectives.id, str(a.id)), eq(retrospectives.tenantId, ctx.tenantId), eq(retrospectives.segmentId, seg))).limit(1); if (!retro) return null; const items = await ctx.db.select().from(retroItems).where(and(eq(retroItems.retroId, retro.id), eq(retroItems.tenantId, ctx.tenantId), eq(retroItems.segmentId, seg))).orderBy(desc(retroItems.createdAt)); return { ...retro, items }; } },
  {
    tool: 'retro.add_item', mutates: true,
    description: 'Add an item to a retrospective (category matches the template column, e.g. start/stop/continue).',
    parameters: obj({ retroId: S, category: S, content: S }, ['retroId', 'category', 'content']),
    run: async (ctx, a) => {
      const content = str(a.content).trim(); if (!content) throw new Error('content is required');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [retro] = await ctx.db.select({ id: retrospectives.id }).from(retrospectives).where(and(eq(retrospectives.id, str(a.retroId)), eq(retrospectives.tenantId, ctx.tenantId), eq(retrospectives.segmentId, seg))).limit(1);
      if (!retro) throw new Error('retro not found');
      const [row] = await ctx.db.insert(retroItems).values({ tenantId: ctx.tenantId, segmentId: seg, retroId: retro.id, category: str(a.category), content }).returning();
      return row;
    },
  },

  // ---- External board connections (Jira/GitHub PM sync). Segment-scoped. sync SKIPPED
  //       (triggers an external provider sync, a side-effect; not a table op). ----
  { tool: 'board_connections.list', mutates: false, description: 'List external board connections (Jira/GitHub PM sync), optionally by project.', parameters: obj({ projectId: N }), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const conds: SQL[] = [eq(boardConnections.tenantId, ctx.tenantId), eq(boardConnections.segmentId, seg)]; if (a.projectId != null) conds.push(eq(boardConnections.projectId, num(a.projectId))); return ctx.db.select().from(boardConnections).where(and(...conds)).orderBy(desc(boardConnections.createdAt)).limit(200); } },
  {
    tool: 'board_connections.create', mutates: true,
    description: 'Create an external board connection on a project.',
    parameters: obj({ projectId: N, provider: S, credentialId: S, externalBoardId: S }, ['projectId', 'provider']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      await ctx.projects.getProject(num(a.projectId), ctx.tenantId); // tenant-ownership guard
      const [row] = await ctx.db.insert(boardConnections).values({ tenantId: ctx.tenantId, segmentId: seg, projectId: num(a.projectId), provider: str(a.provider), credentialId: a.credentialId != null ? str(a.credentialId) : null, externalBoardId: a.externalBoardId != null ? str(a.externalBoardId) : null }).returning();
      return row;
    },
  },
  {
    tool: 'board_connections.update', mutates: true,
    description: 'Update an external board connection (status/externalBoardId).',
    parameters: obj({ id: S, status: S, externalBoardId: S }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.status != null) patch.status = str(a.status);
      if (a.externalBoardId != null) patch.externalBoardId = str(a.externalBoardId);
      const [row] = await ctx.db.update(boardConnections).set(patch).where(and(eq(boardConnections.id, str(a.id)), eq(boardConnections.tenantId, ctx.tenantId), eq(boardConnections.segmentId, seg))).returning();
      if (!row) throw new Error('board connection not found');
      return row;
    },
  },
  { tool: 'board_connections.remove', mutates: true, description: 'Delete an external board connection.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const rows = await ctx.db.delete(boardConnections).where(and(eq(boardConnections.id, str(a.id)), eq(boardConnections.tenantId, ctx.tenantId), eq(boardConnections.segmentId, seg))).returning({ id: boardConnections.id }); return { deleted: rows.length > 0 ? str(a.id) : null }; } },

  // ---- Repos (project_repositories) + pull_requests. Both segment-scoped. These are plain
  //       table rows (the git/provider calls happen on separate routes). ----
  { tool: 'repos.list', mutates: false, description: 'List git repositories linked to a project.', parameters: obj({ projectId: N }, ['projectId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(projectRepositories).where(and(eq(projectRepositories.tenantId, ctx.tenantId), eq(projectRepositories.segmentId, seg), eq(projectRepositories.projectId, num(a.projectId)))).orderBy(desc(projectRepositories.createdAt)).limit(200); } },
  { tool: 'repos.list_pull_requests', mutates: false, description: 'List pull requests for a project.', parameters: obj({ projectId: N }, ['projectId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(pullRequests).where(and(eq(pullRequests.tenantId, ctx.tenantId), eq(pullRequests.segmentId, seg), eq(pullRequests.projectId, num(a.projectId)))).orderBy(desc(pullRequests.createdAt)).limit(200); } },
  {
    tool: 'repos.add', mutates: true,
    description: 'Link a git repository to a project (a plain catalog row). provider: github|gitlab|bitbucket. Pass credentialId to bind an access key.',
    parameters: obj({ projectId: N, provider: S, owner: S, repo: S, defaultBranch: S, isDefault: B, credentialId: S }, ['projectId', 'provider', 'owner', 'repo']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      await ctx.projects.getProject(num(a.projectId), ctx.tenantId); // tenant-ownership guard
      const [row] = await ctx.db.insert(projectRepositories).values({ tenantId: ctx.tenantId, segmentId: seg, projectId: num(a.projectId), provider: str(a.provider), owner: str(a.owner), repo: str(a.repo), defaultBranch: a.defaultBranch != null ? str(a.defaultBranch) : null, ...(typeof a.isDefault === 'boolean' ? { isDefault: a.isDefault } : {}), credentialId: a.credentialId != null ? str(a.credentialId) : null }).returning();
      return row;
    },
  },
  {
    tool: 'repos.update', mutates: true,
    description: 'Update a linked repository (defaultBranch/isDefault/credentialId).',
    parameters: obj({ id: S, defaultBranch: S, isDefault: B, credentialId: S }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.defaultBranch != null) patch.defaultBranch = str(a.defaultBranch);
      if (typeof a.isDefault === 'boolean') patch.isDefault = a.isDefault;
      if (a.credentialId != null) patch.credentialId = str(a.credentialId);
      const [row] = await ctx.db.update(projectRepositories).set(patch).where(and(eq(projectRepositories.id, str(a.id)), eq(projectRepositories.tenantId, ctx.tenantId), eq(projectRepositories.segmentId, seg))).returning();
      if (!row) throw new Error('repository not found');
      return row;
    },
  },
  {
    tool: 'repos.set_default', mutates: true,
    description: 'Mark a repository as the project default (clears the flag on the project’s other repos).',
    parameters: obj({ id: S }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [repo] = await ctx.db.select({ id: projectRepositories.id, projectId: projectRepositories.projectId }).from(projectRepositories).where(and(eq(projectRepositories.id, str(a.id)), eq(projectRepositories.tenantId, ctx.tenantId), eq(projectRepositories.segmentId, seg))).limit(1);
      if (!repo) throw new Error('repository not found');
      await ctx.db.update(projectRepositories).set({ isDefault: false, updatedAt: new Date() }).where(and(eq(projectRepositories.tenantId, ctx.tenantId), eq(projectRepositories.segmentId, seg), eq(projectRepositories.projectId, repo.projectId)));
      const [row] = await ctx.db.update(projectRepositories).set({ isDefault: true, updatedAt: new Date() }).where(and(eq(projectRepositories.id, repo.id), eq(projectRepositories.tenantId, ctx.tenantId), eq(projectRepositories.segmentId, seg))).returning();
      return row;
    },
  },
  { tool: 'repos.remove', mutates: true, description: 'Unlink a repository.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const rows = await ctx.db.delete(projectRepositories).where(and(eq(projectRepositories.id, str(a.id)), eq(projectRepositories.tenantId, ctx.tenantId), eq(projectRepositories.segmentId, seg))).returning({ id: projectRepositories.id }); return { deleted: rows.length > 0 ? str(a.id) : null }; } },

  // ---- Chat sessions (agent-host messaging) — chat_sessions + chat_messages. Segment-scoped.
  //       provider_keys.list / my_sessions / channels / embed are handled below or SKIPPED. ----
  { tool: 'chat_sessions.list', mutates: false, description: 'List chat sessions on an agent host.', parameters: obj({ agentHostId: N }, ['agentHostId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(chatSessions).where(and(eq(chatSessions.tenantId, ctx.tenantId), eq(chatSessions.segmentId, seg), eq(chatSessions.agentHostId, num(a.agentHostId)))).orderBy(desc(chatSessions.startedAt)).limit(200); } },
  { tool: 'chat_sessions.list_all', mutates: false, description: 'Recent chat sessions across the workspace.', parameters: obj({ limit: N }), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(chatSessions).where(and(eq(chatSessions.tenantId, ctx.tenantId), eq(chatSessions.segmentId, seg))).orderBy(desc(chatSessions.startedAt)).limit(a.limit != null ? num(a.limit) : 100); } },
  { tool: 'chat_sessions.get_messages', mutates: false, description: 'Messages in a chat session (verified via the tenant+segment-scoped parent session).', parameters: obj({ sessionId: N, limit: N }, ['sessionId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const [session] = await ctx.db.select({ id: chatSessions.id }).from(chatSessions).where(and(eq(chatSessions.id, num(a.sessionId)), eq(chatSessions.tenantId, ctx.tenantId), eq(chatSessions.segmentId, seg))).limit(1); if (!session) return []; return ctx.db.select().from(chatMessages).where(and(eq(chatMessages.sessionId, session.id), eq(chatMessages.tenantId, ctx.tenantId), eq(chatMessages.segmentId, seg))).orderBy(chatMessages.seq).limit(a.limit != null ? num(a.limit) : 100); } },

  // ---- Provider keys (read only — which LLM providers are configured; NEVER returns the
  //       secret key material). Backed by the raw-SQL tenant_llm_provider_keys table. ----
  { tool: 'provider_keys.list', mutates: false, description: 'Which LLM providers the workspace has a key configured for (no secrets returned).', parameters: obj({}), run: async (ctx) => (await ctx.db.execute(sql`SELECT provider, auth_type FROM tenant_llm_provider_keys WHERE tenant_id = ${ctx.tenantId}`)).rows },

  // ---- Embed config — stored on tenants.settings.embed (JSON-as-text). Read + write the
  //       embed slice only, leaving the rest of the settings blob untouched. ----
  { tool: 'embed.get_config', mutates: false, description: 'Get the workspace embed configuration (enabled + capabilities).', parameters: obj({}), run: async (ctx) => { const [row] = await ctx.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1); const settings = parseTenantSettings(row?.settings); const embed = (settings.embed ?? {}) as Json; return { enabled: embed.enabled === true, capabilities: Array.isArray(embed.capabilities) ? embed.capabilities : [] }; } },
  {
    tool: 'embed.set_config', mutates: true,
    description: 'Enable/disable embed + set capabilities. capabilities is a subset of product|agile|security.',
    parameters: obj({ enabled: B, capabilities: { type: 'array', items: { type: 'string', enum: ['product', 'agile', 'security'] } }, consentAcknowledged: B }, ['enabled', 'capabilities']),
    run: async (ctx, a) => {
      const [row] = await ctx.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1);
      if (!row) throw new Error('tenant not found');
      const settings = parseTenantSettings(row.settings);
      const enabled = a.enabled === true;
      const capabilities = (Array.isArray(a.capabilities) ? a.capabilities : []).map(str).filter((c) => ['product', 'agile', 'security'].includes(c));
      settings.embed = { ...(typeof settings.embed === 'object' && settings.embed != null ? settings.embed : {}), enabled, capabilities, ...(a.consentAcknowledged === true ? { consentedAt: new Date().toISOString() } : {}) };
      await ctx.db.update(tenants).set({ settings: JSON.stringify(settings), updatedAt: new Date() }).where(eq(tenants.id, ctx.tenantId));
      return { enabled, capabilities };
    },
  },

  // ---- Autonomous boards + swimlanes + swimlane agents. All segment-scoped; child writes
  //       are verified through their tenant+segment-scoped parent. boards.dispatches SKIPPED
  //       (computed live per-agent status across ticket_runs/agent_dispatches, not a table read). ----
  { tool: 'boards.get', mutates: false, description: 'Get an autonomous board (with its swimlanes).', parameters: obj({ boardId: S }, ['boardId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const [board] = await ctx.db.select().from(boards).where(and(eq(boards.id, str(a.boardId)), eq(boards.tenantId, ctx.tenantId), eq(boards.segmentId, seg))).limit(1); if (!board) return null; const lanes = await ctx.db.select().from(swimlanes).where(and(eq(swimlanes.boardId, board.id), eq(swimlanes.tenantId, ctx.tenantId), eq(swimlanes.segmentId, seg))).orderBy(swimlanes.position); return { ...board, swimlanes: lanes }; } },
  {
    tool: 'boards.create', mutates: true,
    description: 'Find-or-create the autonomous board for a project (one board per project — returns the existing board if one already exists).',
    parameters: obj({ projectId: N, name: S, maxConcurrentTickets: N }, ['projectId', 'name']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      await ctx.projects.getProject(num(a.projectId), ctx.tenantId); // tenant-ownership guard
      const [existing] = await ctx.db.select().from(boards).where(and(eq(boards.projectId, num(a.projectId)), eq(boards.tenantId, ctx.tenantId), eq(boards.segmentId, seg))).limit(1);
      if (existing) return existing;
      const [row] = await ctx.db.insert(boards).values({ tenantId: ctx.tenantId, segmentId: seg, projectId: num(a.projectId), name: str(a.name), ...(a.maxConcurrentTickets != null ? { maxConcurrentTickets: num(a.maxConcurrentTickets) } : {}) }).returning();
      return row;
    },
  },
  {
    tool: 'boards.update', mutates: true,
    description: 'Update a board (name/maxConcurrentTickets).',
    parameters: obj({ boardId: S, name: S, maxConcurrentTickets: N }, ['boardId']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.name != null) patch.name = str(a.name);
      if (a.maxConcurrentTickets != null) patch.maxConcurrentTickets = num(a.maxConcurrentTickets);
      const [row] = await ctx.db.update(boards).set(patch).where(and(eq(boards.id, str(a.boardId)), eq(boards.tenantId, ctx.tenantId), eq(boards.segmentId, seg))).returning();
      if (!row) throw new Error('board not found');
      return row;
    },
  },
  { tool: 'boards.remove', mutates: true, description: 'Delete a board.', parameters: obj({ boardId: S }, ['boardId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const rows = await ctx.db.delete(boards).where(and(eq(boards.id, str(a.boardId)), eq(boards.tenantId, ctx.tenantId), eq(boards.segmentId, seg))).returning({ id: boards.id }); return { deleted: rows.length > 0 ? str(a.boardId) : null }; } },

  { tool: 'swimlanes.list', mutates: false, description: "List a board's swimlanes.", parameters: obj({ boardId: S }, ['boardId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const [board] = await ctx.db.select({ id: boards.id }).from(boards).where(and(eq(boards.id, str(a.boardId)), eq(boards.tenantId, ctx.tenantId), eq(boards.segmentId, seg))).limit(1); if (!board) return []; return ctx.db.select().from(swimlanes).where(and(eq(swimlanes.boardId, board.id), eq(swimlanes.tenantId, ctx.tenantId), eq(swimlanes.segmentId, seg))).orderBy(swimlanes.position); } },
  {
    tool: 'swimlanes.create', mutates: true,
    description: 'Create a swimlane (stage) on a board.',
    parameters: obj({ boardId: S, key: S, name: S, position: N }, ['boardId', 'key', 'name']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [board] = await ctx.db.select({ id: boards.id }).from(boards).where(and(eq(boards.id, str(a.boardId)), eq(boards.tenantId, ctx.tenantId), eq(boards.segmentId, seg))).limit(1);
      if (!board) throw new Error('board not found');
      const [row] = await ctx.db.insert(swimlanes).values({ tenantId: ctx.tenantId, segmentId: seg, boardId: board.id, key: str(a.key), name: str(a.name), ...(a.position != null ? { position: num(a.position) } : {}) }).returning();
      return row;
    },
  },
  { tool: 'swimlanes.remove', mutates: true, description: 'Delete a swimlane.', parameters: obj({ boardId: S, laneId: S }, ['boardId', 'laneId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const [board] = await ctx.db.select({ id: boards.id }).from(boards).where(and(eq(boards.id, str(a.boardId)), eq(boards.tenantId, ctx.tenantId), eq(boards.segmentId, seg))).limit(1); if (!board) return { deleted: null }; const rows = await ctx.db.delete(swimlanes).where(and(eq(swimlanes.id, str(a.laneId)), eq(swimlanes.boardId, board.id), eq(swimlanes.tenantId, ctx.tenantId), eq(swimlanes.segmentId, seg))).returning({ id: swimlanes.id }); return { deleted: rows.length > 0 ? str(a.laneId) : null }; } },

  { tool: 'swimlane_agents.list', mutates: false, description: 'Agents assigned to a swimlane.', parameters: obj({ boardId: S, laneId: S }, ['boardId', 'laneId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const [lane] = await ctx.db.select({ id: swimlanes.id }).from(swimlanes).innerJoin(boards, eq(swimlanes.boardId, boards.id)).where(and(eq(swimlanes.id, str(a.laneId)), eq(boards.id, str(a.boardId)), eq(swimlanes.tenantId, ctx.tenantId), eq(swimlanes.segmentId, seg))).limit(1); if (!lane) return []; return ctx.db.select().from(swimlaneAgentAssignments).where(and(eq(swimlaneAgentAssignments.swimlaneId, lane.id), eq(swimlaneAgentAssignments.tenantId, ctx.tenantId), eq(swimlaneAgentAssignments.segmentId, seg))).orderBy(swimlaneAgentAssignments.position); } },
  {
    tool: 'swimlane_agents.create', mutates: true,
    description: 'Assign an agent to a swimlane. agentKind: workforce|registered.',
    parameters: obj({ boardId: S, laneId: S, agentKind: { type: 'string', enum: ['workforce', 'registered'] }, agentRef: S, role: S, model: S }, ['boardId', 'laneId', 'agentKind', 'agentRef']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [lane] = await ctx.db.select({ id: swimlanes.id }).from(swimlanes).innerJoin(boards, eq(swimlanes.boardId, boards.id)).where(and(eq(swimlanes.id, str(a.laneId)), eq(boards.id, str(a.boardId)), eq(swimlanes.tenantId, ctx.tenantId), eq(swimlanes.segmentId, seg))).limit(1);
      if (!lane) throw new Error('swimlane not found');
      const [row] = await ctx.db.insert(swimlaneAgentAssignments).values({ tenantId: ctx.tenantId, segmentId: seg, swimlaneId: lane.id, agentKind: str(a.agentKind), agentRef: str(a.agentRef), role: a.role != null ? str(a.role) : 'agent', ...(a.model != null ? { model: str(a.model) } : {}) }).returning();
      return row;
    },
  },
  { tool: 'swimlane_agents.remove', mutates: true, description: 'Unassign an agent from a swimlane.', parameters: obj({ boardId: S, laneId: S, id: S }, ['boardId', 'laneId', 'id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const [lane] = await ctx.db.select({ id: swimlanes.id }).from(swimlanes).innerJoin(boards, eq(swimlanes.boardId, boards.id)).where(and(eq(swimlanes.id, str(a.laneId)), eq(boards.id, str(a.boardId)), eq(swimlanes.tenantId, ctx.tenantId), eq(swimlanes.segmentId, seg))).limit(1); if (!lane) return { deleted: null }; const rows = await ctx.db.delete(swimlaneAgentAssignments).where(and(eq(swimlaneAgentAssignments.id, str(a.id)), eq(swimlaneAgentAssignments.swimlaneId, lane.id), eq(swimlaneAgentAssignments.tenantId, ctx.tenantId), eq(swimlaneAgentAssignments.segmentId, seg))).returning({ id: swimlaneAgentAssignments.id }); return { deleted: rows.length > 0 ? str(a.id) : null }; } },

  // ---- Integrations + Platform migration (Jira/Monday/Rally/GitLab/Bitbucket/GitHub → BuilderForce) ----
  // The Brain can drive the whole "connect → test → migrate" flow: create a
  // credential, validate it, then discover→map→stage→commit a migration run.
  { tool: 'integrations.providers', mutates: false, description: 'List external systems that can be connected/migrated, with which support the migration wizard (discovery).', parameters: obj({}), run: async () => ({ providers: BOARD_PROVIDERS, migratable: DISCOVERY_PROVIDER_IDS }) },
  { tool: 'integrations.list', mutates: false, description: 'List this workspace\'s integration credentials (no secrets).', parameters: obj({}), run: (ctx) => ctx.db.select({ id: integrationCredentials.id, provider: integrationCredentials.provider, name: integrationCredentials.name, baseUrl: integrationCredentials.baseUrl, lastTestOk: integrationCredentials.lastTestOk, lastTestedAt: integrationCredentials.lastTestedAt }).from(integrationCredentials).where(eq(integrationCredentials.tenantId, ctx.tenantId)).orderBy(desc(integrationCredentials.createdAt)).limit(200) },
  {
    tool: 'integrations.create_credential', mutates: true,
    description: 'Store an encrypted integration credential (e.g. connect Bitbucket with an access token). credentials is a provider-specific bag — e.g. Jira {email,apiToken}+baseUrl; GitHub/Bitbucket/GitLab {accessToken}; monday/ClickUp {token}.',
    parameters: obj({ provider: S, name: S, baseUrl: S, credentials: { type: 'object' } }, ['provider', 'name', 'credentials']),
    run: async (ctx, a) => {
      const env = requireEnv(ctx);
      const secret = env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET;
      const { enc, iv } = await encryptCredentials(a.credentials as Record<string, unknown>, secret, ctx.tenantId);
      const [row] = await ctx.db.insert(integrationCredentials).values({ tenantId: ctx.tenantId, provider: str(a.provider) as never, name: str(a.name).trim(), baseUrl: a.baseUrl != null ? str(a.baseUrl) : null, credentialsEnc: enc, iv, isEnabled: true }).returning({ id: integrationCredentials.id, provider: integrationCredentials.provider, name: integrationCredentials.name });
      return row;
    },
  },
  {
    tool: 'integrations.test', mutates: true,
    description: 'Validate/test a stored integration credential by connecting to the provider. Returns { ok, message, projectCount? }.',
    parameters: obj({ credentialId: S }, ['credentialId']),
    run: async (ctx, a) => {
      const env = requireEnv(ctx);
      const [cred] = await ctx.db.select().from(integrationCredentials).where(and(eq(integrationCredentials.id, str(a.credentialId)), eq(integrationCredentials.tenantId, ctx.tenantId))).limit(1);
      if (!cred) throw new Error('Integration credential not found');
      const factory = await buildMigrationProviderFactory(ctx.db, env, ctx.tenantId, cred.provider, cred.id);
      if (!factory) { await markTested(ctx, cred.id, false); return { ok: false, message: 'Could not load credential' }; }
      try {
        const provider = factory(null);
        let projectCount: number | undefined;
        if (typeof provider.discover === 'function') projectCount = (await provider.discover()).projects.length;
        else await provider.fetchTicketsSince(null);
        await markTested(ctx, cred.id, true);
        return { ok: true, message: 'Connected', ...(projectCount != null ? { projectCount } : {}) };
      } catch (e) {
        await markTested(ctx, cred.id, false);
        return { ok: false, message: e instanceof Error ? e.message : 'Connection failed' };
      }
    },
  },
  {
    tool: 'migrations.start', mutates: true,
    description: 'Start a migration run: discover an external system\'s projects, item types and users into staging (nothing is imported yet). mode: migrate (one-time) | sync (ongoing) | both.',
    parameters: obj({ provider: S, credentialId: S, mode: S }, ['provider', 'credentialId']),
    run: async (ctx, a) => {
      const env = requireEnv(ctx);
      if (!DISCOVERY_PROVIDER_IDS.includes(str(a.provider))) throw new Error(`Migration is available for: ${DISCOVERY_PROVIDER_IDS.join(', ')}`);
      const factory = await buildMigrationProviderFactory(ctx.db, env, ctx.tenantId, str(a.provider), str(a.credentialId));
      if (!factory) throw new Error('Could not load integration credentials');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const svc = new MigrationService(createMigrationStore(ctx.db));
      const mode = (['migrate', 'sync', 'both'] as ImportMode[]).includes(a.mode as ImportMode) ? (a.mode as ImportMode) : 'both';
      return svc.startRun({ tenantId: ctx.tenantId, segmentId: seg, provider: str(a.provider), credentialId: str(a.credentialId), mode, createdBy: ctx.userId ?? null }, factory(null));
    },
  },
  { tool: 'migrations.list', mutates: false, description: 'List migration runs (history) for the workspace.', parameters: obj({}), run: (ctx) => new MigrationService(createMigrationStore(ctx.db)).listRuns(ctx.tenantId) },
  { tool: 'migrations.get', mutates: false, description: 'Get the full staging snapshot of a migration run (projects, item types, users, staged items).', parameters: obj({ id: S }, ['id']), run: (ctx, a) => new MigrationService(createMigrationStore(ctx.db)).getDetail(str(a.id), ctx.tenantId) },
  {
    tool: 'migrations.set_mappings', mutates: true,
    description: 'Set project (create/map/skip — map several external projects to the same BF project to COMBINE), item-type, user (invite/map/skip) and item-include mappings for a run.',
    parameters: obj({ id: S, projects: { type: 'array' }, types: { type: 'array' }, users: { type: 'array' }, items: { type: 'array' } }, ['id']),
    run: (ctx, a) => new MigrationService(createMigrationStore(ctx.db)).setMappings(str(a.id), ctx.tenantId, { projects: a.projects as never, types: a.types as never, users: a.users as never, items: a.items as never }),
  },
  {
    tool: 'migrations.stage', mutates: true,
    description: 'Pull the items for every non-skipped project into staging so they can be reviewed before import.',
    parameters: obj({ id: S }, ['id']),
    run: async (ctx, a) => {
      const env = requireEnv(ctx);
      const svc = new MigrationService(createMigrationStore(ctx.db));
      const detail = await svc.getDetail(str(a.id), ctx.tenantId);
      if (!detail) throw new Error('Migration run not found');
      const factory = await buildMigrationProviderFactory(ctx.db, env, ctx.tenantId, detail.run.provider, detail.run.credentialId);
      if (!factory) throw new Error('Could not load integration credentials');
      return svc.stageItems(str(a.id), ctx.tenantId, factory);
    },
  },
  {
    tool: 'migrations.commit', mutates: true,
    description: 'Promote the staged data into real projects/tasks/members (and create ongoing sync connections when mode includes sync). This is the irreversible import step.',
    parameters: obj({ id: S }, ['id']),
    run: async (ctx, a) => {
      const env = requireEnv(ctx);
      const svc = new MigrationService(createMigrationStore(ctx.db));
      const detail = await svc.getDetail(str(a.id), ctx.tenantId);
      if (!detail) throw new Error('Migration run not found');
      const factory = await buildMigrationProviderFactory(ctx.db, env, ctx.tenantId, detail.run.provider, detail.run.credentialId);
      if (!factory) throw new Error('Could not load integration credentials');
      return svc.commit(str(a.id), ctx.tenantId, factory);
    },
  },

  // ---- Web (server-side fetch) — read an external URL behind the SSRF guard and return its
  //       readable text. No DB; delegates to fetchWebDocument (assertSafeUrl + HTML→text + size cap).
  //       The browser Brain can't fetch cross-origin URLs (CORS), so the gateway does it here. ----
  { tool: 'web.fetch', mutates: false, description: 'Read an external URL, file, or website (e.g. a GitHub file like https://github.com/owner/repo/blob/main/ROADMAP.md, a docs page, or an article). The platform fetches it server-side and returns its text content (HTML is stripped to readable text; GitHub/GitLab "blob" links are resolved to the raw file automatically). Use this whenever the user pastes a link and asks you to read, summarize, or work from it — do NOT claim you cannot access external URLs. Returns { url, title, text, truncated }.', parameters: obj({ url: { ...S, description: 'Absolute http(s) URL to fetch.' } }, ['url']), run: (_ctx, a) => fetchWebDocument(str(a.url)) },

  // ---- Executions (agent-runtime runs) — READS only. The `executions` table is tenant- AND
  //       segment-scoped. submit/cancel/post_message are SKIPPED (side-effects: they dispatch /
  //       steer live runs, not table ops). `trace` is computed by reading the same tenant+segment
  //       -scoped telemetry tables the /executions/:id/trace route reads (usage_snapshots +
  //       tool_audit_events + execution_messages — execution_messages is tenant-scoped, NO
  //       segment_id). `task_file_changes` reads the raw-SQL task_file_changes table (no drizzle
  //       model), tenant-scoped by task_id + tenant_id. ----
  { tool: 'executions.list_recent', mutates: false, description: 'Recent executions across the workspace.', parameters: obj({ limit: N }), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(executions).where(and(eq(executions.tenantId, ctx.tenantId), eq(executions.segmentId, seg))).orderBy(desc(executions.createdAt)).limit(a.limit != null ? num(a.limit) : 200); } },
  { tool: 'executions.list_active', mutates: false, description: "What's running right now across the fleet (pending / running executions).", parameters: obj({}), run: async (ctx) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(executions).where(and(eq(executions.tenantId, ctx.tenantId), eq(executions.segmentId, seg), sql`${executions.status} IN ('pending','running')`)).orderBy(desc(executions.createdAt)).limit(200); } },
  { tool: 'executions.get', mutates: false, description: 'Get one execution by id.', parameters: obj({ id: N }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return (await ctx.db.select().from(executions).where(and(eq(executions.id, num(a.id)), eq(executions.tenantId, ctx.tenantId), eq(executions.segmentId, seg))).limit(1))[0] ?? null; } },
  { tool: 'executions.list_for_task', mutates: false, description: 'Execution history for a task.', parameters: obj({ taskId: N }, ['taskId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(executions).where(and(eq(executions.taskId, num(a.taskId)), eq(executions.tenantId, ctx.tenantId), eq(executions.segmentId, seg))).orderBy(desc(executions.createdAt)).limit(200); } },
  {
    tool: 'executions.trace', mutates: false,
    description: 'Execution trace: usage snapshots + tool-call audit (+ the durable steering thread).',
    parameters: obj({ id: N }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const id = num(a.id);
      const [execution] = await ctx.db.select().from(executions).where(and(eq(executions.id, id), eq(executions.tenantId, ctx.tenantId), eq(executions.segmentId, seg))).limit(1);
      if (!execution) return null;
      // Cloud runs are keyed by execution_id; host runs by (agent_host_id, session_key). All
      // telemetry tables are tenant+segment-scoped, so guard tenant+segment in every filter.
      const isCloudRun = execution.agentHostId == null || !execution.sessionId;
      const usageFilter = isCloudRun
        ? and(eq(usageSnapshots.tenantId, ctx.tenantId), eq(usageSnapshots.segmentId, seg), eq(usageSnapshots.executionId, id))
        : and(eq(usageSnapshots.tenantId, ctx.tenantId), eq(usageSnapshots.segmentId, seg), eq(usageSnapshots.agentHostId, execution.agentHostId!), eq(usageSnapshots.sessionKey, execution.sessionId!));
      const toolFilter = isCloudRun
        ? and(eq(toolAuditEvents.tenantId, ctx.tenantId), eq(toolAuditEvents.segmentId, seg), eq(toolAuditEvents.executionId, id))
        : and(eq(toolAuditEvents.tenantId, ctx.tenantId), eq(toolAuditEvents.segmentId, seg), eq(toolAuditEvents.agentHostId, execution.agentHostId!), eq(toolAuditEvents.sessionKey, execution.sessionId!));
      const usage = await ctx.db.select().from(usageSnapshots).where(usageFilter).orderBy(desc(usageSnapshots.ts)).limit(500);
      const toolEvents = await ctx.db.select().from(toolAuditEvents).where(toolFilter).orderBy(desc(toolAuditEvents.ts)).limit(500);
      const messages = await ctx.db.select().from(executionMessages).where(and(eq(executionMessages.executionId, id), eq(executionMessages.tenantId, ctx.tenantId))).orderBy(executionMessages.createdAt).limit(500);
      return { execution, trace: { source: isCloudRun ? 'cloud-telemetry' : 'runtime-fallback', usageSnapshots: usage, toolEvents, messages } };
    },
  },
  { tool: 'executions.task_file_changes', mutates: false, description: 'Files an agent created/modified/deleted for a task.', parameters: obj({ taskId: N }, ['taskId']), run: async (ctx, a) => (await ctx.db.execute(sql`SELECT path, change, agent, execution_id AS "executionId", created_at AS "createdAt" FROM task_file_changes WHERE task_id = ${num(a.taskId)} AND tenant_id = ${ctx.tenantId} ORDER BY created_at DESC LIMIT 500`)).rows },
  // ---- Executions (writes) — dispatch/steer live runs via route replay (reuses the
  //       runtime route's gating + dispatch logic; not a simple table op). ----
  { tool: 'executions.submit', mutates: true, description: 'Submit a task for agent execution (dispatches to an agent host or the cloud).', parameters: obj({ taskId: N, agentHostId: N, sessionId: S, payload: S }, ['taskId']), run: (ctx, a) => replayRoute(ctx, 'POST', '/api/runtime/executions', { taskId: num(a.taskId), ...(a.agentHostId != null ? { agentHostId: num(a.agentHostId) } : {}), ...(a.sessionId != null ? { sessionId: str(a.sessionId) } : {}), ...(a.payload != null ? { payload: str(a.payload) } : {}) }) },
  { tool: 'executions.cancel', mutates: true, description: 'Cancel a running/queued execution.', parameters: obj({ id: N }, ['id']), run: (ctx, a) => replayRoute(ctx, 'POST', `/api/runtime/executions/${num(a.id)}/cancel`) },
  { tool: 'executions.post_message', mutates: true, description: 'Send a follow-up direction to a running execution (steer it mid-run).', parameters: obj({ id: N, text: S }, ['id', 'text']), run: (ctx, a) => replayRoute(ctx, 'POST', `/api/runtime/executions/${num(a.id)}/messages`, { text: str(a.text) }) },

  // ---- Quality / error observability (read): production errors the Quality pillar
  //       fingerprint-groups, so the Brain (web AND editor) can see what is breaking
  //       and fix it — the "error → fix" loop, callable from either surface. ----
  { tool: 'quality.list_error_groups', mutates: false, description: 'List production error groups (fingerprint-grouped runtime errors), newest first. Optionally filter by project, status (unresolved/resolved/ignored/fixing), or level (fatal/error/warning/info). Use this to see what is breaking, then search_code/read_file the referenced code and fix it.', parameters: obj({ projectId: N, status: S, level: S, limit: N }), run: (ctx, a) => {
    const conds: SQL[] = [eq(errorGroups.tenantId, ctx.tenantId)];
    if (a.projectId != null) conds.push(eq(errorGroups.projectId, num(a.projectId)));
    if (a.status != null) conds.push(eq(errorGroups.status, str(a.status)));
    if (a.level != null) conds.push(eq(errorGroups.level, str(a.level)));
    return ctx.db.select().from(errorGroups).where(and(...conds)).orderBy(desc(errorGroups.lastSeen)).limit(a.limit != null ? Math.min(num(a.limit), 100) : 50);
  } },
  { tool: 'quality.get_error_group', mutates: false, description: 'Get one error group by id — fingerprint, title, culprit, level, status, event/user counts, environment, release, a sample payload, and any linked task.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => (await ctx.db.select().from(errorGroups).where(and(eq(errorGroups.id, str(a.id)), eq(errorGroups.tenantId, ctx.tenantId))).limit(1))[0] ?? null },

  // ---- Integrations (read): integrations.list already exists above (line ~1088, secret-safe,
  //       tenant-scoped) — not re-added here to keep advertised names unique. ----

  // ---- Agent hosts (self-hosted runners) — agent_hosts is tenant- AND segment-scoped. register /
  //       deregister SKIPPED (mint/revoke API keys). ----
  { tool: 'agent_hosts.list', mutates: false, description: 'List registered self-hosted agent hosts.', parameters: obj({}), run: async (ctx) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(agentHosts).where(and(eq(agentHosts.tenantId, ctx.tenantId), eq(agentHosts.segmentId, seg))).orderBy(desc(agentHosts.createdAt)).limit(200); } },
  // agent_host_projects is tenant- AND segment-scoped (composite PK tenantId+agentHostId+projectId).
  { tool: 'agent_host_projects.list', mutates: false, description: 'Projects associated with an agent host.', parameters: obj({ agentHostId: N }, ['agentHostId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(agentHostProjects).where(and(eq(agentHostProjects.tenantId, ctx.tenantId), eq(agentHostProjects.segmentId, seg), eq(agentHostProjects.agentHostId, num(a.agentHostId)))).limit(200); } },
  // usage_snapshots is tenant- AND segment-scoped; filtered to one host's token telemetry.
  { tool: 'usage_snapshots.list', mutates: false, description: 'Token usage snapshots for an agent host.', parameters: obj({ agentHostId: N, limit: N }, ['agentHostId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(usageSnapshots).where(and(eq(usageSnapshots.tenantId, ctx.tenantId), eq(usageSnapshots.segmentId, seg), eq(usageSnapshots.agentHostId, num(a.agentHostId)))).orderBy(desc(usageSnapshots.ts)).limit(a.limit != null ? num(a.limit) : 50); } },

  // =====================================================================
  // Web-Brain parity tail — every remaining web platformActions capability,
  // ported by REPLAYING its real /api route (reuses the route's logic + role
  // gates). Tool names are the web cap's exact `domain.method` so the web
  // Brain's catalog-exclude matches and the capability lives in ONE place.
  // The only web caps intentionally left web-only are the client-local
  // navigation actions (navigate_to / open_project).
  // =====================================================================

  // ---- Agent hosts (register / deregister / tool audit) ----
  { tool: 'agent_hosts.register', mutates: true, description: 'Register a new agent host (returns a one-time API key).', parameters: obj({ name: S }, ['name']), run: (ctx, a) => replayRoute(ctx, 'POST', '/api/agent-hosts', { name: str(a.name).trim() }) },
  { tool: 'agent_hosts.deregister', mutates: true, description: 'Deregister an agent host (revokes its key).', parameters: obj({ agentHostId: N }, ['agentHostId']), run: (ctx, a) => replayRoute(ctx, 'DELETE', `/api/agent-hosts/${num(a.agentHostId)}`) },
  { tool: 'agent_hosts.tool_audit', mutates: false, description: 'Tool-call audit events for an agent host.', parameters: obj({ agentHostId: N, runId: S, limit: N }, ['agentHostId']), run: (ctx, a) => { const q = new URLSearchParams(); if (a.runId != null) q.set('runId', str(a.runId)); if (a.limit != null) q.set('limit', String(num(a.limit))); const qs = q.toString(); return replayRoute(ctx, 'GET', `/api/agent-hosts/${num(a.agentHostId)}/tool-audit${qs ? `?${qs}` : ''}`); } },

  // ---- Agent host config (runtime config JSON) ----
  { tool: 'agent_host_config.get', mutates: false, description: 'Get an agent host’s runtime config JSON.', parameters: obj({ agentHostId: N }, ['agentHostId']), run: (ctx, a) => replayRoute(ctx, 'GET', `/api/agent-hosts/${num(a.agentHostId)}/config`) },
  { tool: 'agent_host_config.update', mutates: true, description: 'Replace an agent host’s runtime config JSON.', parameters: obj({ agentHostId: N, config: obj({}) }, ['agentHostId', 'config']), run: (ctx, a) => replayRoute(ctx, 'PUT', `/api/agent-hosts/${num(a.agentHostId)}/config`, { config: (a.config ?? {}) as Json }) },

  // ---- Agent host ↔ project associations ----
  { tool: 'agent_host_projects.assign', mutates: true, description: 'Associate a project with an agent host.', parameters: obj({ agentHostId: N, projectId: N, role: S }, ['agentHostId', 'projectId']), run: (ctx, a) => replayRoute(ctx, 'PUT', `/api/agent-hosts/${num(a.agentHostId)}/projects/${num(a.projectId)}`, { role: a.role != null ? str(a.role) : undefined }) },
  { tool: 'agent_host_projects.unassign', mutates: true, description: 'Remove a project↔agent-host association.', parameters: obj({ agentHostId: N, projectId: N }, ['agentHostId', 'projectId']), run: (ctx, a) => replayRoute(ctx, 'DELETE', `/api/agent-hosts/${num(a.agentHostId)}/projects/${num(a.projectId)}`) },

  // ---- Agent host skills ----
  { tool: 'agent_host_skills.list', mutates: false, description: 'Skills assigned to an agent host.', parameters: obj({ agentHostId: N }, ['agentHostId']), run: (ctx, a) => replayRoute(ctx, 'GET', `/api/skill-assignments?agentHostId=${num(a.agentHostId)}`) },
  { tool: 'agent_host_skills.assign', mutates: true, description: 'Assign a skill to an agent host.', parameters: obj({ agentHostId: N, skillSlug: S }, ['agentHostId', 'skillSlug']), run: (ctx, a) => replayRoute(ctx, 'POST', `/api/skill-assignments/agentHost/${num(a.agentHostId)}`, { skillSlug: str(a.skillSlug) }) },
  { tool: 'agent_host_skills.revoke', mutates: true, description: 'Revoke a skill assignment.', parameters: obj({ assignmentId: N }, ['assignmentId']), run: (ctx, a) => replayRoute(ctx, 'DELETE', `/api/skill-assignments/${num(a.assignmentId)}`) },

  // ---- Agent host channels (multi-channel messaging) ----
  { tool: 'channels.list', mutates: false, description: 'List messaging channels on an agent host.', parameters: obj({ agentHostId: N }, ['agentHostId']), run: (ctx, a) => replayRoute(ctx, 'GET', `/api/agent-hosts/${num(a.agentHostId)}/channels`) },
  { tool: 'channels.create', mutates: true, description: 'Create a messaging channel (whatsapp/telegram/slack/discord/teams/webhook…).', parameters: obj({ agentHostId: N, platform: S, name: S, config: S, enabled: B }, ['agentHostId', 'platform', 'name']), run: (ctx, a) => replayRoute(ctx, 'POST', `/api/agent-hosts/${num(a.agentHostId)}/channels`, { platform: str(a.platform), name: str(a.name), config: a.config != null ? str(a.config) : undefined, ...(typeof a.enabled === 'boolean' ? { enabled: a.enabled } : {}) }) },
  { tool: 'channels.update', mutates: true, description: 'Update a messaging channel.', parameters: obj({ agentHostId: N, channelId: S, name: S, config: S, enabled: B }, ['agentHostId', 'channelId']), run: (ctx, a) => { const body: Json = {}; if (a.name != null) body.name = str(a.name); if (a.config != null) body.config = str(a.config); if (typeof a.enabled === 'boolean') body.enabled = a.enabled; return replayRoute(ctx, 'PATCH', `/api/agent-hosts/${num(a.agentHostId)}/channels/${encodeURIComponent(str(a.channelId))}`, body); } },
  { tool: 'channels.delete', mutates: true, description: 'Delete a messaging channel.', parameters: obj({ agentHostId: N, channelId: S }, ['agentHostId', 'channelId']), run: (ctx, a) => replayRoute(ctx, 'DELETE', `/api/agent-hosts/${num(a.agentHostId)}/channels/${encodeURIComponent(str(a.channelId))}`) },

  // ---- Agent host workspace (synced directories + files) ----
  { tool: 'workspace.list_directories', mutates: false, description: 'List synced directories on an agent host.', parameters: obj({ agentHostId: N }, ['agentHostId']), run: (ctx, a) => replayRoute(ctx, 'GET', `/api/agent-hosts/${num(a.agentHostId)}/directories`) },
  { tool: 'workspace.list_files', mutates: false, description: 'List files in a synced directory.', parameters: obj({ agentHostId: N, directoryId: N }, ['agentHostId', 'directoryId']), run: (ctx, a) => replayRoute(ctx, 'GET', `/api/agent-hosts/${num(a.agentHostId)}/directories/${num(a.directoryId)}/files`) },
  { tool: 'workspace.trigger_sync', mutates: true, description: 'Trigger a directory re-sync on an agent host.', parameters: obj({ agentHostId: N, directoryId: N }, ['agentHostId', 'directoryId']), run: (ctx, a) => replayRoute(ctx, 'POST', `/api/agent-hosts/${num(a.agentHostId)}/directories/${num(a.directoryId)}/sync`) },

  // ---- Dispatch (send a command payload to an agent host via the relay) ----
  { tool: 'dispatch.send', mutates: true, description: 'Send a command payload to an agent host via the relay.', parameters: obj({ agentHostId: N, payload: obj({}) }, ['agentHostId', 'payload']), run: (ctx, a) => replayRoute(ctx, 'POST', `/api/agent-hosts/${num(a.agentHostId)}/dispatch`, (a.payload ?? {}) as Json) },

  // ---- Autonomous boards (live dispatch status) ----
  { tool: 'boards.dispatches', mutates: false, description: 'Live per-agent dispatch status across a board.', parameters: obj({ boardId: S }, ['boardId']), run: (ctx, a) => replayRoute(ctx, 'GET', `/api/boards/${encodeURIComponent(str(a.boardId))}/dispatches`) },

  // ---- Marketplace: hire a published agent (purchase flow) ----
  { tool: 'agents_published.hire', mutates: true, description: 'Hire (acquire) a marketplace agent for this workspace.', parameters: obj({ agentId: S }, ['agentId']), run: (ctx, a) => replayRoute(ctx, 'POST', `/api/workforce/agents/${encodeURIComponent(str(a.agentId))}/hire`, {}) },

  // ---- Marketplace artifact stats (likes/installs) ----
  { tool: 'marketplace_stats.get_stats', mutates: false, description: 'Likes/installs for artifacts.', parameters: obj({ type: { type: 'string', enum: ['skill', 'persona', 'content'] }, slugs: { type: 'array', items: S } }, ['type', 'slugs']), run: (ctx, a) => { const slugs = Array.isArray(a.slugs) ? a.slugs.map(str) : []; const q = new URLSearchParams({ type: str(a.type), slugs: slugs.join(',') }); return replayRoute(ctx, 'GET', `/api/marketplace-stats/stats?${q.toString()}`); } },
  { tool: 'marketplace_stats.toggle_like', mutates: true, description: 'Like/unlike an artifact.', parameters: obj({ type: S, artifactSlug: S }, ['type', 'artifactSlug']), run: (ctx, a) => replayRoute(ctx, 'POST', '/api/marketplace-stats/like', { artifactType: str(a.type), artifactSlug: str(a.artifactSlug) }) },

  // ---- Integrations (write twins of the existing integrations.create_credential) ----
  // Web cap names are integrations.create/update/remove; ported under those exact names
  // so the web exclude matches (replays the same /api/integrations routes).
  { tool: 'integrations.create', mutates: true, description: 'Store an integration credential (GitHub/GitLab/Jira/etc).', parameters: obj({ provider: { type: 'string', enum: ['github', 'gitlab', 'bitbucket', 'jira', 'confluence', 'freshservice'] }, name: S, baseUrl: S, projectId: N, credentials: obj({}) }, ['provider', 'name', 'credentials']), run: (ctx, a) => replayRoute(ctx, 'POST', '/api/integrations', { provider: str(a.provider), name: str(a.name), baseUrl: a.baseUrl != null ? str(a.baseUrl) : undefined, projectId: a.projectId != null ? num(a.projectId) : undefined, credentials: (a.credentials ?? {}) as Json }) },
  { tool: 'integrations.update', mutates: true, description: 'Update an integration credential.', parameters: obj({ id: S, name: S, baseUrl: S, isEnabled: B }, ['id']), run: (ctx, a) => { const body: Json = {}; if (a.name != null) body.name = str(a.name); if (a.baseUrl != null) body.baseUrl = str(a.baseUrl); if (typeof a.isEnabled === 'boolean') body.isEnabled = a.isEnabled; return replayRoute(ctx, 'PATCH', `/api/integrations/${encodeURIComponent(str(a.id))}`, body); } },
  { tool: 'integrations.remove', mutates: true, description: 'Delete an integration credential.', parameters: obj({ id: S }, ['id']), run: (ctx, a) => replayRoute(ctx, 'DELETE', `/api/integrations/${encodeURIComponent(str(a.id))}`) },

  // ---- Repos: list_pull_requests already exists above; add the project-default toggle is also above.
  // (No additional repos caps to port — all are already in the catalog.)

  // ---- Board connections (trigger external sync) ----
  { tool: 'board_connections.sync', mutates: true, description: 'Trigger a sync for an external board connection.', parameters: obj({ id: S }, ['id']), run: (ctx, a) => replayRoute(ctx, 'POST', `/api/board-connections/${encodeURIComponent(str(a.id))}/sync`) },

  // ---- Project files (R2-backed; save uses a raw text/plain body) ----
  { tool: 'project_files.list', mutates: false, description: 'List files in a project.', parameters: obj({ projectId: N }, ['projectId']), run: (ctx, a) => replayRoute(ctx, 'GET', `/api/projects/${num(a.projectId)}/files`) },
  { tool: 'project_files.read', mutates: false, description: 'Read a project file’s content.', parameters: obj({ projectId: N, path: S }, ['projectId', 'path']), run: (ctx, a) => replayRoute(ctx, 'GET', `/api/projects/${num(a.projectId)}/files/${str(a.path).split('/').map(encodeURIComponent).join('/')}`) },
  { tool: 'project_files.save', mutates: true, description: 'Create or overwrite a project file.', parameters: obj({ projectId: N, path: S, content: S }, ['projectId', 'path', 'content']), run: (ctx, a) => replayRoute(ctx, 'PUT', `/api/projects/${num(a.projectId)}/files/${str(a.path).split('/').map(encodeURIComponent).join('/')}`, undefined, { rawText: str(a.content) }) },
  { tool: 'project_files.delete', mutates: true, description: 'Delete a project file.', parameters: obj({ projectId: N, path: S }, ['projectId', 'path']), run: (ctx, a) => replayRoute(ctx, 'DELETE', `/api/projects/${num(a.projectId)}/files/${str(a.path).split('/').map(encodeURIComponent).join('/')}`) },

  // ---- Projects: key availability check ----
  { tool: 'projects.check_key', mutates: false, description: 'Check whether a project key (prefix) is available.', parameters: obj({ key: S }, ['key']), run: (ctx, a) => replayRoute(ctx, 'GET', `/api/projects/check-key?key=${encodeURIComponent(str(a.key).trim().toUpperCase())}`) },

  // ---- Repo analysis (run the Architect on a project; writes a PRD) ----
  { tool: 'repo_analysis.start', mutates: true, description: 'Run the Architect: create an architecture-analysis task on a project and start it. The result is written back as a PRD. Requires a repo mapped to the project.', parameters: obj({ projectId: N }, ['projectId']), run: (ctx, a) => replayRoute(ctx, 'POST', `/api/repo-analysis/projects/${num(a.projectId)}/architect`, {}) },

  // ---- Analytics ----
  { tool: 'analytics.activity_calendar', mutates: false, description: 'Contributor activity calendar (humans + AI agents).', parameters: obj({ from: S, to: S, contributorId: N }), run: (ctx, a) => { const q = new URLSearchParams(); if (a.from != null) q.set('from', str(a.from)); if (a.to != null) q.set('to', str(a.to)); if (a.contributorId != null) q.set('contributorId', String(num(a.contributorId))); const qs = q.toString(); return replayRoute(ctx, 'GET', `/api/analytics/activity-calendar${qs ? `?${qs}` : ''}`); } },
  { tool: 'analytics.sync_agents', mutates: true, description: 'Refresh AI-agent contributor data.', parameters: obj({}), run: (ctx) => replayRoute(ctx, 'POST', '/api/analytics/sync-agents', {}) },

  // ---- Tasks: the assignable team roster (humans + cloud agents) ----
  // The `/api/tasks/assignees` route returns HUMANS only by design (the frontend picker
  // composes agents client-side from /workforce/agents/mine — see listWorkforceDirectory).
  // The Brain/@agent loop has no such client-side merge, so this tool assembles the FULL
  // roster server-side: tenant members + the tenant's cloud agents (ide_agents), each with
  // its real ref. This is what stops an agent inventing a fake assignee ref — every ref it
  // hands to tasks.create/tasks.update comes from here.
  {
    tool: 'tasks.assignees', mutates: false,
    description: 'List the FULL team a task can be assigned to — humans AND cloud agents in ONE roster. Returns { humans:[{ref,name}], agents:[{ref,name,role,builtinKind,status,scope,assignedToProject}] }. An agent "ref" is its ide_agents id: set it as `assignedAgentRef` on tasks.create/tasks.update to hand work to that agent (use a human ref as the task\'s assigneeId for a person). Pass projectId to mark which agents are staffed to that project (assignedToProject=true) and prefer those. NEVER invent an assignee/agent ref — only use refs returned by this tool.',
    parameters: obj({ projectId: N }),
    run: async (ctx, a) => {
      const projectId = a.projectId != null ? num(a.projectId) : null;
      const humansRes = (await replayRoute(ctx, 'GET', '/api/tasks/assignees')) as { members?: { id: string; name: string }[] };
      const agentRows = await ctx.db
        .select({ id: ideAgents.id, name: ideAgents.name, title: ideAgents.title, builtinKind: ideAgents.builtinKind, status: ideAgents.status, projectId: ideAgents.projectId })
        .from(ideAgents)
        .where(and(eq(ideAgents.tenantId, ctx.tenantId), eq(ideAgents.status, 'active')))
        .limit(200);
      // Explicit project→agent role assignments (mig 0281) mark project-staffed agents.
      const assignedRefs = projectId != null
        ? new Set(
            (await ctx.db
              .select({ ref: projectRoleAssignments.assigneeRef })
              .from(projectRoleAssignments)
              .where(and(eq(projectRoleAssignments.tenantId, ctx.tenantId), eq(projectRoleAssignments.projectId, projectId), eq(projectRoleAssignments.assigneeKind, 'agent')))
              .limit(200)).map((r) => String(r.ref)),
          )
        : new Set<string>();
      const agents = agentRows.map((r) => ({
        ref: String(r.id),
        name: r.name,
        role: r.title ?? r.builtinKind ?? null,
        builtinKind: r.builtinKind ?? null,
        status: r.status,
        scope: r.projectId != null ? 'project' : 'tenant',
        assignedToProject: projectId != null && (r.projectId === projectId || assignedRefs.has(String(r.id))),
      }));
      return { humans: humansRes.members ?? [], agents };
    },
  },

  // ---- Kanban: role sign-off (the reviewer round-trip, first-class for agents) ----
  { tool: 'kanban.signoff', mutates: true, description: 'Record a role SIGN-OFF on a ticket as a reviewer acting AS a role (satisfies a lane\'s role/review requirement so the audit clears and the swimlane can advance). verdict "approved" (default), "changes_requested", "waived", or "delegated" (waive/delegate need a reason). ALWAYS pass `contribution` linking the actual work (executionId, prUrl, diffFiles, prdRevision, toolRunId) — an approval with no linked contribution is itself an audit finding. memberKind defaults to "agent" (you), memberRef to your agent id.', parameters: obj({ taskId: N, roleKey: S, laneKey: S, verdict: { type: 'string', enum: ['approved', 'changes_requested', 'waived', 'delegated'] }, summary: S, memberRef: S, waiveReason: S, contribution: { type: 'object' } }, ['taskId', 'roleKey']), run: (ctx, a) => replayRoute(ctx, 'POST', `/api/kanban/tasks/${num(a.taskId)}/signoff`, { roleKey: str(a.roleKey), laneKey: a.laneKey != null ? str(a.laneKey) : undefined, verdict: ['approved', 'changes_requested', 'waived', 'delegated'].includes(String(a.verdict)) ? str(a.verdict) : 'approved', summary: a.summary != null ? str(a.summary) : undefined, waiveReason: a.waiveReason != null ? str(a.waiveReason) : undefined, contribution: a.contribution != null && typeof a.contribution === 'object' ? a.contribution : undefined, memberKind: 'agent', memberRef: a.memberRef != null ? str(a.memberRef) : (ctx.userId ?? undefined) }) },
  { tool: 'kanban.audit', mutates: false, description: 'Get a ticket\'s role/diagnostic coverage audit (which required lane checks are satisfied vs missing).', parameters: obj({ taskId: N }, ['taskId']), run: (ctx, a) => replayRoute(ctx, 'GET', `/api/kanban/tasks/${num(a.taskId)}/audit`) },
  { tool: 'kanban.participants', mutates: false, description: 'Get a ticket\'s Participation Manifest — every required role, its resolved assignee, and its state (pending/assigned/in_progress/completed/changes_requested/waived/unstaffed). An `unstaffed` row is a RESOURCE GAP (no capable resource available).', parameters: obj({ taskId: N }, ['taskId']), run: (ctx, a) => replayRoute(ctx, 'GET', `/api/kanban/tasks/${num(a.taskId)}/participants`) },
  { tool: 'kanban.accountability', mutates: false, description: 'Get a ticket\'s Accountability Report — per required role: Who signed, When, Verdict, Comments, and the linked Contribution — plus gaps (unstaffed/unsigned roles, sign-offs with no contribution, waivers) and %-complete.', parameters: obj({ taskId: N }, ['taskId']), run: (ctx, a) => replayRoute(ctx, 'GET', `/api/kanban/tasks/${num(a.taskId)}/accountability`) },
  { tool: 'kanban.assess_resource', mutates: true, description: 'RESOURCE ASSESSMENT — add a role the ticket needs beyond the template (e.g. designer, security). It becomes a required manifest participant that must execute + sign off; if no capable resource is available it is flagged as a resource gap. responsibility defaults to "owner".', parameters: obj({ taskId: N, roleKey: S, responsibility: { type: 'string', enum: ['owner', 'reviewer', 'contributor'] }, stageKey: S, note: S }, ['taskId', 'roleKey']), run: (ctx, a) => replayRoute(ctx, 'POST', `/api/kanban/tasks/${num(a.taskId)}/participants`, { roleKey: str(a.roleKey), responsibility: a.responsibility != null ? str(a.responsibility) : undefined, stageKey: a.stageKey != null ? str(a.stageKey) : undefined, note: a.note != null ? str(a.note) : undefined }) },
  { tool: 'kanban.coordinate', mutates: true, description: 'Run the ticket Coordinator now: ensure its template manifest exists and dispatch the next required role-capable participant. The ticket assignee coordinates; producers do the scoped work.', parameters: obj({ taskId: N }, ['taskId']), run: (ctx, a) => replayRoute(ctx, 'POST', `/api/kanban/tasks/${num(a.taskId)}/coordinate`, {}) },
  { tool: 'kanban.materialize_work_items', mutates: true, description: 'Create one assigned child task per required participant in the ticket manifest. Call after resource assessment so delivery scope rolls up to the parent ticket and every required resource has explicit work.', parameters: obj({ taskId: N }, ['taskId']), run: (ctx, a) => replayRoute(ctx, 'POST', `/api/kanban/tasks/${num(a.taskId)}/participants/materialize`, {}) },

  // ---- Workflow DEFINITIONS: write/run/import + computed reads not backed by a plain table op ----
  { tool: 'workflows.create', mutates: true, description: 'Create a workflow definition.', parameters: obj({ name: S, description: S, projectId: N }, ['name']), run: (ctx, a) => replayRoute(ctx, 'POST', '/api/workflow-definitions', { name: str(a.name), description: a.description != null ? str(a.description) : undefined, projectId: a.projectId != null ? num(a.projectId) : undefined }) },
  { tool: 'workflows.update', mutates: true, description: 'Update a workflow definition (name/description/project).', parameters: obj({ id: S, name: S, description: S, projectId: N }, ['id']), run: (ctx, a) => { const body: Json = {}; if (a.name != null) body.name = str(a.name); if (a.description != null) body.description = str(a.description); if (a.projectId != null) body.projectId = num(a.projectId); return replayRoute(ctx, 'PATCH', `/api/workflow-definitions/${encodeURIComponent(str(a.id))}`, body); } },
  { tool: 'workflows.remove', mutates: true, description: 'Delete a workflow definition.', parameters: obj({ id: S }, ['id']), run: (ctx, a) => replayRoute(ctx, 'DELETE', `/api/workflow-definitions/${encodeURIComponent(str(a.id))}`) },
  { tool: 'workflows.run', mutates: true, description: 'Run a workflow on a target. runtime is "host" (pass agentHostId) or "cloud" (pass cloudAgentRef).', parameters: obj({ id: S, runtime: { type: 'string', enum: ['host', 'cloud'] }, agentHostId: N, cloudAgentRef: S }, ['id', 'runtime']), run: (ctx, a) => replayRoute(ctx, 'POST', `/api/workflow-definitions/${encodeURIComponent(str(a.id))}/run`, { runtime: str(a.runtime), agentHostId: a.agentHostId != null ? num(a.agentHostId) : null, cloudAgentRef: a.cloudAgentRef != null ? str(a.cloudAgentRef) : null }) },
  { tool: 'workflows.import_yaml', mutates: true, description: 'Create a workflow from a YAML/JSON document.', parameters: obj({ name: S, yaml: S }, ['name', 'yaml']), run: (ctx, a) => replayRoute(ctx, 'POST', '/api/workflow-definitions/import', { name: str(a.name), yaml: str(a.yaml) }) },
  { tool: 'workflows.runs', mutates: false, description: 'Run history for a workflow definition.', parameters: obj({ id: S }, ['id']), run: (ctx, a) => replayRoute(ctx, 'GET', `/api/workflow-definitions/${encodeURIComponent(str(a.id))}/runs`) },
  { tool: 'workflows.run_targets', mutates: false, description: 'Available run targets (agent hosts + cloud agents).', parameters: obj({}), run: (ctx) => replayRoute(ctx, 'GET', '/api/workflow-definitions/run-targets') },
  { tool: 'workflows.triggers', mutates: false, description: 'Trigger activation state (webhook/schedule/rss/email) for a workflow.', parameters: obj({ id: S }, ['id']), run: (ctx, a) => replayRoute(ctx, 'GET', `/api/workflow-definitions/${encodeURIComponent(str(a.id))}/triggers`) },

  // ---- Workflow RUNS: graph (computed node/edge view) ----
  { tool: 'workflow_runs.graph', mutates: false, description: 'Get a workflow run’s node/edge graph for visualization.', parameters: obj({ id: S }, ['id']), run: (ctx, a) => replayRoute(ctx, 'GET', `/api/workflows/${encodeURIComponent(str(a.id))}/graph`) },

  // ---- Brain chat summarize (LLM call, not a table op) ----
  { tool: 'brain.summarize', mutates: true, description: 'Summarize a Brain chat and store the summary.', parameters: obj({ chatId: N }, ['chatId']), run: (ctx, a) => replayRoute(ctx, 'POST', `/api/brain/chats/${num(a.chatId)}/summarize`, {}) },

  // ---- LLM proxy: usage / health / models ----
  { tool: 'llm.usage', mutates: false, description: 'Token usage stats for the workspace.', parameters: obj({}), run: (ctx) => replayRoute(ctx, 'GET', '/llm/v1/usage') },
  { tool: 'llm.health', mutates: false, description: 'Model availability rollup (counts by vendor + keyBound/available, plus any models on cooldown). Pass verbose:true for the full per-model free/pro arrays.', parameters: obj({ verbose: B }), run: async (ctx, a) => { const full = await replayRoute(ctx, 'GET', '/llm/v1/health') as Record<string, unknown>; if (a.verbose === true) return full; return { status: full.status, service: full.service, timestamp: full.timestamp, pool: full.pool, proPool: full.proPool, imagePool: full.imagePool, imageProPool: full.imageProPool, free: summarizeModelStatuses((full.free as Array<Record<string, unknown>>) ?? []), pro: summarizeModelStatuses((full.pro as Array<Record<string, unknown>>) ?? []) }; } },
  { tool: 'llm.models', mutates: false, description: 'Models available for the workspace plan: plan flags + a vendor/availability rollup of the pool. Pass verbose:true for the full per-model data array.', parameters: obj({ verbose: B }), run: async (ctx, a) => { const full = await replayRoute(ctx, 'GET', '/llm/v1/models') as Record<string, unknown>; if (a.verbose === true) return full; const { data, ...rest } = full; return { ...rest, dataSummary: summarizeModelStatuses((data as Array<Record<string, unknown>>) ?? []) }; } },

  // ---- Dashboard token/cost usage ----
  { tool: 'dashboard.usage', mutates: false, description: 'Token + cost usage split by source (cloud/on-prem/web), and by user/team/repo/project.', parameters: obj({ window: { type: 'string', enum: ['today', 'week', 'month'] } }), run: (ctx, a) => replayRoute(ctx, 'GET', `/api/dashboard/usage?window=${encodeURIComponent(a.window != null ? str(a.window) : 'week')}`) },

  // ---- Saved dashboards: computed reads (metrics catalogue, resolved data, NL query) ----
  { tool: 'dashboards.metrics', mutates: false, description: 'List the whitelisted metric keys a dashboard widget can chart.', parameters: obj({}), run: (ctx) => replayRoute(ctx, 'GET', '/api/dashboards/metrics') },
  { tool: 'dashboards.data', mutates: false, description: 'Resolve every widget on a dashboard to its current value.', parameters: obj({ dashboardId: N }, ['dashboardId']), run: (ctx, a) => replayRoute(ctx, 'GET', `/api/dashboards/dashboards/${num(a.dashboardId)}/data`) },
  { tool: 'dashboards.query', mutates: false, description: 'Ask a natural-language question; it is mapped deterministically to one whitelisted metric and answered.', parameters: obj({ question: S }, ['question']), run: (ctx, a) => replayRoute(ctx, 'POST', '/api/dashboards/query', { question: str(a.question) }) },

  // ---- Provider keys (remove a stored key; list already exists above) ----
  { tool: 'provider_keys.remove', mutates: true, description: 'Remove a stored provider key.', parameters: obj({ provider: { type: 'string', enum: ['anthropic'] } }, ['provider']), run: (ctx, a) => replayRoute(ctx, 'DELETE', `/llm/provider-keys/${encodeURIComponent(str(a.provider))}`) },

  // ---- PMO: structure tree + composed rollup (computed reads) ----
  { tool: 'pmo.tree', mutates: false, description: 'The portfolio structure: portfolios ▸ initiatives ▸ linked projects (+ initiative dependency edges).', parameters: obj({}), run: (ctx) => replayRoute(ctx, 'GET', '/api/pmo/tree') },
  { tool: 'pmo.rollup', mutates: false, description: 'Composed rollup (delivery + cost + DORA + OKR progress + per-portfolio / per-initiative breakdown) for one scope. kind="workspace" is the whole org (ignores id, returns byPortfolio + byInitiative); kind="portfolio"|"initiative"|"project" needs that id.', parameters: obj({ kind: { type: 'string', enum: ['workspace', 'portfolio', 'initiative', 'project'] }, id: S }, ['kind']), run: (ctx, a) => { const kind = str(a.kind); const idPart = kind !== 'workspace' && a.id != null ? `&id=${encodeURIComponent(str(a.id))}` : ''; return replayRoute(ctx, 'GET', `/api/pmo/rollup?kind=${encodeURIComponent(kind)}${idPart}`); } },
  // ---- PMO: structure writes (Structure tab) — replay the real routes so the
  //       cycle check + cache-version bump + manager gate are the single source. ----
  { tool: 'pmo.link_project', mutates: true, description: 'Link a project to a PMO initiative so its cost + delivery roll up under that initiative (pass initiativeId=null to UNLINK). This is the Structure-tab "link a project" action.', parameters: obj({ projectId: N, initiativeId: { type: ['string', 'null'] } }, ['projectId']), run: (ctx, a) => replayRoute(ctx, 'PATCH', `/api/pmo/projects/${num(a.projectId)}/link`, { initiativeId: a.initiativeId != null ? str(a.initiativeId) : null }) },
  { tool: 'pmo.add_dependency', mutates: true, description: 'Add an initiative dependency edge: fromInitiativeId BLOCKS toInitiativeId (feeds the critical path). Rejected if it would create a cycle.', parameters: obj({ fromInitiativeId: S, toInitiativeId: S }, ['fromInitiativeId', 'toInitiativeId']), run: (ctx, a) => replayRoute(ctx, 'POST', '/api/pmo/dependencies', { fromInitiativeId: str(a.fromInitiativeId), toInitiativeId: str(a.toInitiativeId) }) },
  { tool: 'pmo.remove_dependency', mutates: true, description: 'Remove an initiative dependency edge by its id.', parameters: obj({ id: S }, ['id']), run: (ctx, a) => replayRoute(ctx, 'DELETE', `/api/pmo/dependencies/${encodeURIComponent(str(a.id))}`) },

  // ---- Governance SOC 2: seed (bulk control-set generation) ----
  { tool: 'governance_soc2.seed', mutates: true, description: 'Seed the SOC 2 control set.', parameters: obj({}), run: (ctx) => replayRoute(ctx, 'POST', '/api/governance/soc2/seed', {}) },

  // ---- Decks (board / CFO PowerPoint generation) ----
  { tool: 'decks.list_templates', mutates: false, description: 'List available deck templates (built-in board + CFO decks, plus any uploaded custom .pptx templates).', parameters: obj({}), run: (ctx) => replayRoute(ctx, 'GET', '/api/decks/templates') },
  { tool: 'decks.generate', mutates: true, description: 'Generate a Builderforce-branded board deck (PowerPoint) from this workspace\'s real data and return a download link. templateId picks the board deck (default) or CFO/DevFinOps deck; quarter is e.g. "2026-Q2".', parameters: obj({ templateId: S, quarter: S, prompt: S }), run: (ctx, a) => replayRoute(ctx, 'POST', '/api/decks/generate', { mode: 'generative', templateId: a.templateId != null ? str(a.templateId) : undefined, quarter: a.quarter != null ? str(a.quarter) : undefined, prompt: a.prompt != null ? str(a.prompt) : undefined }) },
  { tool: 'decks.fill_template', mutates: true, description: 'Fill an UPLOADED custom .pptx template (templateId from decks.list_templates where fillable=true) IN PLACE with this workspace\'s data, preserving the original design.', parameters: obj({ templateId: S, quarter: S }, ['templateId']), run: (ctx, a) => replayRoute(ctx, 'POST', '/api/decks/generate', { mode: 'fill', templateId: str(a.templateId), quarter: a.quarter != null ? str(a.quarter) : undefined }) },
  { tool: 'decks.promote_template', mutates: true, description: 'Promote an uploaded .pptx (pass its storage key as sourceKey) into a reusable custom deck template.', parameters: obj({ name: S, description: S, sourceKey: S }, ['name', 'sourceKey']), run: (ctx, a) => replayRoute(ctx, 'POST', '/api/decks/templates', { name: str(a.name), description: a.description != null ? str(a.description) : undefined, sourceKey: str(a.sourceKey) }) },

  // ---- Board data import (bulk entry for board-deck datasets) ----
  { tool: 'board_data.import_datasets', mutates: false, description: 'List the board-deck datasets that can be BULK-IMPORTED and their column specs.', parameters: obj({}), run: (ctx) => replayRoute(ctx, 'GET', '/api/insights/import/datasets') },
  { tool: 'board_data.import', mutates: true, description: 'Bulk-import rows into a board-deck dataset (e.g. headcount-events, rd-financials, support-tickets). `rows` is an array of objects whose keys match the dataset columns (call board_data.import_datasets for the spec).', parameters: obj({ dataset: S, rows: { type: 'array', items: { type: 'object' } } }, ['dataset', 'rows']), run: (ctx, a) => replayRoute(ctx, 'POST', `/api/insights/import/${encodeURIComponent(str(a.dataset))}`, { rows: Array.isArray(a.rows) ? a.rows : [] }) },

  // ---- My sessions (the current user's own active sessions) ----
  { tool: 'my_sessions.list', mutates: false, description: 'List the current user’s active sessions.', parameters: obj({}), run: (ctx) => replayRoute(ctx, 'GET', '/api/auth/sessions') },
  { tool: 'my_sessions.revoke', mutates: true, description: 'Revoke one of my sessions.', parameters: obj({ sessionId: S }, ['sessionId']), run: (ctx, a) => replayRoute(ctx, 'POST', `/api/auth/sessions/${encodeURIComponent(str(a.sessionId))}/revoke`, {}) },
  { tool: 'my_sessions.revoke_others', mutates: true, description: 'Revoke all of my other sessions.', parameters: obj({}), run: (ctx) => replayRoute(ctx, 'POST', '/api/auth/sessions/revoke-others', {}) },

  // ---- Tenant-scoped: security (member sessions) — path built from ctx.tenantId ----
  { tool: 'security.list_users', mutates: false, description: 'List workspace members and their session/token counts.', parameters: obj({}), run: (ctx) => replayRoute(ctx, 'GET', `/api/tenants/${ctx.tenantId}/security/users`) },
  { tool: 'security.get_user', mutates: false, description: 'Get a member’s active sessions.', parameters: obj({ userId: S }, ['userId']), run: (ctx, a) => replayRoute(ctx, 'GET', `/api/tenants/${ctx.tenantId}/security/users/${encodeURIComponent(str(a.userId))}`) },
  { tool: 'security.revoke_all_sessions', mutates: true, description: 'Log a member out of all sessions.', parameters: obj({ userId: S }, ['userId']), run: (ctx, a) => replayRoute(ctx, 'POST', `/api/tenants/${ctx.tenantId}/security/users/${encodeURIComponent(str(a.userId))}/sessions/revoke-all`, {}) },

  // ---- Tenant-scoped: gateway API keys — path built from ctx.tenantId ----
  { tool: 'api_keys.list', mutates: false, description: 'List the workspace’s gateway API keys (bfk_*).', parameters: obj({}), run: (ctx) => replayRoute(ctx, 'GET', `/api/tenants/${ctx.tenantId}/api-keys`) },
  { tool: 'api_keys.mint', mutates: true, description: 'Mint a new gateway API key. The raw key is returned once — show it carefully.', parameters: obj({ name: S, allowedOrigins: { type: 'array', items: S } }, ['name']), run: (ctx, a) => replayRoute(ctx, 'POST', `/api/tenants/${ctx.tenantId}/api-keys`, { name: str(a.name), allowedOrigins: Array.isArray(a.allowedOrigins) ? a.allowedOrigins.map(str) : undefined }) },
  { tool: 'api_keys.revoke', mutates: true, description: 'Revoke a gateway API key.', parameters: obj({ keyId: S }, ['keyId']), run: (ctx, a) => replayRoute(ctx, 'DELETE', `/api/tenants/${ctx.tenantId}/api-keys/${encodeURIComponent(str(a.keyId))}`) },

  // ---- Gig Marketplace (0293): publish a work item as a hireable gig, evaluate
  //      proposals with AI, schedule review/interview meetings, and run the FTE
  //      Job-Posting flow. The Brain IDEATES in a chat, then publishes; it composes a
  //      "project grounded in OKRs" from projects.create + objectives.create +
  //      key_results.create (no dedicated tool needed for those). ----
  { tool: 'marketplace.publish_ticket', mutates: true, description: 'Publish a work item (a board ticket — e.g. a Product brief or a Design gig authored by the Product Manager / Designer agent) to the Gig Marketplace so freelancers can estimate, bid, and be hired. The scope (title/description → requirements) is derived from the ticket, so you can publish with just a ticketId. Optional: postingType (project_bid|design|fte), engagementType (fixed_bid|hourly|fte), a requirements override, rate range in cents, visibility (public|private). Returns { jobId }.', parameters: obj({ ticketId: N, postingType: S, engagementType: S, requirements: S, rateMinCents: N, rateMaxCents: N, visibility: S }, ['ticketId']), run: (ctx, a) => replayRoute(ctx, 'POST', '/api/marketplace/publish', { ticketId: num(a.ticketId), postingType: a.postingType != null ? str(a.postingType) : undefined, engagementType: a.engagementType != null ? str(a.engagementType) : undefined, requirements: a.requirements != null ? str(a.requirements) : undefined, rateMinCents: a.rateMinCents != null ? num(a.rateMinCents) : undefined, rateMaxCents: a.rateMaxCents != null ? num(a.rateMaxCents) : undefined, visibility: a.visibility != null ? str(a.visibility) : undefined }) },
  { tool: 'marketplace.unpublish_ticket', mutates: true, description: 'Remove a ticket’s gig from the Marketplace (closes its open posting and clears the hireable flag).', parameters: obj({ ticketId: N }, ['ticketId']), run: (ctx, a) => replayRoute(ctx, 'POST', '/api/marketplace/unpublish', { ticketId: num(a.ticketId) }) },
  { tool: 'jobs.create', mutates: true, description: 'Create a Marketplace job posting directly (not tied to a board ticket) — e.g. an FTE Job Posting (postingType:"fte") candidates interview for, or a standalone gig. For a gig derived from an existing work item, prefer marketplace.publish_ticket. requirements = the acceptance criteria a proposal is AI-evaluated against.', parameters: obj({ title: S, description: S, requirements: S, discipline: S, skills: { type: 'array', items: S }, postingType: S, engagementType: S, projectId: N, rateMinCents: N, rateMaxCents: N, visibility: S }, ['title']), run: (ctx, a) => replayRoute(ctx, 'POST', '/api/jobs', { title: str(a.title), description: a.description != null ? str(a.description) : undefined, requirements: a.requirements != null ? str(a.requirements) : undefined, discipline: a.discipline != null ? str(a.discipline) : undefined, skills: Array.isArray(a.skills) ? a.skills.map(str) : undefined, postingType: a.postingType != null ? str(a.postingType) : undefined, engagementType: a.engagementType != null ? str(a.engagementType) : undefined, projectId: a.projectId != null ? num(a.projectId) : undefined, rateMinCents: a.rateMinCents != null ? num(a.rateMinCents) : undefined, rateMaxCents: a.rateMaxCents != null ? num(a.rateMaxCents) : undefined, visibility: a.visibility != null ? str(a.visibility) : undefined }) },
  { tool: 'jobs.list_mine', mutates: false, description: 'List the Marketplace job postings this workspace created (with proposal counts).', parameters: obj({}), run: (ctx) => replayRoute(ctx, 'GET', '/api/jobs/mine') },
  { tool: 'jobs.proposals', mutates: false, description: 'List the bids/proposals submitted on one of this workspace’s job postings.', parameters: obj({ jobId: S }, ['jobId']), run: (ctx, a) => replayRoute(ctx, 'GET', `/api/jobs/${encodeURIComponent(str(a.jobId))}/proposals`) },
  { tool: 'proposals.evaluate', mutates: true, description: 'Use AI to evaluate a submitted bid against the posting’s requirements (LLM-as-judge — grounded/faithfulness + relevance scoring), so you can compare bids objectively before shortlisting or hiring. Caches a 0..100 overall on the proposal and returns the full scores.', parameters: obj({ proposalId: S }, ['proposalId']), run: (ctx, a) => replayRoute(ctx, 'POST', `/api/jobs/proposals/${encodeURIComponent(str(a.proposalId))}/evaluate`, {}) },
  { tool: 'proposals.shortlist', mutates: true, description: 'Shortlist a candidate’s bid (moves it to the shortlisted stage and notifies them).', parameters: obj({ proposalId: S }, ['proposalId']), run: (ctx, a) => replayRoute(ctx, 'POST', `/api/jobs/proposals/${encodeURIComponent(str(a.proposalId))}/shortlist`, {}) },
  { tool: 'proposals.decline', mutates: true, description: 'Decline a bid/candidate with an optional courteous message (e.g. "we appreciate your time, but you weren’t selected this time"). The reason is sent to the candidate.', parameters: obj({ proposalId: S, reason: S }, ['proposalId']), run: (ctx, a) => replayRoute(ctx, 'POST', `/api/jobs/proposals/${encodeURIComponent(str(a.proposalId))}/decline`, { reason: a.reason != null ? str(a.reason) : undefined }) },
  { tool: 'meetings.schedule', mutates: true, description: 'Schedule a meeting — including a REVIEW (go over a gig worker’s effort/estimate/understanding before accepting a bid) or an INTERVIEW (for an FTE Job Posting candidate) — tracked against the exact work item, posting, or engagement. kind: standup|planning|retrospective|adhoc|direct|interview|review. Pass scheduledAt (ISO) for a future meeting and ONE of ticketId / jobId / engagementId to link it.', parameters: obj({ title: S, kind: S, scheduledAt: S, durationMinutes: N, ticketId: N, jobId: S, engagementId: S, projectId: N }, ['title']), run: (ctx, a) => replayRoute(ctx, 'POST', '/api/meetings', { title: str(a.title), kind: a.kind != null ? str(a.kind) : undefined, scheduledAt: a.scheduledAt != null ? str(a.scheduledAt) : undefined, durationMinutes: a.durationMinutes != null ? num(a.durationMinutes) : undefined, ticketId: a.ticketId != null ? num(a.ticketId) : undefined, jobId: a.jobId != null ? str(a.jobId) : undefined, engagementId: a.engagementId != null ? str(a.engagementId) : undefined, projectId: a.projectId != null ? num(a.projectId) : undefined }) },
  { tool: 'deliverables.evaluate', mutates: true, description: 'Use AI to evaluate a hired worker’s presented proposal/deliverable against the published requirements (same LLM-as-judge as proposals.evaluate). Caches a 0..100 overall and returns the scores.', parameters: obj({ deliverableId: S }, ['deliverableId']), run: (ctx, a) => replayRoute(ctx, 'POST', `/api/deliverables/${encodeURIComponent(str(a.deliverableId))}/evaluate`, {}) },
  { tool: 'deliverables.set_status', mutates: true, description: 'Accept or request changes on a hired worker’s deliverable proposal. status: accepted|changes_requested.', parameters: obj({ deliverableId: S, status: S }, ['deliverableId', 'status']), run: (ctx, a) => replayRoute(ctx, 'POST', `/api/deliverables/${encodeURIComponent(str(a.deliverableId))}/status`, { status: str(a.status) }) },
];

/** Assert the worker env was threaded (tools that decrypt credentials / reach
 *  external providers need it; tests + the no-env path get a clear error). */
function requireEnv(ctx: BuiltinCtx): Env {
  if (!ctx.env) throw new Error('This tool requires the worker environment (credential access) and is unavailable in this context');
  return ctx.env;
}

/** Persist an integration credential's connectivity-test result. */
async function markTested(ctx: BuiltinCtx, credentialId: string, ok: boolean): Promise<void> {
  await ctx.db.update(integrationCredentials).set({ lastTestedAt: new Date(), lastTestOk: ok, updatedAt: new Date() }).where(and(eq(integrationCredentials.id, credentialId), eq(integrationCredentials.tenantId, ctx.tenantId)));
}

/** Load a task and assert it belongs to the caller's tenant (services that take
 *  only a task id don't verify ownership — the project lookup throws if not). */
async function getTenantTask(ctx: BuiltinCtx, id: number) {
  const task = await ctx.tasks.getTask(id);
  await ctx.projects.getProject(task.projectId, ctx.tenantId); // throws Forbidden/NotFound on mismatch
  return task;
}

/**
 * Fire the board's autonomous lane trigger for a Brain task write. This is the
 * SAME canonical {@link maybeAutoRunOnLaneEntry} the HTTP board path, RuntimeService
 * (agent hand-off) and qaRoutes all call — the single source of truth for "a ticket
 * entered a lane; run the lane's configured agent AS that agent". The decision and
 * dispatch logic live ONCE in that function; each status-write entry point only has
 * to invoke it from its own request context (a Worker needs `executionCtx.waitUntil`
 * to keep the dispatch alive past the response, and that is reachable only per
 * request — which is why it cannot be hoisted into TaskService construction).
 *
 * The Brain called {@link TaskService} directly and was the one status-writer that
 * never invoked the trigger, so a ticket the Brain moved into a staffed lane
 * silently never ran — the reported "even when the brain moves an item into the
 * swimlane the agent doesn't fire" bug.
 *
 * Crucially the run executes AS the LANE's agent (resolved inside the trigger from
 * `swimlane_agent_assignments`) and is independent of the ticket's own assignee —
 * a ticket assigned to a human or to another agent still gets worked by whoever
 * staffs the lane it enters, and its assignee is left untouched.
 *
 * Best-effort and off the tool's result path: backgrounded on the request's
 * `executionCtx` when present (so the run survives the tool returning), else awaited.
 * A no-env context (the service-stub unit tests) simply skips the trigger.
 */
/**
 * What the autonomy trigger decided for this write — returned to the MCP caller so
 * an agent knows whether its assignment/lane move actually started work.
 */
export interface McpAutoRunOutcome {
  /** True when autonomy dispatched (or is dispatching) a run for this ticket. */
  dispatched: boolean;
  reason: AutoRunReason;
  /** Human sentence for the reason — what to relay to the user verbatim. */
  detail: string;
  /** The agent the run was dispatched as (null when nothing ran). */
  agentRef: string | null;
  /** The agent a manual Run now WOULD use, when autonomy declined. */
  runNowCandidate?: string;
}

/**
 * The shared "evaluate, report, then dispatch" step behind both task triggers.
 *
 * The dispatch itself stays backgrounded (it can outlive the tool result), so the
 * caller can never learn its outcome from the returned promise. But the DECISION is
 * the cheap read-only {@link evaluateTaskAutoRun} — the same evaluator the trigger,
 * the board triage chip and Run-now all share — so running it inline gives the tool
 * result a truthful verdict without waiting on the run.
 */
async function evaluateAndDispatch(
  ctx: BuiltinCtx,
  env: Env,
  plain: { id: number; projectId: number; status: string },
  submittedBy: string,
): Promise<McpAutoRunOutcome> {
  const runtimeService = buildRuntimeService(env, ctx.db);
  const evaln = await evaluateTaskAutoRun(ctx.db, runtimeService, {
    tenantId: ctx.tenantId,
    projectId: plain.projectId,
    taskId: plain.id,
    status: plain.status,
  });
  // Always run the full trigger: beyond dispatching, it applies the lane requirement
  // gate (which can itself dispatch a reviewer round-trip) and emits the
  // `auto_run_skipped` / `auto_run_error` Observability events. Short-circuiting on
  // the evaluation above would silently drop both.
  const run = maybeAutoRunOnLaneEntry(env, ctx.db, runtimeService, {
    tenantId: ctx.tenantId,
    projectId: plain.projectId,
    taskId: plain.id,
    status: plain.status,
    submittedBy,
  });
  if (ctx.executionCtx) ctx.executionCtx.waitUntil(run);
  else await run;

  return {
    dispatched: evaln.canRunNow,
    reason: evaln.reason,
    detail: AUTO_RUN_REASON_TEXT[evaln.reason],
    agentRef: evaln.canRunNow ? evaln.decision.agentRef ?? evaln.assignedAgentRef : null,
    ...(!evaln.canRunNow && evaln.candidate ? { runNowCandidate: evaln.candidate.agentRef } : {}),
  };
}

async function fireLaneAutoRun(ctx: BuiltinCtx, task: Task, previousStatus?: string): Promise<McpAutoRunOutcome | null> {
  const env = ctx.env;
  if (!env) return null; // dispatch needs the worker env (credentials + runtime bindings)
  const plain = task.toPlain();
  // Only a genuine lane CHANGE triggers a run — a no-status-change update (title,
  // priority, reassignment) must not re-fire the lane's agent. A create has no
  // previousStatus, so it always evaluates the lane it was created into.
  if (previousStatus !== undefined && plain.status === previousStatus) return null;
  return evaluateAndDispatch(ctx, env, plain, ctx.userId ?? 'system:lane-auto');
}

/** Kind used on chat↔ticket links for a task-tier row (epic | gap | task). */
function taskLinkKind(task: Task): string {
  const t = (task.toPlain() as { taskType?: unknown }).taskType;
  return t === 'epic' || t === 'gap' ? t : 'task';
}

/**
 * Assignment → work handoff for a Brain task write. When a ticket's cloud-agent OWNER
 * changes to a new non-null ref, (1) fire the lane auto-run so the agent actually STARTS
 * working (idempotent, so safe alongside a lane-change {@link fireLaneAutoRun}), and
 * (2) bring the agent INTO every chat the ticket is linked to, with a "starting work"
 * notice — via {@link ChatTicketService.onTicketAgentAssigned}. This ports the HTTP PATCH
 * route's reassignment branch (taskRoutes) onto the MCP path — the one the Brain uses,
 * which previously did nothing on reassignment: assigning a dev agent left the ticket
 * inert and never joined the agent to the conversation. `previousAgentRef` omitted (a
 * create) treats any owner as newly assigned. Best-effort + backgrounded on the request's
 * executionCtx so it survives the tool returning; a no-env context simply skips it.
 */
async function fireAgentAssignmentHandoff(ctx: BuiltinCtx, task: Task, previousAgentRef?: string | null): Promise<McpAutoRunOutcome | null> {
  const env = ctx.env;
  if (!env) return null;
  const plain = task.toPlain() as { id: number; projectId: number; status: string; assignedAgentRef?: string | null };
  const newRef = plain.assignedAgentRef ?? null;
  if (!newRef || newRef === (previousAgentRef ?? null)) return null;
  const joinChats = new ChatTicketService(ctx.db, env)
    .onTicketAgentAssigned(ctx.tenantId, taskLinkKind(task), String(plain.id), newRef)
    .catch(() => {});
  if (ctx.executionCtx) ctx.executionCtx.waitUntil(joinChats);
  const outcome = await evaluateAndDispatch(ctx, env, plain, ctx.userId ?? 'system:agent-assign');
  if (!ctx.executionCtx) await joinChats;
  return outcome;
}

/** Flat, gateway-safe advertised name: `builtin_projects_list` (no dots). */
function advertisedName(tool: string): string {
  return `builtin_${tool.replace(/[^a-zA-Z0-9]+/g, '_')}`;
}

/**
 * Mask (don't drop) the access-restricted SECURITY tickets the MCP caller isn't
 * cleared for — the same surfaced-not-hidden model the HTTP board uses. The caller's
 * role rides in from ctx (a cloud agent runs as MANAGER and sees everything; a human
 * via Brain carries their real role), so this reuses the ONE shared visibility gate.
 */
async function maskSecurityTasks<T extends Record<string, unknown>>(ctx: BuiltinCtx, rows: T[]): Promise<T[]> {
  if (!rows.some((r) => r.taskType === TaskType.SECURITY)) return rows;
  const viewer = { userId: ctx.userId ?? null, role: ctx.role, isAgent: false };
  return new SecurityTicketAccessService(ctx.db, ctx.env).applyVisibilityForViewer(ctx.tenantId, viewer, rows);
}

function buildCtx(
  db: Db,
  tenantId: number,
  opts?: { env?: Env; userId?: string | null; role?: TenantRole; authToken?: string | null; executionCtx?: ExecutionContext },
): BuiltinCtx {
  const projectRepo = new ProjectRepository(db);
  const taskRepo = new TaskRepository(db);
  return {
    db,
    tenantId,
    projects: new ProjectService(projectRepo),
    tasks: new TaskService(taskRepo, projectRepo),
    env: opts?.env,
    userId: opts?.userId ?? null,
    role: opts?.role,
    authToken: opts?.authToken ?? null,
    executionCtx: opts?.executionCtx,
  };
}

/** Advertise the built-in platform tools (static metadata; no DB hit). */
export function listBuiltinTools(): McpToolEntry[] {
  return CATALOG.map((t) => ({
    extensionId: BUILTIN_EXTENSION_ID,
    tool: t.tool,
    name: advertisedName(t.tool),
    description: t.description,
    parameters: t.parameters,
    mutates: t.mutates,
  }));
}

/**
 * The curated subset of platform tools an AUTONOMOUS cloud coding agent may call
 * mid-run — the "work" surface so a run can create follow-up tasks for gaps it
 * finds, update OKR/objective progress, and read what's remaining, instead of
 * silently dropping out-of-scope work. It deliberately EXCLUDES every admin or
 * destructive tool: no deletes, no execution control-plane mutations
 * (executions.submit/cancel/post_message), and nothing under
 * api_keys/security/provider_keys/migrations/agent_hosts/board_connections/cron/…
 * An explicit allowlist is safe-by-default: a newly-added CATALOG tool is NOT
 * granted to an unattended agent until it is listed here. Kept honest by a
 * CATALOG-membership test (every id below must exist in CATALOG).
 */
export const CLOUD_AGENT_PLATFORM_TOOLS: readonly string[] = [
  // Session introspection — read-only. Lets a run answer "what model am I on?" and
  // report the model/tier it is actually driving on the timeline.
  'session.current_model',
  // Projects — read + write (no delete)
  'projects.list', 'projects.get', 'projects.create', 'projects.update', 'projects.check_key',
  // Tasks — read + write + move + assignees (no delete). "create other tasks for gaps".
  'tasks.list', 'tasks.get', 'tasks.create', 'tasks.update', 'tasks.move', 'tasks.assignees',
  // Workforce roster — the tenant's own cloud agents (any publish state), so an agent
  // handing work off knows the REAL agents that exist and their ids (never invents a ref).
  'cloud_agents.list_mine',
  // Specs / PRDs — read + write (no delete)
  'specs.list', 'specs.get', 'specs.create', 'specs.patch',
  // Strategy / OKRs — read + write (no delete). "update project related items (OKR)".
  'portfolios.list', 'portfolios.create', 'portfolios.update',
  'initiatives.list', 'initiatives.create', 'initiatives.update',
  'objectives.list', 'objectives.create', 'objectives.update', 'objectives.add_link', 'objectives.remove_link', 'objectives.promote_orphans',
  'key_results.list', 'key_results.create', 'key_results.update',
  'work_items.convert_type', 'pmo.tree', 'pmo.rollup', 'pmo.link_project', 'pmo.add_dependency',
  // Team chat — a PM/manager agent asks the team for status or shares a burndown.
  'team_chat.read', 'team_chat.post',
  // Project knowledge, files, review
  'project_facts.recall', 'project_facts.remember',
  'project_files.list', 'project_files.read', 'project_files.save',
  'attachments.read', 'attachments.write',
  'reviews.record', 'tickets.from_delta',
  // Kanban role sign-off — a reviewer agent clears a lane's role/review requirement so
  // the swimlane can advance (the round-trip that used to need a hand HTTP call). Read
  // the coverage audit to see what it still needs to satisfy.
  'kanban.signoff', 'kanban.audit',
  // Coordinated role participation (PRD "Coordinated Role Participation") — a Coordinator/
  // Manager agent reads the ticket's Participation Manifest + Accountability Report to know
  // which required roles still must execute + sign off, and performs a Resource Assessment
  // (add a role the ticket needs beyond the template). Without these on the allowlist an
  // unattended Coordinator can SEE the tools in the catalog but not invoke them.
  'kanban.participants', 'kanban.accountability', 'kanban.assess_resource',
  'kanban.coordinate', 'kanban.materialize_work_items',
  // Security agent: file SOC 2 findings mid-run. NOT security.configure_access —
  // deciding who can see security tickets is an admin action, never an unattended
  // agent reconfiguring its own findings' visibility.
  'security.record_finding',
  // Incident Manager: triage help-desk tickets into incidents, classify the affected
  // system, page/escalate on-call, and post war-room updates. NOT the on-call/policy
  // CRUD — configuring rotations & escalation policies is a human/admin action.
  'incidents.open', 'incidents.classify', 'incidents.update', 'incidents.add_note',
  'incidents.list', 'incidents.get', 'incidents.postmortem', 'oncall.page', 'oncall.list',
  // Knowledge recall — any agent can search the KB (SOPs, processes, prior RCAs /
  // known-errors) so it learns from documented practice + past incidents mid-run —
  // and author a standalone SOP / runbook / known-error article directly.
  'knowledge.search', 'knowledge.create',
  // Gig Marketplace: a Product-Manager/Designer agent may publish work, run the hiring
  // funnel, evaluate proposals with AI, and schedule review/interview meetings.
  'marketplace.publish_ticket', 'marketplace.unpublish_ticket',
  'jobs.create', 'jobs.list_mine', 'jobs.proposals',
  'proposals.evaluate', 'proposals.shortlist', 'proposals.decline',
  'meetings.schedule', 'deliverables.evaluate', 'deliverables.set_status',
  // Executions — READ ONLY (accurate "what's remaining"; no submit/cancel/post_message)
  'executions.get', 'executions.list_active', 'executions.list_for_task', 'executions.list_recent',
  'executions.task_file_changes', 'executions.trace',
];

/** Chat-scoped tools an agent gets ONLY when it is replying INSIDE a Brain chat (the
 *  `@agent` addressed-reply loop) — where a current `chatId` exists to act on. Read the
 *  conversation's linked work + tie/untie tickets to THIS chat, so an agent asked to
 *  "link these tickets to the chat" actually can. Deliberately NOT part of
 *  CLOUD_AGENT_PLATFORM_TOOLS: an autonomous cloud run has no chat context, and the
 *  escalation/destructive members (dispatch_agent = start a run, invite_agent, consolidate
 *  = archive+merge chats) stay off — same restraint as excluding executions.submit. */
export const CHAT_SCOPED_AGENT_TOOLS: readonly string[] = [
  'chats.get_messages', 'chats.list_tickets', 'chats.link_ticket', 'chats.unlink_ticket',
  'chats.ticket_lineage', 'chats.list_agents',
];

const CLOUD_AGENT_PLATFORM_SET: ReadonlySet<string> = new Set(CLOUD_AGENT_PLATFORM_TOOLS);

let _cloudAgentPlatformSchemas: ToolSchema[] | undefined;
/** OpenAI-shape tool schemas for the curated cloud-agent platform subset, named with
 *  the gateway-safe `builtin_*` prefix (dots are invalid in tool-call names). Concats
 *  directly onto CLOUD_AGENT_TOOLS in the cloud loop. Memoized (static metadata). */
export function cloudAgentPlatformToolSchemas(): ToolSchema[] {
  if (!_cloudAgentPlatformSchemas) {
    _cloudAgentPlatformSchemas = CATALOG
      .filter((t) => CLOUD_AGENT_PLATFORM_SET.has(t.tool))
      .map((t) => ({
        type: 'function',
        function: { name: advertisedName(t.tool), description: t.description, parameters: t.parameters as ToolSchema['function']['parameters'] },
      }));
  }
  return _cloudAgentPlatformSchemas;
}

let _cloudAgentPlatformNameMap: Map<string, string> | undefined;
/** Reverse an advertised `builtin_*` name to its dotted CATALOG id — but ONLY for the
 *  curated subset (undefined otherwise), so the cloud agent can never reach an off-list
 *  platform tool even if the model hallucinates one. Memoized. */
export function resolveCloudAgentPlatformTool(advertised: string): string | undefined {
  if (!_cloudAgentPlatformNameMap) {
    _cloudAgentPlatformNameMap = new Map(CLOUD_AGENT_PLATFORM_TOOLS.map((t) => [advertisedName(t), t]));
  }
  return _cloudAgentPlatformNameMap.get(advertised);
}

/** Canonical verbs for the common mutating tools so an MCP-driven change reads the
 *  same on the audit timeline as its HTTP-route twin; the rest fall back to the
 *  dotted tool id (still readable, e.g. "portfolios.create"). */
const MCP_VERB: Record<string, string> = {
  'tasks.create': 'task.created', 'tasks.update': 'task.updated', 'tasks.move': 'task.moved', 'tasks.delete': 'task.deleted',
  // kanban.signoff / kanban.assess_resource self-emit at their HTTP routes (see SELF_EMITTING_TOOLS).
  'objectives.create': 'okr.objective_created', 'objectives.update': 'okr.objective_updated', 'objectives.delete': 'okr.objective_deleted',
  'key_results.create': 'okr.kr_created',
  'marketplace.publish_ticket': 'gig.published', 'marketplace.unpublish_ticket': 'gig.unpublished',
  'jobs.create': 'job.posted', 'proposals.evaluate': 'proposal.evaluated', 'proposals.shortlist': 'proposal.shortlisted',
  'proposals.decline': 'proposal.declined', 'meetings.schedule': 'meeting.scheduled',
  'deliverables.evaluate': 'deliverable.evaluated', 'deliverables.set_status': 'deliverable.updated',
};

/** Best-effort audit emit for a mutating built-in tool — the ONE place every
 *  MCP-/Brain-/agent-driven mutation (OKR, portfolio, brain-created ticket, …)
 *  reaches the unified activity log. Never throws. */
/** Tools whose replayed HTTP route now records its OWN (richer, role-attributed)
 *  activity — skip the generic wrapper emit for them to avoid a double entry. */
const SELF_EMITTING_TOOLS = new Set(['kanban.signoff', 'kanban.assess_resource']);

async function emitBuiltinToolActivity(env: Env, db: Db, tenantId: number, userId: string | null | undefined, tool: string, result: unknown): Promise<void> {
  if (SELF_EMITTING_TOOLS.has(tool)) return;
  try {
    const actor = userId ? await resolveHumanActor(env, db, tenantId, userId) : SYSTEM_ACTOR;
    const r = (result && typeof result === 'object') ? (result as Record<string, unknown>) : null;
    const targetId = r && (typeof r.id === 'string' || typeof r.id === 'number') ? r.id : null;
    const label = r ? ((r.title ?? r.name ?? null) as string | null) : null;
    const [domain] = tool.split('.');
    await recordActivity(env, db, {
      tenantId,
      projectId: r && typeof r.projectId === 'number' ? r.projectId : null,
      actor,
      verb: MCP_VERB[tool] ?? tool,
      targetType: domain ?? null,
      targetId,
      targetLabel: label,
      summary: `${tool}${label ? `: ${label}` : ''}`.slice(0, 300),
      metadata: { via: 'mcp', tool },
    });
  } catch { /* best-effort audit */ }
}

/** Run one built-in tool in-process, tenant-scoped. Throws on unknown tool. */
export async function callBuiltinTool(
  db: Db,
  args: { tenantId: number; tool: string; arguments: unknown; env?: Env; userId?: string | null; role?: TenantRole; authToken?: string | null; executionCtx?: ExecutionContext },
): Promise<unknown> {
  const entry = CATALOG.find((t) => t.tool === args.tool);
  if (!entry) throw new Error(`Unknown built-in tool '${args.tool}'`);
  const ctx = buildCtx(db, args.tenantId, { env: args.env, userId: args.userId, role: args.role, authToken: args.authToken, executionCtx: args.executionCtx });
  const result = await entry.run(ctx, (args.arguments ?? {}) as Json);
  // Unified audit stream: record any mutating tool run (best-effort, off the result).
  if (entry.mutates && args.env) {
    const emit = emitBuiltinToolActivity(args.env, db, args.tenantId, args.userId, args.tool, result);
    if (args.executionCtx?.waitUntil) args.executionCtx.waitUntil(emit); else await emit.catch(() => {});
    // task/spec/from-delta writes change what the chat↔ticket link picker can find but
    // (unlike the pmo/roadmap/project tools) don't route through invalidateProjectsList /
    // bumpPmo / invalidateRoadmap — so orphan the typeahead cache here for those.
    if (args.tool.startsWith('tasks.') || args.tool.startsWith('specs.') || args.tool === 'tickets.from_delta') {
      const bump = bumpTicketSearchVersion(args.env, args.tenantId);
      if (args.executionCtx?.waitUntil) args.executionCtx.waitUntil(bump); else await bump.catch(() => {});
    }
  }
  return result;
}

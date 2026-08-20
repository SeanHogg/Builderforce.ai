import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { ToolService } from '../../application/tools/ToolService';
import type { AuditRunner } from '../../application/tools/AuditRunner';
import type { RuntimeService } from '../../application/runtime/RuntimeService';
import { listSystemAudits } from '../../application/tools/systemAudits';
import { isMaturityFrameworkId, listMaturityFrameworks, type MaturityFrameworkId } from '../../application/tools/maturityFrameworks';
import { toolLocaleFromHeaders, type ToolLocale } from '../../application/tools/toolMessages';
import { headerHints } from '../../application/email/emailLocaleResolver';
import { maybeAutoRunOnLaneEntry } from './taskRoutes';

/**
 * Diagnostics & Tools routes.
 *
 * `GET /` (list), `GET /:id` (definition), and `POST /:id/compute` are PUBLIC —
 * the free, logged-out preview. Compute is pure math/scoring over user-supplied
 * input (no tenant data), so it is safe to run without an account. Saving a run
 * and listing history require auth + a leadership (manager+) role, matching the
 * "free to preview, account to save" model.
 *
 * Diagnostics can also be run AGAINST A PROJECT (pass `projectId`): those runs
 * are tracked into a per-project rating (`GET /projects/:projectId/score`) that
 * rolls up to the workspace (`GET /rollup`).
 */
/** A generous résumé is ~8k characters; 40k leaves room for a pasted portfolio
 *  without letting one request burn the isolate's CPU budget. */
const MAX_DOCUMENT_CHARS = 40_000;

/** The requested maturity lens, or undefined for the default. Narrowed here so
 *  both the public compute and the data-driven route read the parameter the same
 *  way — one spelling of "which framework", not two. */
function frameworkParam(raw: string | undefined): MaturityFrameworkId | undefined {
  return isMaturityFrameworkId(raw) ? raw : undefined;
}

/**
 * The language a tool's content is served in.
 *
 * Read from the request rather than from the account, and through the SAME
 * `localeFromHeaders` chain email uses — the explicit `X-Builderforce-Locale`
 * header the app stamps, then the NEXT_LOCALE cookie, then `Accept-Language`.
 * The account is deliberately not consulted here: these endpoints are PUBLIC,
 * the free logged-out diagnostics are the platform's front door, and a visitor
 * with no account still has a language.
 */
function toolLocale(req: { header(name: string): string | undefined }): ToolLocale {
  return toolLocaleFromHeaders(headerHints(req));
}

export function createToolRoutes(
  toolService: ToolService,
  auditRunner: AuditRunner,
  db: Db,
  runtimeService: RuntimeService,
): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // Public definitions need no cache (static in-memory data, no DB round-trip).
  router.get('/', (c) => c.json({ tools: toolService.list(toolLocale(c.req)) }));

  // ── System audits (SOC 2, Architecture, Quality, PM Vision) — the onboarding
  //    "run an audit → get a report" surface. Registered before `/:id` so the
  //    static `audits` segment wins over the `:id` param. ────────────────────

  // List the audit types (public — powers the onboarding wizard + marketing).
  router.get('/audits', (c) => c.json({ audits: listSystemAudits() }));

  // The maturity FRAMEWORKS a scorecard can be reported under (CMMI practices,
  // COBIT domains, ITIL value chain). Public and static in-memory data — no cache
  // needed and no DB round-trip — and registered before `/:id` so the static
  // segment wins over the param. Powers the framework toggle on the diagnostic.
  router.get('/maturity-frameworks', (c) => c.json({ frameworks: listMaturityFrameworks() }));

  // Run an audit against a project: scores a report (deterministic), records it
  // as a project diagnostic, notifies the user, and files the agent remediation
  // ticket (best-effort). Manager+.
  router.post('/audits/:auditId/run', authMiddleware, requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const auditId = c.req.param('auditId');
    const body = await c.req.json<{ projectId?: number }>().catch(() => ({} as { projectId?: number }));
    const projectId = Number(body.projectId);
    if (!Number.isFinite(projectId)) return c.json({ error: 'projectId is required' }, 400);

    const secret = (c.env as Env).INTEGRATION_ENCRYPTION_SECRET ?? (c.env as Env).JWT_SECRET ?? '';
    const outcome = await auditRunner.runAudit(c.env as Env, { tenantId, projectId, auditId, userId, secret });
    if (!outcome) return c.json({ error: 'Unknown audit' }, 404);

    // Fire the existing lane-autorun trigger for every remediation ticket filed
    // (one per gap when the audit is ticketPerFinding, else the single bundled
    // ticket). Kept alive past the response via waitUntil, exactly like taskRoutes.
    const remediationTasks = outcome.agentTasks ?? (outcome.agentTask ? [outcome.agentTask] : []);
    for (const task of remediationTasks) {
      c.executionCtx.waitUntil(
        maybeAutoRunOnLaneEntry(c.env as Env, db, runtimeService, {
          tenantId, projectId, taskId: task.taskId, status: task.status, submittedBy: userId,
        }).catch(() => false),
      );
    }
    return c.json(outcome, 201);
  });

  // ── Project / tenant rating — registered before `/:id` so the static segments
  //    win over the `:id` param. Read-only diagnostic SCORES (SOC 2 / Quality
  //    readiness, remediation status) are viewer-safe: every workspace member,
  //    not just managers, sees their project's diagnostics strip. (Running an
  //    audit + the raw finding tickets remain manager/role-gated elsewhere.) ────
  router.get('/rollup', authMiddleware, requireRole(TenantRole.VIEWER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    return c.json(await toolService.getTenantRollup(c.env as Env, tenantId));
  });

  router.get('/projects/:projectId/score', authMiddleware, requireRole(TenantRole.VIEWER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId)) return c.json({ error: 'Invalid project id' }, 400);
    return c.json(await toolService.getProjectScore(c.env as Env, tenantId, projectId));
  });

  router.get('/:id', (c) => {
    const def = toolService.getDefinition(c.req.param('id'), toolLocale(c.req));
    return def ? c.json({ tool: def }) : c.json({ error: 'Unknown tool' }, 404);
  });

  // Public free compute — no tenant data, pure scoring.
  router.post('/:id/compute', async (c) => {
    const body = await c.req.json<{ input?: Record<string, number> }>().catch(() => ({ input: {} }));
    // `framework` re-lenses a maturity scorecard (COBIT / ITIL). An unknown value
    // degrades to the default lens rather than 400-ing: it changes how one result
    // is GROUPED, and refusing to score at all over a bad grouping helps nobody.
    const result = toolService.compute(c.req.param('id'), body.input ?? {}, frameworkParam(c.req.query('framework')), toolLocale(c.req));
    return result ? c.json({ result }) : c.json({ error: 'Unknown tool' }, 404);
  });

  /**
   * Public free analysis — the career analyzers, which read DOCUMENTS rather than
   * numbers. Same purity guarantee as `/compute`: no tenant data, no vendor call,
   * no model — just string work over what the caller pasted.
   *
   * DELIBERATELY UNCACHED. The usual rule is that a new read path serves through
   * `getOrSetCached`, and it does not apply here: the cache key would have to be a
   * hash of a whole résumé, so the keyspace is unbounded and the hit rate is
   * approximately zero — every document is different, and the same person pasting
   * twice is the rare case. A KV round trip would cost more than the analysis it
   * replaces, which is a few milliseconds of tokenising in the isolate.
   *
   * Documents are capped so a paste cannot turn into a CPU-time denial of service.
   */
  router.post('/:id/analyze', async (c) => {
    const body = await c.req.json<{ input?: Record<string, string> }>().catch(() => ({ input: {} }));
    const input: Record<string, string> = {};
    for (const [key, value] of Object.entries(body.input ?? {})) {
      if (typeof value === 'string') input[key] = value.slice(0, MAX_DOCUMENT_CHARS);
    }
    const result = toolService.analyze(c.req.param('id'), input, toolLocale(c.req));
    return result ? c.json({ result }) : c.json({ error: 'Unknown tool' }, 404);
  });

  // Data-driven ("from your data") result — telemetry-derived, manager+. Optional
  // `projectId` scopes it to one project.
  router.get('/:id/data-driven', authMiddleware, requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const days = Math.min(Math.max(Number(c.req.query('days') ?? 90), 7), 365);
    const projectId = c.req.query('projectId') ? Number(c.req.query('projectId')) : null;
    const framework = frameworkParam(c.req.query('framework'));
    const result = await toolService.getDataDriven(c.env as Env, tenantId, c.req.param('id'), days, projectId, framework, toolLocale(c.req));
    return result ? c.json({ result, days, framework }) : c.json({ error: 'No data-driven mode for this tool' }, 404);
  });

  // Save a run — recomputed server-side, persisted to the workspace (or project).
  router.post('/:id/save', authMiddleware, requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const body = await c.req.json<{ input?: Record<string, number>; kind?: 'self' | 'data'; projectId?: number | null }>();
    const saved = await toolService.saveRun(c.env as Env, {
      tenantId,
      toolId: c.req.param('id'),
      kind: body.kind === 'data' ? 'data' : 'self',
      input: body.input ?? {},
      projectId: body.projectId ?? null,
      createdBy: userId,
    });
    return saved ? c.json({ run: saved }, 201) : c.json({ error: 'Unknown tool or no data available' }, 404);
  });

  // Saved history, re-rendered in the READER's language rather than the saver's.
  // The locale comes off the request, exactly as it does for the public
  // definitions — a workspace is not monolingual, and the run belongs to the
  // workspace while the language belongs to whoever is looking at it.
  router.get('/:id/runs', authMiddleware, requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const projectId = c.req.query('projectId') ? Number(c.req.query('projectId')) : null;
    const runs = await toolService.listRuns(c.env as Env, tenantId, c.req.param('id'), projectId, toolLocale(c.req));
    return c.json({ runs });
  });

  return router;
}

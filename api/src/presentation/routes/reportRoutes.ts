/**
 * Dev analytics report routes – /api/reports
 *
 * On-demand and scheduled report generation.
 *
 * GET  /api/reports/standup          Daily standup report (MANAGER+)
 * GET  /api/reports/code-review      Code review report (MANAGER+)
 * GET  /api/reports/executive        Executive summary report (MANAGER+)
 * GET  /api/reports/completed-by-assignee  Tasks completed per assignee over a window (MANAGER+)
 *
 * GET  /api/reports/schedules        List report schedules (MANAGER+)
 * POST /api/reports/schedules        Create schedule (MANAGER+)
 * PATCH /api/reports/schedules/:id   Update schedule (MANAGER+)
 * DELETE /api/reports/schedules/:id  Delete schedule (MANAGER+)
 *
 * GET  /api/reports/subscriptions    Get my subscriptions (any user)
 * POST /api/reports/subscriptions    Update my subscriptions (any user)
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { requirePermission } from '../middleware/requirePermission';
import { PERMISSIONS } from '../../domain/permissions/permissionRegistry';
import { REPORT_TYPES } from '../../domain/reports/reportTypes';
import { TenantRole } from '../../domain/shared/types';
import { generateProjectStatusReport } from '../../application/reports/projectStatusReport';
import { generateInactiveContributorsReport, generateTeamComparisonReport } from '../../application/reports/devActivityReports';
import { generatePortfolioReport } from '../../application/reports/portfolioReport';
import { clampCompletedWindowDays } from '../../application/reports/completedByAssignee';
import {
  cachedCodeReviewReport,
  cachedCompletedByAssigneeReport,
  cachedExecutiveReport,
  cachedStandupReport,
} from '../../application/reports/reportCache';
import {
  createReportSchedule,
  deleteReportSchedule,
  listBoardPackFrameSubjects,
  listReportSchedules,
  patchReportSchedule,
} from '../../application/reports/reportSchedules';
import { listReportSubscriptions, setReportSubscriptions } from '../../application/reports/reportSubscriptions';
import {
  FEEDBACK_STATUSES,
  isFeedbackStatus,
  listCustomerFeedback,
  triageCustomerFeedback,
} from '../../application/reports/customerFeedbackInbox';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { parseBody, parseOptionalBody, z } from './requestBody';

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

/** `reportType` / `schedule` stay loose strings so the ONE schedule decision
 *  (`application/reports/schedulePatch.ts`) owns the "required" / "must be one of" 400s. */
const CreateScheduleBody = z.object({
  reportType: z.string().nullish(),
  schedule: z.string().nullish(),
  deliveryHour: z.number().nullish(),
  recipients: z.array(z.string()).optional(),
  subjectKind: z.string().nullish(),
  subjectRef: z.string().nullish(),
});
const UpdateScheduleBody = z.object({
  reportType: z.string().optional(),
  subjectKind: z.string().nullish(),
  subjectRef: z.string().nullish(),
  deliveryHour: z.number().optional(),
  recipients: z.array(z.string()).optional(),
  isEnabled: z.boolean().optional(),
});
const SubscriptionsBody = z.array(z.object({ reportType: z.enum(REPORT_TYPES), isSubscribed: z.boolean() }));
/** `status` stays optional so the handler's own "status must be one of" wins. */
const TriageFeedbackBody = z.object({
  status: z.string().nullish(),
  taskId: z.number().nullish(),
});

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function createReportRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // ── GET /api/reports/standup ──────────────────────────────────────────────
  router.get('/standup', requirePermission(PERMISSIONS.REPORT_READ), requireRole(TenantRole.MANAGER), async (c) => {
    const dateParam = c.req.query('date');
    const date = dateParam ? new Date(dateParam) : new Date();
    return c.json(await cachedStandupReport(c.env as Env, db, c.get('tenantId') as number, date, dateParam ?? undefined));
  });

  // ── GET /api/reports/code-review ─────────────────────────────────────────
  router.get('/code-review', requirePermission(PERMISSIONS.REPORT_READ), requireRole(TenantRole.MANAGER), async (c) => {
    const to   = new Date();
    const from = new Date(to.getTime() - 14 * DAY_MS);
    return c.json(await cachedCodeReviewReport(c.env as Env, db, c.get('tenantId') as number, from, to));
  });

  // ── GET /api/reports/executive ────────────────────────────────────────────
  router.get('/executive', requirePermission(PERMISSIONS.REPORT_READ), requireRole(TenantRole.MANAGER), async (c) => {
    const toParam   = c.req.query('to');
    const fromParam = c.req.query('from');
    const to   = toParam   ? new Date(toParam)   : new Date();
    const from = fromParam ? new Date(fromParam) : new Date(to.getTime() - 30 * DAY_MS);
    const windowKey = `${fromParam ?? from.toISOString().slice(0, 10)}:${toParam ?? to.toISOString().slice(0, 10)}`;
    return c.json(await cachedExecutiveReport(c.env as Env, db, c.get('tenantId') as number, from, to, windowKey));
  });

  // ── GET /api/reports/portfolio ────────────────────────────────────────────
  // PMO portfolio rollup exec summary (schedulable as report_type 'portfolio_rollup').
  router.get('/portfolio', requirePermission(PERMISSIONS.REPORT_READ), requireRole(TenantRole.MANAGER), async (c) =>
    c.json(await generatePortfolioReport(db, c.get('tenantId') as number, c.get('segmentId') as string)));

  // ── GET /api/reports/project-status ───────────────────────────────────────
  // Per-project delivery digest (schedulable as report_type 'project_status').
  router.get('/project-status', requirePermission(PERMISSIONS.REPORT_READ), requireRole(TenantRole.MANAGER), async (c) =>
    c.json(await generateProjectStatusReport(db, c.get('tenantId') as number, c.get('segmentId') as string)));

  // ── GET /api/reports/completed-by-assignee ───────────────────────────────
  // Weekly-oversight rollup: tasks moved into a done-class lane in the last N
  // days, grouped by assignee (human OR agent). Cached read-through keyed on
  // (tenant, window) — invalidated on any task status write via
  // invalidateCompletedByAssignee() in taskRoutes.ts; the KV TTL is the backstop.
  router.get('/completed-by-assignee', requirePermission(PERMISSIONS.REPORT_READ), requireRole(TenantRole.MANAGER), async (c) => {
    const days = clampCompletedWindowDays(c.req.query('days'));
    return c.json(await cachedCompletedByAssigneeReport(c.env as Env, db, c.get('tenantId') as number, days));
  });

  // ── GET /api/reports/team-comparison ─────────────────────────────────────
  router.get('/team-comparison', requirePermission(PERMISSIONS.REPORT_READ), requireRole(TenantRole.MANAGER), async (c) => {
    const to   = c.req.query('to')   ? new Date(c.req.query('to')!)   : new Date();
    const from = c.req.query('from') ? new Date(c.req.query('from')!) : new Date(to.getTime() - 30 * DAY_MS);
    return c.json(await generateTeamComparisonReport(db, c.get('tenantId') as number, from, to));
  });

  // ── GET /api/reports/inactive-contributors ────────────────────────────────
  router.get('/inactive-contributors', requirePermission(PERMISSIONS.REPORT_READ), requireRole(TenantRole.MANAGER), async (c) => {
    const days = c.req.query('days') ? Math.max(1, parseInt(c.req.query('days')!, 10)) : 14;
    return c.json(await generateInactiveContributorsReport(db, c.get('tenantId') as number, days));
  });

  // ── GET /api/reports/schedules ────────────────────────────────────────────
  router.get('/schedules', requirePermission(PERMISSIONS.REPORT_READ), requireRole(TenantRole.MANAGER), async (c) =>
    c.json({ schedules: await listReportSchedules(db, c.get('tenantId') as number) }));

  // ── GET /api/reports/schedules/board-pack/frames?sessionId= ───────────────
  // The frames on a board that could back a `board_pack` schedule — what the
  // "schedule this" picker reads before it posts a subject below.
  router.get('/schedules/board-pack/frames', requirePermission(PERMISSIONS.REPORT_READ), requireRole(TenantRole.MANAGER), async (c) => {
    const sessionId = (c.req.query('sessionId') ?? '').trim();
    if (!sessionId) return c.json({ error: 'sessionId is required' }, 400);
    return c.json({ frames: await listBoardPackFrameSubjects(db, c.get('tenantId') as number, sessionId) });
  });

  // ── POST /api/reports/schedules ───────────────────────────────────────────
  router.post('/schedules', requirePermission(PERMISSIONS.REPORT_EXPORT), requireRole(TenantRole.MANAGER), async (c) => {
    const result = await createReportSchedule(db, c.get('tenantId') as number, await parseBody(c, CreateScheduleBody));
    return result.ok ? c.json(result.row, 201) : c.json({ error: result.error }, result.status);
  });

  // ── PATCH /api/reports/schedules/:id ─────────────────────────────────────
  router.patch('/schedules/:id', requirePermission(PERMISSIONS.REPORT_EXPORT), requireRole(TenantRole.MANAGER), async (c) => {
    const body = await parseBody(c, UpdateScheduleBody);
    const result = await patchReportSchedule(db, c.get('tenantId') as number, c.req.param('id'), body);
    return result.ok ? c.json(result.row) : c.json({ error: result.error }, result.status);
  });

  // ── DELETE /api/reports/schedules/:id ────────────────────────────────────
  router.delete('/schedules/:id', requirePermission(PERMISSIONS.REPORT_EXPORT), requireRole(TenantRole.MANAGER), async (c) => {
    await deleteReportSchedule(db, c.get('tenantId') as number, c.req.param('id'));
    return c.json({ deleted: true });
  });

  // ── GET /api/reports/subscriptions ───────────────────────────────────────
  router.get('/subscriptions', requirePermission(PERMISSIONS.REPORT_READ), async (c) =>
    c.json({ subscriptions: await listReportSubscriptions(db, c.get('tenantId') as number, c.get('userId') as string) }));

  // ── POST /api/reports/subscriptions ──────────────────────────────────────
  router.post('/subscriptions', requirePermission(PERMISSIONS.REPORT_READ), async (c) => {
    const body = await parseBody(c, SubscriptionsBody);
    const updated = await setReportSubscriptions(db, c.get('tenantId') as number, c.get('userId') as string, body);
    return c.json({ updated });
  });

  // ── Voice-of-Customer inbox (ingested customer_feedback triage) ───────────
  // GET  /api/reports/feedback        list the segment's feedback (?status=new|triaged|dismissed)
  // PATCH /api/reports/feedback/:id   triage: flip status, optionally link a backlog task
  router.get('/feedback', async (c) => {
    const rows = await listCustomerFeedback(db, c.get('tenantId') as number, c.get('segmentId') as string, c.req.query('status'));
    return c.json({ feedback: rows });
  });

  router.patch('/feedback/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const body = await parseOptionalBody(c, TriageFeedbackBody);
    if (!isFeedbackStatus(body.status)) {
      return c.json({ error: `status must be one of: ${FEEDBACK_STATUSES.join(', ')}` }, 400);
    }
    const result = await triageCustomerFeedback(
      db, c.get('tenantId') as number, c.get('segmentId') as string, c.req.param('id'), body.status, body.taskId,
    );
    return result.ok ? c.json(result.row) : c.json({ error: result.error }, result.status);
  });

  return router;
}

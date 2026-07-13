import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { DeadlineService } from '../application/deadlines/DeadlineService.js';
import { DeadlineNotifier } from '../application/deadlines/DeadlineNotifier.js';
import { DeadlineExport } from '../application/deadlines/DeadlineExport.js';
import { DeadlinePresenter } from '../application/deadlines/DeadlinePresenter.js';
import {
  validateRequestDto,
  parseQuery,
  deadlineUpdateSchema,
  canRequireSlipReason,
  handleZodError,
  zodErrorResponse,
} from './deadline.dto';

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

interface DeadlineServiceDependencies {
  deadlineRepo: ReturnType<typeof DeadlineService>[0];
  dependencyRepo: ReturnType<typeof DeadlineService>[1];
  auditStore: ReturnType<typeof DeadlineService>[2];
}

interface DeadlineNotifierDependencies {
  deadlineRepo: any;
  auditStore: any;
}

// ---------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------

const router = express.Router();

// Mock stubs for current service injection; replace with concrete deps when services resolve.
const deadlineService = new DeadlineService(
  undefined, // deadlineRepo
  undefined, // dependencyRepo
  undefined, // auditLog
);

const deadlineNotifier = new DeadlineNotifier(undefined, undefined);

const deadlineExportService = new DeadlineExport(undefined, undefined);

// ---------------------------------------------------------------------
// Ingestion (FR-1, AC-1)
// ---------------------------------------------------------------------

/** POST /deadlines/ingest */
router.post('/deadlines/ingest', async (req, res) => {
  const body = req.body;
  const parsed = validateRequestDto(body, validateRequestDto);
  if (!parsed.success) {
    return res.status(422).json({ error: 'Invalid ingestion format', details: parsed.error });
  }

  try {
    const result = await deadlineService.create({
      tenantId: body.tenantId,
      projectId: body.projectId,
      title: body.title,
      type: body.type,
      owner: body.owner,
      dueDate: new Date(body.dueDate),
      priority: body.priority,
      tags: body.tags,
      description: body.description,
      dependentDeadlineIds: body.dependentDeadlineIds,
    });

    // Mark synced from source system with canonical source_id or external_ref
    const resultOut = await deadlineRepo.updateProps(result.id, {
      syncedFromSource: body.sourceId || undefined,
      externalSystem: body.sourceType,
      updatedAt: new Date(),
    });

    res.status(201).json(resultOut);
  } catch (err) {
    console.error('[ingest] Failed to create deadline:', err);
    return res.status(500).json({ error: 'Internal server error', details: err instanceof Error ? err.message : undefined });
  }
});

/** Batch POST /deadlines/ingest/batch */
router.post('/deadlines/ingest/batch', async (req, res) => {
  const { deadlineList, sourceType, sourceId } = req.body;

  if (!Array.isArray(deadlineList) || deadlineList.length === 0) {
    return res.status(400).json({ error: 'Expected deadlineList' });
  }

  const createdIds: number[] = [];
  const errors: Array<{ id: number; error: string }> = [];

  for (const deadline of deadlineList) {
    try {
      const d = await deadlineService.create({
        tenantId: deadline.tenantId,
        projectId: deadline.projectId,
        title: deadline.title,
        type: deadline.type,
        owner: deadline.owner,
        dueDate: new Date(deadline.dueDate),
        priority: deadline.priority,
        tags: deadline.tags,
        dependentDeadlineIds: deadline.dependentDeadlineIds,
      });
      createdIds.push(d.id);
    } catch (err) {
      errors.push({ id: -1, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  }

  res.json({
    createdCount: createdIds.length,
    createdIds,
    errorCount: errors.length,
    errors,
  });
});

/** PATCH /deadlines/:id */
router.patch('/deadlines/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  const updates = req.body;
  const actor = req.user?.id || 'system';

  // ---------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------
  if (!Array.isArray(Array.from(updates))) {
    try {
      const validated = deadlineUpdateSchema.parse(updates);
      // Check requirement for slipReason (depending on who checks it)
      if (canRequireSlipReason({ ...validated, slipReason: updates.slipReason })) {
        if (!validated.slipReason || validated.slipReason.trim().length === 0) {
          return handleZodError(req, res, next, z.zodError({
            issues: [{
              code: z.ZodIssueCode.custom,
              path: ['slipReason'],
              message: 'slipReason is required when changing due_date or dependent deadlines',
            }],
          }));
        }

        const { slipReason, ...rest } = validated;
        updates.slipReason = slipReason;
        Object.assign(updates, rest);
      }
    } catch (err) {
      if (err instanceof z.ZodError) {
        return handleZodError(req, res, next, err);
      }
      return next(err);
    }
  }

  // ---------------------------------------------------------------------
  // Service call
  // ---------------------------------------------------------------------
  try {
    const result = await deadlineService.update(id, updates, actor);
    if (!result) {
      return res.status(404).json({ error: 'Not found' });
    }

    if (updates.healthOverride === 'on_track' || updates.healthOverride === 'at_risk' || updates.healthOverride === 'off_track' || updates.healthOverride === 'missed' || updates.healthOverride === null) {
      void deadlineService.recomputeHealth(id);
    }

    res.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === 'slipReason is required when changing due_date or dependent deadlines') {
      return res.status(422).json({
        errors: [{ code: 'MISSING_SLIP_REASON', message: 'slipReason is required when changing due_date or dependent deadlines' }],
      });
    }

    if (err instanceof Error && err.message.startsWith('Invalid slip_reason:')) {
      return res.status(422).json({
        errors: [{ code: 'invalid_slip_reason', message: 'Invalid slip_reason' }],
      });
    }

    console.error('[deadline update] failed:', err);
    return res.status(500).json({ error: 'Internal server error', details: err instanceof Error ? err.message : undefined });
  }
});

/** DELETE /deadlines/:id */
router.delete('/deadlines/:id', async (req, res) => {
  const id = Number(req.params.id);
  const actor = req.user?.id || 'system';

  const deleted = await deadlineService.delete(id, actor);
  if (!deleted) {
    return res.status(404).json({ error: 'Not found' });
  }

  res.status(204).send();
});

// ---------------------------------------------------------------------
// Status (FR-3)
// ---------------------------------------------------------------------

/** GET /deadlines/:id/status */
router.get('/deadlines/:id/status', async (req, res) => {
  const id = Number(req.params.id);

  const deadline = await deadlineRepo.findById(id);
  if (!deadline) {
    return res.status(404).json({ error: 'Not found' });
  }

  const { healthOverride, ...rest } = deadline;
  const effectiveStatus = healthOverride || 'on_track';

  res.json({
    deadlineId: id,
    title: deadline.title,
    type: deadline.type,
    dueDate: deadline.dueDate,
    effectiveStatus,
    healthOverride,
    healthOverrideReason: deadline.healthOverrideReason,
  });
});

/** GET /deadlines/status */
router.get('/deadlines/status', async (req, res) => {
  const { type, owner, status } = parseQuery(req.query);

  const targets = await deadlineRepo.list(status || undefined);
  if (!Array.isArray(targets)) {
    return res.status(500).json({ error: 'Invalid query' });
  }

  const filtered = targets.filter((d) => {
    const tOk = type ? d.type === type : true;
    const oOk = owner ? d.owner === owner : true;
    const sOk = status ? d.healthOverride === status : true;
    return tOk && oOk && sOk;
  });

  res.json({
    total: filtered.length,
    countCombos: filtered,
  });
});

// ---------------------------------------------------------------------
// Dashboards (FR-5)
// ---------------------------------------------------------------------

/** GET /deadlines/executive */
router.get('/deadlines/executive', async (req, res) => {
  const all = await deadlineRepo.list(true);
  const summary = DeadlinePresenter.computeExecutiveSummary(all);
  res.json({
    execSummary: summary,
  });
});

/** GET /deadlines/timeline?{filter} */
router.get('/deadlines/timeline', async (req, res) => {
  const all = await deadlineRepo.list(true);
  // Stand-in: fetch dependent names map; in real impl this would come from DependencyRepository
  const dependentNames = new Map<number, string>(all.map((d) => [d.id, d.title]));
  const view = DeadlinePresenter.buildTimelineView(all, dependentNames);
  res.json({
    totalCount: all.length,
    timelineView: view,
  });
});

/** GET /deadlines/customer/:customerTag */
router.get('/deadlines/customer/:customerTag', async (req, res) => {
  const all = await deadlineRepo.list(true);
  const customerId = req.params.customerTag;
  const view = DeadlinePresenter.buildCustomerView(all, customerId);
  res.json(view);
});

// ---------------------------------------------------------------------
// Audits (FR-7)
// ---------------------------------------------------------------------

/** GET /deadlines/:id/audit */
router.get('/deadlines/:id/audit', async (req, res) => {
  const id = Number(req.params.id);
  const list = await deadlineRepo.auditLogByDeadlineId(id);

  res.json({
    auditLog: list,
    totalCount: list.length,
  });
});

/** GET /deadlines/audit?{period} */
router.get('/deadlines/audit', async (req, res) => {
  const { startDate, endDate } = parseQuery(req.query);

  const all = await deadlineRepo.list(true);

  const reviews = all.reduce((acc, d) => {
    const log = await deadlineRepo.auditLogForDeadlineOnDate(d.id, startDate || null, endDate || null);
    return acc + log.length;
  }, 0);

  res.json({
    reviewCount: reviews,
    auditEntries: [], // In real impl, aggregate and map
  });
});

// ---------------------------------------------------------------------
// Alerts & Escalations (FR-6)
// ---------------------------------------------------------------------

/** POST /deadlines/:id/alert */
router.post('/deadlines/:id/alert', async (req, res) => {
  const deadlineId = Number(req.params.id);
  const type = req.body.alertType;

  const deadline = await deadlineRepo.findById(deadlineId);
  if (!deadline) {
    return res.status(404).json({ error: 'Not found' });
  }

  const config = req.body.alertConfig || { channels: ['slack'], escalateOn: 24 };
  console.log('[ingest] Pending alert for deadlineId:' + deadlineId + ' type:' + type);
  // in real impl, send via Notifier and track in AuditLog
  res.status(202).send();
});

// ---------------------------------------------------------------------
// Export (FR-8)
// ---------------------------------------------------------------------

/** GET /deadlines/export?{type, filter} */
router.get('/deadlines/export', async (req, res) => {
  const all = await deadlineRepo.list(true);
  const format = req.query.format as 'json' | 'csv' | 'pdf' | undefined;
  if (format === 'csv') {
    const csv = deadlineExportService.toCSV(all);
    res.setHeader('content-type', 'text/csv');
    res.setHeader('content-disposition', 'attachment; filename=deadlines.csv');
    res.send(csv);
  } else if (format === 'json') {
    res.json(all);
  } else if (format === 'pdf') {
    const pdf = await deadlineExportService.toPDF(all);
    res.setHeader('content-type', 'application/pdf');
    res.send(pdf);
  } else {
    const fallback = deadlineExportService.toCSV(all);
    res.setHeader('content-type', 'text/csv');
    res.send(fallback);
  }
});

/** POST /deadlines/export/generate */
router.post('/deadlines/export/generate', async (req, res) => {
  const { format, startDate, endDate, filters } = req.body;
  const all = await deadlineRepo.list(true);
  if (format === 'pdf') {
    const pdf = await deadlineExportService.toPDF(all);
    res.setHeader('content-type', 'application/pdf');
    res.send(pdf);
  } else {
    const fallback = deadlineExportService.toCSV(all);
    res.send(fallback);
  }
});

// ---------------------------------------------------------------------
// Viewport (Embeddable status widget, FR-8)
// ---------------------------------------------------------------------

/** GET /deadlines/widget?{filters} */
router.get('/deadlines/widget', async (req, res) => {
  const all = await deadlineRepo.list(true);
  const config = req.query;
  const overview = DeadlinePresenter.computeExecutiveSummary(all);
  res.json({
    widgetConfig: config,
    overview,
    healthCounts: overview.counts,
  });
});

export default router;
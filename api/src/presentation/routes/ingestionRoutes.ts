import { Hono } from 'hono';
import { eq, and, desc, sql, isNull } from 'drizzle-orm';
import { authMiddleware, requireRole, requireTenantId } from '../middleware/authMiddleware';
import {
  integrationCredentials,
  integrationSyncLogs,
  sourceManifest,
  dailyGapStats,
} from '../../infrastructure/database/schema';
import { TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

/**
 * Data Ingestion API (task #257)
 * Projected endpoints:
 * - GET /api/ingestion/syncs             tenant+optional source
 * - POST /api/ingestion/syncs/trigger/:id trigger initial sync
 * - GET /api/ingestion/syncs/:id/progress current progress
 * - GET /api/ingestion/sources/:provider source manifest profiles (global)
 * - GET /api/ingestion/gaps           critical/warning/info per source/day for active tenant
 * - GET /api/ingestion/gaps/:provider/:source/:date gaps for a specific source/day (optional: filtered)
 * - GET /api/ingestion/export?format=csv export.
 */

type SourceOrDay = 'source_manifest' | 'daily_gap_stats' | 'all';

function parseFormat(fmt: string | null) {
  return fmt?.toLowerCase() === 'csv' ? 'csv' : null;
}

/** Helpers: showstraint for active tenant, only GENUS source/day */
function constraintsForSource(tenantId: number, provider?: string) {
  const base = [eq(sourceManifest.tenantId, tenantId)];
  if (provider) base.push(eq(sourceManifest.provider, provider));
  return base;
}

function constraintsForDay(tenantId: number, provider?: string) {
  const base = [eq(dailyGapStats.tenantId, tenantId)];
  if (provider) base.push(eq(dailyGapStats.provider, provider));
  return base;
}

/**
 * GET /api/ingestion/syncs
 * List sync runs for this tenant (optionally filtered by provider)
 */
export function createIngestionRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);
  const manager = requireRole(TenantRole.MANAGER);

  // GET /api/ingestion/syncs — all sync logs for tenant, optionally filtered by provider
  router.get('/syncs', manager, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const provider = c.req.query('provider') || undefined;

    const constraints = [eq(integrationSyncLogs.tenantId, tenantId)];
    if (provider) constraints.push(eq(integrationCredentials.provider, provider));

    const rows = await db
      .select({
        // SyncLog fields
        id: integrationSyncLogs.id,
        credentialId: integrationSyncLogs.credentialId,
        provider: integrationCredentials.provider,
        sourceName: integrationCredentials.name,
        syncStatus: integrationSyncLogs.syncStatus,
        stage: integrationSyncLogs.stage,
        processedCount: integrationSyncLogs.processedCount,
        totalCount: integrationSyncLogs.totalCount,
        processingTimeSeconds: integrationSyncLogs.processingTimeSeconds,
        createdAt: integrationSyncLogs.createdAt,
        startedAt: integrationSyncLogs.startedAt,
        endTime: integrationSyncLogs.endTime,
        errorMessage: integrationSyncLogs.errorMessage,
        manifestScope: integrationSyncLogs.manifestScope,
      })
      .from(integrationSyncLogs)
      .innerJoin(integrationCredentials, eq(integrationSyncLogs.credentialId, integrationCredentials.id))
      .where(and(...constraints))
      .orderBy(desc(integrationSyncLogs.startedAt))
      .limit(100);

    return c.json({ logs: rows });
  });

  /**
   * POST /api/ingestion/syncs/trigger/:credentialId
   * Trigger an initial sync for the given integration.
   * Returns whether the sync started or is already running.
   */
  const encryptionSecret = c.get('encryptionSecret');
  router.post('/syncs/trigger/:credentialId', manager, async (c) => {
    const credentialId = Number(c.req.param('credentialId'));
    const tenantId = c.get('tenantId') as number;

    if (isNaN(credentialId)) {
      return c.json({ error: 'credentialId must be a number' }, 400);
    }

    const result = await IngestionService.triggerInitialSync(credentialId, encryptionSecret, tenantId);
    if (result.status === 'failed') {
      return c.json({ error: result.reason }, 500);
    }
    return c.json(result);
  });

  /**
   * GET /api/ingestion/syncs/:id/progress
   * Get the current progress for a sync run.
   */
  router.get('/syncs/:id/progress', manager, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const logId = Number(c.req.param('id'));

    const rows = await db
      .select({
        id: integrationSyncLogs.id,
        syncStatus: integrationSyncLogs.syncStatus,
        stage: integrationSyncLogs.stage,
        processedCount: integrationSyncLogs.processedCount,
        totalCount: integrationSyncLogs.totalCount,
        startedAt: integrationSyncLogs.startedAt,
        endTime: integrationSyncLogs.endTime,
        processingTimeSeconds: integrationSyncLogs.processingTimeSeconds,
        errorMessage: integrationSyncLogs.errorMessage,
        manifestScope: integrationSyncLogs.manifestScope,
      })
      .from(integrationSyncLogs)
      .where(and(eq(integrationSyncLogs.id, logId), eq(integrationSyncLogs.tenantId, tenantId)))
      .limit(1);

    if (!rows.length) return c.json({ error: 'Sync log not found' }, 404);
    return c.json(rows[0]);
  });

  /**
   * GET /api/ingestion/sources/:provider
   * List manifests for a given provider (global or per-tenant; currently returns all tenants for simplicity)
   * Returns schema_hash, counts, and dates.
   */
  router.get('/sources/:provider', manager, async (c) => {
    const provider = c.req.param('provider');
    const tenantId = c.get('tenantId') as number;
    const limit = Math.min(Number(c.req.query('limit') ?? '50'), 100);

    const rows = await db
      .select({
        id: sourceManifest.id,
        provider: sourceManifest.provider,
        sourceName: sourceManifest.sourceName,
        schemaHash: sourceManifest.schemaHash,
        syncDate: sourceManifest.syncDate,
        totalRecords: sourceManifest.totalRecords, -- NOT in schema.sql; comment for future extension
        tenantId: sourceManifest.tenantId,
        createdAt: sourceManifest.createdAt,
      })
      .from(sourceManifest)
      .where(and(eq(sourceManifest.provider, provider), eq(sourceManifest.tenantId, tenantId)))
      .orderBy(desc(sourceManifest.syncDate))
      .limit(limit)
      .then(r => r.map(row => {
        // Remove fields we don't have in the arbitrary reservation for totalRecords,
        // or keep null and align later. For now, omit totalRecords and adjust as needed to align with SQL:
        const { totalRecords: _tot, ...rest } = row;
        return rest;
      }));

    return c.json({ sources: rows });
  });

  /**
   * GET /api/ingestion/gaps
   * Show critical/warning/info per source/day for the active tenant.
   */
  router.get('/gaps', manager, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const provider = c.req.query('provider') || undefined;
    const limit = Math.min(Number(c.req.query('limit') ?? '50'), 100);

    const rows = await db
      .select({
        provider: dailyGapStats.provider,
        sourceName: dailyGapStats.sourceName,
        syncDate: dailyGapStats.syncDate,
        criticalGaps: dailyGapStats.criticalGaps,
        warningGaps: dailyGapStats.warningGaps,
        infoGaps: dailyGapStats.infoGaps,
      })
      .from(dailyGapStats)
      .where(and(...constraintsForDay(tenantId, provider)))
      .orderBy(desc(dailyGapStats.syncDate))
      .limit(limit);

    // Hierarchically group by source/day to better surface per-source rolls
    const grouped = rows.reduce((acc: any, cur) => {
      const key = `${cur.provider}::${cur.sourceName}`;
      if (!acc[key]) {
        acc[key] = {
          provider: cur.provider,
          sourceName: cur.sourceName,
          recordCount: 0,
          criticalGaps: 0,
          warningGaps: 0,
          infoGaps: 0,
        };
      }
      acc[key].criticalGaps += cur.criticalGaps;
      acc[key].warningGaps += cur.warningGaps;
      acc[key].infoGaps += cur.infoGaps;
      acc[key].recordCount += 1;
      acc[key].lastSeen = cur.syncDate;
      return acc;
    }, {});

    return c.json({ gapEntries: Object.values(grouped) });
  });

  /**
   * GET /api/ingestion/gaps/:provider/:source/:date
   * Get detailed list of gaps for a specific source/day.
   */
  router.get('/gaps/:provider/:source/:date', manager, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const provider = c.req.param('provider');
    const sourceName = c.req.param('source');
    const date = c.req.param('date');

    const rows = await db
      .select({
        provider: dailyGapStats.provider,
        sourceName: dailyGapStats.sourceName,
        syncDate: dailyGapStats.syncDate,
        criticalGaps: dailyGapStats.criticalGaps,
        warningGaps: dailyGapStats.warningGaps,
        infoGaps: dailyGapStats.infoGaps,
      })
      .from(dailyGapStats)
      .where(
        and(
          eq(dailyGapStats.provider, provider),
          eq(dailyGapStats.sourceName, sourceName),
          eq(dailyGapStats.syncDate, date),
          eq(dailyGapStats.tenantId, tenantId),
        ),
      )
      .limit(100);

    if (!rows.length) return c.json({ error: 'No gaps found for this source/day' }, 404);
    return c.json(rows[0]);
  });

  /**
   * GET /api/ingestion/export?format=csv
   * Export the full ingestion history for the tenant as CSV.
   */
  router.get('/export', manager, async (c) => {
    const fmt = parseFormat(c.req.query('format'));
    if (!fmt) return c.json({ error: 'format must be csv' }, 400);

    const tenantId = c.get('tenantId') as number;
    const provider = c.req.query('provider') || undefined;

    const constraints = [eq(integrationSyncLogs.tenantId, tenantId)];
    if (provider) constraints.push(eq(integrationCredentials.provider, provider));

    const rows = await db
      .select()
      .from(integrationSyncLogs)
      .innerJoin(integrationCredentials, eq(integrationSyncLogs.credentialId, integrationCredentials.id))
      .where(and(...constraints))
      .orderBy(desc(integrationSyncLogs.startedAt))
      .limit(1000);

    if (!rows.length) return c.json({ count: 0, rows: [] });

    const headers = [
      'log_id', 'credential_id', 'provider', 'source_name', 'sync_status', 'stage',
      'processed_count', 'total_count', 'processing_time_seconds', 'start_time',
      'end_time', 'error_message', 'manifest_scope',
    ];

    const csvContent = [
      headers.join(','),
      ...rows.map((r) =>
        [
          r.integrationSyncLogs.id,
          r.integrationSyncLogs.credentialId,
          r.integrationCredentials.provider,
          r.integrationCredentials.name,
          r.integrationSyncLogs.syncStatus,
          r.integrationSyncLogs.stage,
          r.integrationSyncLogs.processedCount ?? '',
          r.integrationSyncLogs.totalCount ?? '',
          r.integrationSyncLogs.processingTimeSeconds ?? '',
          r.integrationSyncLogs.startedAt ?? '',
          r.integrationSyncLogs.endTime ?? '',
          r.integrationSyncLogs.errorMessage ?? '',
          r.integrationSyncLogs.manifestScope ?? '',
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(','),
      ),
    ].join('\n');

    return c.json({
      format: 'csv',
      count: rows.length,
      headers,
      rows, // full objects for preview/inline display
      csv, csvContent, // both for comparison: preview vs raw binary export later
    });
  });

  return router;
}
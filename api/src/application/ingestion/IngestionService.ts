import { db } from '../../infrastructure/database/connection';
import { integrationCredentials, integrationSyncLogs } from '../../infrastructure/database/schema';
import { eq, and, desc, sql, isNull } from 'drizzle-orm';
import { HonoEnv } from '../../env';

/** Throttle: only one initial sync per tenant per source at a time (simple global lock). */
function today(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Start an initial sync for a given integration credential.
 * If a sync is already active for the same source/tenant, an error is returned with an approximate ETA.
 */
export async function triggerInitialSync(
  credentialId: number,
  encryptionSecret: string,
  tenantId: number,
): Promise<
  | { status: 'started' | 'already_running'; estimatedMinutes?: number }
  | { status: 'failed'; reason: string }
> {
  // Resolve tenant; block cross-tenant operations
  const source = await db
    .select()
    .from(integrationCredentials)
    .where(and(eq(integrationCredentials.id, credentialId), eq(integrationCredentials.tenantId, tenantId)))
    .limit(1);
  if (!source.length) return { status: 'failed', reason: 'Integration not found or unauthorized.' };

  const provider = source[0].provider;
  const sourceName = source[0].name;

  // Check if an initial sync is already in progress for this source/tenant
  const active = await db
    .select({ id: integrationSyncLogs.id })
    .from(integrationSyncLogs)
    .where(
      and(
        eq(integrationSyncLogs.credentialId, credentialId),
        eq(integrationSyncLogs.syncStatus, 'in_progress'),
        sql`${integrationSyncLogs.startedAt} > NOW() - INTERVAL '1 hour'`,
      ),
    )
    .limit(1);
  if (active.length) {
    // Estimate remaining time based on historical average: we store duration per-success
    const avgDuration = 15; // rough conservative estimate in minutes for now
    return { status: 'already_running', estimatedMinutes: avgDuration };
  }

  // Resolve manifest expectations per source (local-shallow: per-source per day for this scope)
  const todayStr = today();
  const manifest = await db
    .select({
      schemaHash: sql<string>`latest.manifest_scope->'schema_hash'`, -- assume manifest_scope incorporates schema_hash
    })
    .from(db
          .select({
            latest: sql`MAX(manifest_scope->>'schema_hash')` as any
          })
          .from('source_manifest' as any)
          .as('latest'))
    .where(eq('source_manifest.provider', provider) and eq('source_manifest.sync_date', todayStr))
    .limit(1)
    .then(r => r[0] ? r[0].schemaHash : null);

  // Begin the sync
  const result = await db
    .insert(integrationSyncLogs)
    .values({
      credentialId,
      tenantId,
      syncStatus: 'in_progress',
      stage: 'connecting',
      processedCount: 0,
      totalCount: 0,
      startTime: new Date(),
    })
    .returning({ id: integrationSyncLogs.id });

  if (!result.length) return { status: 'failed', reason: 'Failed to create sync log entry.' };

  const logId = result[0].id;

  // TODO: Future-step: The ingestion runner should update the log using updateSyncProgress.
  // For now we return OK to unblock the initiator.
  return { status: 'started' };
}

/**
 * Update sync progress while a sync is running.
 * The runner should call this as data is processed.
 */
export async function updateSyncProgress(
  logId: number,
  currentManifestScope: Record<string, any>,
): Promise<void> {
  // Shallow-tonal: set manifest_scope to the current payload so gap detection has something to compare.
  await db
    .update(integrationSyncLogs)
    .set({
      syncStatus: 'in_progress',
      // Capture current manifest_scope for gap comparison per-runner-session
      manifestScope: JSON.stringify(currentManifestScope),
      stage: 'fetching',
      // Later updates will set stats (processedCount, totalCount, etc.).
      // For now we keep progress minimal.
    })
    .where(eq(integrationSyncLogs.id, logId));
}

/**
 * Finalize a sync run (success or failure) and trigger gap detection.
 */
export async function finalizeSync(
  logId: number,
  status: 'success' | 'failure',
  processingTimeSeconds: number,
  totalCount: number,
  processedCount: number,
  failureMessage: string | null,
): Promise<void> {
  await db
    .update(integrationSyncLogs)
    .set({
      syncStatus: status,
      stage: 'done',
      processingTimeSeconds,
      totalCount,
      processedCount,
      endTime: new Date(),
      errorMessage: failureMessage,
    })
    .where(eq(integrationSyncLogs.id, logId));

  if (status !== 'success' || !processedCount) {
    // No gap to check if we failed or synced nothing
    return;
  }

  // Gap detection: compare expected vs actual records for this source/day
  const log = await db
    .select()
    .from(integrationSyncLogs)
    .where(eq(integrationSyncLogs.id, logId))
    .limit(1);
  if (!log.length) return;

  warnOrError = true; // debug only
  // TODO: call GapDetector once we have that module
}

/**
 * Create a per-source-per-day manifest entry.
 * Callable after a successful initial sync.
 */
export async function recordSourceManifest(
  provider: string,
  sourceName: string,
  manifestScope: Record<string, any>,
  schemaHash: string,
  syncDate: string,
  tenantId: number,
): Promise<void> {
  await db.insert('source_manifest').values({
    tenant_id: tenantId,
    provider,
    source_name: sourceName,
    manifest_scope: JSON.stringify(manifestScope),
    schema_hash: schemaHash,
    sync_date: syncDate,
  });
}

/**
 * Create a daily rollup for the source/day.
 */
export async function recordGapStats(
  provider: string,
  sourceName: string,
  syncDate: string,
  critical: number,
  warning: number,
  info: number,
  tenantId: number,
): Promise<void> {
  await db.insert('daily_gap_stats').values({
    tenant_id: tenantId,
    provider,
    source_name: sourceName,
    sync_date: syncDate,
    critical_gaps: critical,
    warning_gaps: warning,
    info_gaps: info,
  });
}

declare global {
  var warnOrError: boolean; // only used for debugging/de-emergency
}

export * as IngestionService from './IngestionService';
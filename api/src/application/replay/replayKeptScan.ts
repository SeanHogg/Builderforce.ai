/**
 * The bounded scan over KEPT recordings that funnels, flow and the segment summary
 * fold in memory (PRD 33 D15/D18: "funnels, flow, segments and AI digests run over
 * kept recordings weighted by `sample_weight` and are shown as ≈").
 *
 * Batches of {@link SCAN_BATCH} by keyset on (started_at desc, id desc) — never
 * OFFSET — up to a hard ceiling of {@link FUNNEL_MAX_RECORDINGS} rows; `truncated` says the
 * ceiling was hit so the view can say the answer covers the most recent slice. Only
 * the columns the folds read are selected. Every statement carries BOTH halves of
 * the scope.
 */

import { and, desc, eq, gte, type SQL } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { replayRecordings } from '../../infrastructure/database/schema';
import type { ReplayScope } from '../../domain/replay/replayScope';
import { FUNNEL_MAX_RECORDINGS } from '../../domain/replay/funnelFold';
import { afterRecordingCursor } from './replayReadModel';

export const SCAN_BATCH = 500;

export const KEPT_SCAN_COLUMNS = {
  id: replayRecordings.id,
  visitorId: replayRecordings.visitorId,
  visitId: replayRecordings.visitId,
  startedAt: replayRecordings.startedAt,
  durationMs: replayRecordings.durationMs,
  steps: replayRecordings.steps,
  clicked: replayRecordings.clicked,
  sampleWeight: replayRecordings.sampleWeight,
  converted: replayRecordings.converted,
  errorCount: replayRecordings.errorCount,
  rageCount: replayRecordings.rageCount,
  deadCount: replayRecordings.deadCount,
  quickbackCount: replayRecordings.quickbackCount,
  excessiveScrollCount: replayRecordings.excessiveScrollCount,
};

export interface KeptScanRow {
  id: string;
  visitorId: string;
  visitId: string;
  startedAt: Date;
  durationMs: number;
  steps: string[];
  clicked: string[];
  sampleWeight: number;
  converted: boolean;
  errorCount: number;
  rageCount: number;
  deadCount: number;
  quickbackCount: number;
  excessiveScrollCount: number;
}

export interface KeptScan {
  rows: KeptScanRow[];
  truncated: boolean;
}

/**
 * Every kept recording of the scope started since `since` that passes `where`,
 * newest first, at most `ceiling` (default {@link FUNNEL_MAX_RECORDINGS}).
 */
export async function scanKeptRecordings(
  store: Db,
  scope: ReplayScope,
  input: { since: Date; where?: SQL; ceiling?: number },
): Promise<KeptScan> {
  const ceiling = Math.max(1, Math.min(FUNNEL_MAX_RECORDINGS, input.ceiling ?? FUNNEL_MAX_RECORDINGS));
  const rows: KeptScanRow[] = [];
  let cursor: { at: Date; id: string } | null = null;
  for (;;) {
    const want = Math.min(SCAN_BATCH, ceiling - rows.length);
    const batch: KeptScanRow[] = await store
      .select(KEPT_SCAN_COLUMNS)
      .from(replayRecordings)
      .where(and(
        eq(replayRecordings.tenantId, scope.tenantId),
        eq(replayRecordings.siteId, scope.siteId),
        gte(replayRecordings.startedAt, input.since),
        afterRecordingCursor(cursor),
        input.where,
      ))
      .orderBy(desc(replayRecordings.startedAt), desc(replayRecordings.id))
      // One past what is wanted, so hitting the ceiling exactly is told apart from passing it.
      .limit(want + 1);
    rows.push(...batch.slice(0, want));
    if (batch.length <= want) return { rows, truncated: false };
    if (rows.length >= ceiling) return { rows, truncated: true };
    const last = rows[rows.length - 1]!;
    cursor = { at: new Date(last.startedAt), id: last.id };
  }
}

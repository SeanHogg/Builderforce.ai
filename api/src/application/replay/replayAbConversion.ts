/**
 * The conversion half of a prescription's A/B test (PRD 33 §5.1.4 "Test it").
 *
 * The sites Worker counted the EXPOSURE when it assigned the visitor's arm and wrote
 * `data-variant="ab<testId>:<key>"` on the loader; the recorder carries it on every
 * chunk. Here, at ingest — after the rollups, at the narrowest seam — a chunk whose
 * marks satisfy the test's success (a named smart event, else the site's goal
 * events, the same rule `converted` uses) records ONE conversion for that arm
 * through THE A/B engine (`recordConversion`), once per visit (KV-gated).
 *
 * Never throws: a lost conversion is an under-count `variantResults` survives; a
 * thrown error here would cost the chunk.
 */

import type { ReplayChunk, ReplayMark } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { peekCached, setCached } from '../../infrastructure/cache/readThroughCache';
import { parseVariantLabel } from '../../domain/replay/abSplit';
import { eventNamesOf, isGoalMark } from '../../domain/replay/markWalk';
import { recordConversion } from '../marketing/experimentation';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { runningSplitForSite, type RunningSplit } from '../ide/siteAbSplit';
import { abConversionKey } from './replayCacheKeys';
import type { ReplaySiteRecord } from './replaySites';

const SOURCE = 'application/replay/replayAbConversion.ts';
const CONVERSION_GATE_SECONDS = 60 * 60 * 24 * 30;

/** Whether one mark is the test's success. */
export function markConverts(mark: ReplayMark, success: RunningSplit['success']): boolean {
  return success.smartEvent ? eventNamesOf(mark).includes(success.smartEvent) : isGoalMark(mark);
}

/** Record the visit's conversion against its arm, if this chunk converts. */
export async function recordVariantConversion(env: Env, db: Db, site: ReplaySiteRecord, chunk: ReplayChunk): Promise<boolean> {
  try {
    const arm = parseVariantLabel(chunk.variant);
    if (!arm) return false;
    const split = await runningSplitForSite(env, site.tenantId, site.id);
    if (!split || split.testId !== arm.testId) return false;
    const variant = split.variants.find((v) => v.key === arm.key);
    if (!variant) return false;
    if (!chunk.marks.some((mark) => markConverts(mark, split.success))) return false;
    const gate = abConversionKey(split.testId, chunk.visitId);
    if (await peekCached<boolean>(env, gate)) return false;
    await setCached(env, gate, true, { kvTtlSeconds: CONVERSION_GATE_SECONDS });
    await recordConversion(db, site.tenantId, variant.id);
    return true;
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'recordVariantConversion', context: { siteId: site.id } });
    return false;
  }
}

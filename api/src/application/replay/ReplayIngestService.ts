/**
 * THE ingest (PRD 33 §3.3). One chunk in, every consequence out, and it NEVER
 * throws to the route — the route always answers 202, and ingest never says why it
 * dropped a chunk (§6 abuse ceilings).
 *
 *   1. resolve the site (origin-bound `bfr_` key or `hosted:<siteId>`, cached 5 min)
 *   2. per-IP daily budget, size cap, gunzip, `parseReplayChunk`
 *   3. KEPT chunks: licence + allowance for a new recording, R2, the row, the
 *      timeline, the unit debits (`replayRecordingWriter`)
 *   4. EVERY chunk: the exact rollups into the isolate buffer (`rollupCells`)
 *   5. release first/last seen, the first-event trace, the flush, and the site's
 *      cache version — the last three after the response (`ctx.waitUntil`)
 *
 * No `activity_log` writes happen here: the two one-off traces go through
 * `replayTrace` (and `replayUsage` for the allowance ones), each KV-gated.
 */

import type { ReplayChunk } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { peekCached, setCached } from '../../infrastructure/cache/readThroughCache';
import { rollupCells, type VisitRollupState } from '../../domain/replay/interactionAggregate';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { deferPastResponse } from '../shared/requestScope';
import { bumpSiteVersionThrottled, firstEventKey } from './replayCacheKeys';
import { bumpJourneySignal } from '../realization/journeySignal';
import { decodeChunkBody, gzip, withinReplayIpBudget } from './replayIngestBody';
import { keepChunk, type RecordingRow } from './replayRecordingWriter';
import { sharedReplayRollupBuffer, type ReleaseSource, type ReplayRollupBuffer } from './replayRollupBuffer';
import { flushReplayRollups } from './replayRollupFlush';
import { purgeStaleLive } from './replayRetention';
import { resolveSiteForIngest, type ReplaySiteRecord } from './replaySites';
import { recordReplayTrace, REPLAY_TRACE_VERBS } from './replayTrace';
import { recordVariantConversion } from './replayAbConversion';

const SOURCE = 'application/replay/ReplayIngestService.ts';
const FIRST_EVENT_TTL_SECONDS = 365 * 24 * 60 * 60;

export interface ReplayIngestRequest {
  /** `?site=` — a `bfr_` key or `hosted:<siteId>`. */
  siteToken: string | null;
  /** The request's `Origin` header. */
  origin: string | null;
  /** `cf-connecting-ip`. */
  ip: string | null;
  /** `cf.country`. */
  country: string | null;
  contentEncoding: string | null;
  body: ArrayBuffer;
}

/** What happened — for tests and logs only; the route answers 202 regardless. */
export type ReplayIngestOutcome = 'kept' | 'counted' | 'duplicate' | 'dropped';

export interface ReplayIngestDeps {
  now?: () => Date;
  buffer?: ReplayRollupBuffer;
}

/** `R<n>` sources: a 12-hex asset fingerprint, a hosted version token, else explicit. */
export function releaseSource(site: ReplaySiteRecord, releaseKey: string): ReleaseSource {
  if (/^[0-9a-f]{12}$/.test(releaseKey)) return 'fingerprint';
  return site.kind === 'hosted' ? 'hosted' : 'explicit';
}

function stateFromRecording(row: RecordingRow | null): VisitRollupState | null {
  if (!row) return null;
  return {
    route: row.exitPath,
    activeMs: row.activeMs,
    converted: row.converted,
    frustrated: row.frustrations.length > 0,
    issueFps: row.issueFps,
  };
}

function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** Let `task` outlive the response when the runtime allows; otherwise wait for it. */
async function afterResponse(task: Promise<unknown>): Promise<void> {
  if (!deferPastResponse(task)) await task;
}

export class ReplayIngestService {
  private readonly now: () => Date;
  private readonly buffer: ReplayRollupBuffer;

  constructor(private readonly env: Env, private readonly db: Db, deps: ReplayIngestDeps = {}) {
    this.now = deps.now ?? (() => new Date());
    this.buffer = deps.buffer ?? sharedReplayRollupBuffer();
  }

  async ingest(request: ReplayIngestRequest): Promise<ReplayIngestOutcome> {
    try {
      return await this.run(request);
    } catch (error) {
      reportCaughtError(error, { source: SOURCE, operation: 'ingest' });
      return 'dropped';
    }
  }

  private async run(request: ReplayIngestRequest): Promise<ReplayIngestOutcome> {
    if (request.body.byteLength === 0) return 'dropped';
    const site = await resolveSiteForIngest(this.env, this.db, request.siteToken, request.origin);
    if (!site || site.status !== 'active') return 'dropped';
    if (!(await withinReplayIpBudget(this.env, request.ip))) return 'dropped';
    const decoded = await decodeChunkBody(request.body, request.contentEncoding);
    if (!decoded) return 'dropped';

    const { chunk } = decoded;
    const now = this.now();
    let outcome: ReplayIngestOutcome = 'counted';
    let recordingId: string | null = null;
    let prev: RecordingRow | null = null;

    if (chunk.keep !== null) {
      const kept = await this.keep(site, chunk, decoded.gzipped ?? (await gzip(decoded.plain)), request.country, now);
      if (kept?.kind === 'duplicate') return 'duplicate'; // already stored AND already rolled up
      if (kept?.kind === 'stored') {
        outcome = 'kept';
        recordingId = kept.recordingId;
        prev = kept.prev;
      }
    }

    const cells = rollupCells(chunk, {
      siteId: site.id,
      day: utcDay(now),
      country: request.country,
      visit: this.buffer.visit(site.id, chunk.visitId) ?? stateFromRecording(prev),
    });
    const ref = { siteId: site.id, tenantId: site.tenantId };
    this.buffer.add(ref, utcDay(now), cells, { recordingId, at: now });
    this.buffer.noteRelease(ref, chunk.release, releaseSource(site, chunk.release), now);
    // A prescription A/B arm (`data-variant`): its conversion, after the rollups, never throwing.
    if (chunk.variant) await afterResponse(recordVariantConversion(this.env, this.db, site, chunk));

    await afterResponse(this.settle(site, now));
    return outcome;
  }

  /** The kept path, isolated so a storage failure still lets the chunk count. */
  private async keep(site: ReplaySiteRecord, chunk: ReplayChunk, gzipped: Uint8Array, country: string | null, now: Date) {
    try {
      return await keepChunk(this.env, this.db, { site, chunk, gzipped, country, now });
    } catch (error) {
      reportCaughtError(error, { source: SOURCE, operation: 'keepChunk', context: { siteId: site.id } });
      return null;
    }
  }

  /** Everything that may finish after the 202: first-event trace, flush, cache version. */
  private async settle(site: ReplaySiteRecord, now: Date): Promise<void> {
    try {
      const firstKey = firstEventKey(site.id);
      if (!(await peekCached<boolean>(this.env, firstKey))) {
        await setCached(this.env, firstKey, true, { kvTtlSeconds: FIRST_EVENT_TTL_SECONDS });
        await recordReplayTrace(this.env, this.db, {
          tenantId: site.tenantId,
          siteId: site.id,
          verb: REPLAY_TRACE_VERBS.ingestFirstEvent,
          summary: 'First visitor event received',
        });
        // S4d: a proof's first visitor moves the founder from Make to Measure.
        if (site.kind === 'hosted') await bumpJourneySignal(this.env, site.tenantId);
      }
      if (this.buffer.shouldFlush()) {
        await flushReplayRollups(this.env, this.db, this.buffer.drain(), (error, table) => {
          reportCaughtError(error, { source: SOURCE, operation: 'flushReplayRollups', context: { table } });
        });
      }
      // Once a minute per site: orphan its cached reads and sweep its stale presence.
      if (await bumpSiteVersionThrottled(this.env, site.id)) {
        await purgeStaleLive(this.env, this.db, now, { tenantId: site.tenantId, siteId: site.id });
      }
    } catch (error) {
      reportCaughtError(error, { source: SOURCE, operation: 'settle', context: { siteId: site.id } });
    }
  }
}

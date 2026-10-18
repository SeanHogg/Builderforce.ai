/**
 * AI summaries of one recording and of a segment (PRD 33 §2.1 "AI summary of one
 * recording / a segment — cited, deep-linked", D13).
 *
 * Both go through THE condense primitive (`llm/condense.ts`), which routes on the
 * workspace's own plan (`tenantProxyForPlan(env, scope.tenantId)`) and carries the
 * grounding refusal. The model reads a DIGEST (`visitDigest`) — the recording's
 * header and its timeline marks, never page text — and must cite every sentence:
 *   • a visit: each sentence ends `#<ord>`; uncited sentences are dropped;
 *   • a segment: each of three patterns cites `<recordingId>#<ord>`; a pattern
 *     with no valid citation is dropped.
 *
 * Caching: a visit summary is stored in `replay_visit_summaries` and served from
 * there until `regenerate`; a segment summary is cached an hour under the site
 * version and never stored. A model call takes one unit of the workspace's daily
 * AI budget (`replayAiBudget`) — a cached answer is free.
 */

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { ReplayFilter, ReplayMark, ReplaySegmentSummaryDto, ReplaySummaryDto } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { replayRecordings, replayVisitSummaries } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { NotFoundError, ServiceUnavailableError } from '../../domain/shared/errors';
import { isUuid, type ReplayScope } from '../../domain/replay/replayScope';
import { visitDigest } from '../../domain/replay/visitDigest';
import { parseCitations, parsePatternCitations } from '../../domain/replay/summaryCitations';
import { condenseTranscript } from '../llm/condense';
import { replayReadKeys } from './replayCacheKeys';
import { replayTelemetryDb } from './replayDatabase';
import { getMarks } from './replayChunkStore';
import { recordingLocation, type RecordingRow } from './replayRecordingWriter';
import { clampDays, filterCacheKey, toRecordingSummary } from './replayReadModel';
import { compileScopeFilter } from './replaySmartEventRules';
import { takeReplayAiBudget } from './replayAiBudget';
import { recordReplayTrace, REPLAY_TRACE_VERBS } from './replayTrace';
import { DAY_MS } from '../../domain/shared/time';

/** Recordings a segment summary reads. */
export const SEGMENT_SAMPLE = 30;
/** Timeline lines per recording in a segment digest (the whole prompt stays bounded). */
const SEGMENT_MARKS_PER_RECORDING = 40;
const SEGMENT_TTL = { kvTtlSeconds: 3_600, l1TtlMs: 60_000 };

const VISIT_SHAPE = 'You summarise ONE website visit for the site owner, from its timeline. '
  + 'Write 3 to 5 plain sentences about what the visitor tried to do, where they struggled and how the visit ended. '
  + 'EVERY sentence must end with the #<ord> of the timeline line it describes, e.g. "They rage-clicked the Pay button #12." '
  + 'A sentence you cannot tie to a timeline line must not be written. No headings, no lists, no markdown.';

const SEGMENT_SHAPE = 'You compare several website visits from one segment and name the THREE most important recurring patterns '
  + '(where visitors struggle, hesitate or leave). Write exactly three lines, one pattern per line, plain text. '
  + 'End each line with the moments that show it, as [<recording id>#<ord>, <recording id>#<ord>] using the ids and #ords from the timelines. '
  + 'A pattern you cannot cite must not be written.';

const iso = (value: Date | string) => (value instanceof Date ? value : new Date(String(value))).toISOString();

async function loadRecording(store: Db, scope: ReplayScope, recordingId: string): Promise<RecordingRow> {
  if (!isUuid(recordingId)) throw new NotFoundError('Recording', recordingId);
  const [row] = await store
    .select()
    .from(replayRecordings)
    .where(and(
      eq(replayRecordings.tenantId, scope.tenantId),
      eq(replayRecordings.siteId, scope.siteId),
      eq(replayRecordings.id, recordingId),
    ))
    .limit(1);
  if (!row) throw new NotFoundError('Recording', recordingId);
  return row;
}

function storedCitations(raw: unknown): ReplaySummaryDto['citations'] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is { atMs: number; ord: number } => !!c && typeof c === 'object' && typeof (c as { ord?: unknown }).ord === 'number')
    .map((c) => ({ atMs: Number(c.atMs) || 0, ord: c.ord }));
}

/** The visit's cited summary: stored, else generated (one budget unit), stored and traced. */
export async function summarizeRecording(
  env: Env,
  db: Db,
  scope: ReplayScope,
  recordingId: string,
  opts: { regenerate?: boolean; actorId?: string | null } = {},
): Promise<ReplaySummaryDto> {
  const store = replayTelemetryDb(env, db);
  const row = await loadRecording(store, scope, recordingId);

  if (!opts.regenerate) {
    const [cached] = await store
      .select()
      .from(replayVisitSummaries)
      .where(eq(replayVisitSummaries.recordingId, row.id))
      .limit(1);
    if (cached) {
      return {
        recordingId: row.id,
        summary: cached.summary,
        citations: storedCitations(cached.citations),
        model: cached.model,
        generatedAt: iso(cached.generatedAt),
      };
    }
  }

  await takeReplayAiBudget(env, scope.tenantId);
  const marks = await getMarks(env, recordingLocation(row));
  const summaryDto = toRecordingSummary(row);
  const condensed = await condenseTranscript(env, scope.tenantId, {
    transcript: visitDigest(summaryDto, marks),
    header: 'Visit timeline. Each line is [mm:ss #ord] kind key "label".',
    shape: VISIT_SHAPE,
    maxTokens: 500,
  });
  if ('error' in condensed) throw new ServiceUnavailableError(condensed.error, { code: 'summary_unavailable' });
  const cited = parseCitations(condensed.text, marks.length);
  if (!cited.summary) throw new ServiceUnavailableError('The model wrote no cited sentence', { code: 'summary_uncited' });

  const citations = cited.ords.map((ord) => ({ atMs: marks[ord]!.atMs, ord }));
  const generatedAt = new Date();
  await store
    .insert(replayVisitSummaries)
    .values({ recordingId: row.id, summary: cited.summary, citations, model: null, generatedAt })
    .onConflictDoUpdate({
      target: replayVisitSummaries.recordingId,
      set: { summary: cited.summary, citations, model: null, generatedAt },
    });
  await recordReplayTrace(env, db, {
    tenantId: scope.tenantId,
    siteId: scope.siteId,
    verb: REPLAY_TRACE_VERBS.summaryGenerated,
    actorId: opts.actorId ?? null,
    metadata: { kind: 'recording', recordingId: row.id, sentences: cited.ords.length },
  });
  return { recordingId: row.id, summary: cited.summary, citations, model: null, generatedAt: generatedAt.toISOString() };
}

/** Frustrated recordings first, then the newest — the sample a segment summary reads. */
async function segmentSample(env: Env, db: Db, scope: ReplayScope, days: number, filter: ReplayFilter | null | undefined): Promise<RecordingRow[]> {
  const { where } = await compileScopeFilter(env, db, scope, filter);
  const frustrated = sql`(${replayRecordings.rageCount} + ${replayRecordings.deadCount} + ${replayRecordings.errorCount}
    + ${replayRecordings.quickbackCount} + ${replayRecordings.excessiveScrollCount}) > 0`;
  return replayTelemetryDb(env, db)
    .select()
    .from(replayRecordings)
    .where(and(
      eq(replayRecordings.tenantId, scope.tenantId),
      eq(replayRecordings.siteId, scope.siteId),
      gte(replayRecordings.startedAt, new Date(Date.now() - days * DAY_MS)),
      where,
    ))
    .orderBy(desc(frustrated), desc(replayRecordings.startedAt))
    .limit(SEGMENT_SAMPLE);
}

/** Three cited patterns across a sample of the segment. Cached an hour; never stored. */
export async function summarizeSegment(
  env: Env,
  db: Db,
  scope: ReplayScope,
  input: { days?: number; filter?: ReplayFilter | null; actorId?: string | null } = {},
): Promise<ReplaySegmentSummaryDto> {
  const days = clampDays(input.days);
  const keys = await replayReadKeys(env, scope);
  return getOrSetCached(env, keys.segmentSummary(days, filterCacheKey(input.filter)), async () => {
    const sample = await segmentSample(env, db, scope, days, input.filter);
    if (sample.length === 0) return { patterns: [], sampled: 0, generatedAt: new Date().toISOString() };
    await takeReplayAiBudget(env, scope.tenantId);

    const marksById = new Map<string, ReplayMark[]>();
    await Promise.all(sample.map(async (row) => {
      marksById.set(row.id, (await getMarks(env, recordingLocation(row))).slice(0, SEGMENT_MARKS_PER_RECORDING));
    }));
    const transcript = sample
      .map((row) => `recording ${row.id}\n${visitDigest(toRecordingSummary(row), marksById.get(row.id) ?? [])}`)
      .join('\n\n');
    const condensed = await condenseTranscript(env, scope.tenantId, {
      transcript,
      header: `${sample.length} visits from one segment. Each timeline line is [mm:ss #ord] kind key "label".`,
      shape: SEGMENT_SHAPE,
      maxTokens: 600,
    });
    if ('error' in condensed) throw new ServiceUnavailableError(condensed.error, { code: 'summary_unavailable' });

    const ordCounts = new Map([...marksById].map(([id, marks]) => [id, marks.length]));
    const patterns = parsePatternCitations(condensed.text, ordCounts).map((pattern) => ({
      text: pattern.text,
      examples: pattern.examples.map((e) => ({ recordingId: e.recordingId, atMs: marksById.get(e.recordingId)![e.ord]!.atMs })),
    }));
    if (patterns.length === 0) throw new ServiceUnavailableError('The model wrote no cited pattern', { code: 'summary_uncited' });

    await recordReplayTrace(env, db, {
      tenantId: scope.tenantId,
      siteId: scope.siteId,
      verb: REPLAY_TRACE_VERBS.summaryGenerated,
      actorId: input.actorId ?? null,
      metadata: { kind: 'segment', sampled: sample.length, patterns: patterns.length },
    });
    return { patterns, sampled: sample.length, generatedAt: new Date().toISOString() };
  }, SEGMENT_TTL);
}

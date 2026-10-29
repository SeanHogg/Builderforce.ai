/**
 * Evermind learning pipeline — the product ledger behind roadmap 07bc5793.
 *
 * A text learn is a run. The run produces at most one candidate statement that
 * is not already in the project's baseline snapshot. A manager approves or
 * rejects it; an approval can be transferred into project_facts, which is the
 * store the model reads back. The four key results are computed from this
 * ledger. They stay at zero until real runs, reviews and bench pairs exist.
 */
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import {
  evermindLearningBaselines,
  evermindLearningCandidates,
  evermindLearningRuns,
  projectFacts,
} from '../../infrastructure/database/schema/delivery';
import type { Db } from '../../infrastructure/database/connection';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { Env } from '../../env';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { getProjectEvermindHead } from './projectEvermind';
import { QA_CACHE_SOURCE } from './projectFactsStore';
import { writeProjectFactResult } from '../knowledge/writeProjectFact';
import type { KnowledgeWriteResult } from '../knowledge/writeKnowledge';
import {
  extractCandidate,
  pipelineMetrics,
  type BaselineFact,
  type PipelineMetrics,
} from './learningPipeline';

const BASELINE_CAP = 200;
const PENDING_CAP = 50;
const METRIC_CAP = 2000;

export interface LearningPipelineReport {
  baseline: { headVersion: number; factCount: number; capturedAt: string } | null;
  pending: Array<{
    id: number;
    statement: string;
    factKey: string;
    contradicts: boolean;
    baselineContent: string | null;
    createdAt: string;
  }>;
  metrics: PipelineMetrics;
}

async function snapshotFacts(db: Db, tenantId: number, projectId: number): Promise<BaselineFact[]> {
  const rows = await db.select({ key: projectFacts.key, content: projectFacts.content })
    .from(projectFacts)
    .where(and(
      eq(projectFacts.tenantId, tenantId),
      eq(projectFacts.projectId, projectId),
      ne(projectFacts.source, QA_CACHE_SOURCE),
    ))
    .orderBy(desc(projectFacts.updatedAt))
    .limit(BASELINE_CAP);
  return rows.map((row) => ({ key: row.key.slice(0, 120), content: row.content.slice(0, 2000) }));
}

function asFacts(value: unknown): BaselineFact[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const key = (row as { key?: unknown }).key;
    const content = (row as { content?: unknown }).content;
    if (typeof key !== 'string' || typeof content !== 'string' || !key || !content) return [];
    return [{ key, content }];
  });
}

async function headVersion(env: Env, db: Db, tenantId: number, projectId: number): Promise<number> {
  try {
    return (await getProjectEvermindHead(env, db, tenantId, projectId)).version ?? 0;
  } catch (err) {
    reportCaughtError(err, {
      source: 'evermind-learning-pipeline',
      operation: 'read-head',
      level: 'warning',
      context: { tenantId, projectId },
    });
    return 0;
  }
}

export async function captureLearningBaseline(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
): Promise<{ headVersion: number; factCount: number; capturedAt: string }> {
  const version = await headVersion(env, db, tenantId, projectId);
  const facts = await snapshotFacts(db, tenantId, projectId);
  const capturedAt = new Date();
  await db.insert(evermindLearningBaselines).values({
    tenantId,
    projectId,
    headVersion: version,
    facts,
    factCount: facts.length,
    capturedAt,
  }).onConflictDoUpdate({
    target: [evermindLearningBaselines.tenantId, evermindLearningBaselines.projectId],
    set: { headVersion: version, facts, factCount: facts.length, capturedAt },
  });
  return { headVersion: version, factCount: facts.length, capturedAt: capturedAt.toISOString() };
}

async function baselineFacts(db: Db, tenantId: number, projectId: number): Promise<BaselineFact[]> {
  const [row] = await db.select({ facts: evermindLearningBaselines.facts })
    .from(evermindLearningBaselines)
    .where(and(eq(evermindLearningBaselines.tenantId, tenantId), eq(evermindLearningBaselines.projectId, projectId)))
    .limit(1);
  return asFacts(row?.facts);
}

/**
 * Record one text-learn as a pipeline run. A failure here must not fail the
 * learn itself — the weight update already succeeded.
 */
export async function recordLearningRun(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  text: string,
): Promise<void> {
  try {
    const version = await headVersion(env, db, tenantId, projectId);
    const candidate = extractCandidate(text, await baselineFacts(db, tenantId, projectId));
    const [run] = await db.insert(evermindLearningRuns).values({
      tenantId,
      projectId,
      headVersion: version,
      produced: candidate != null,
    }).returning({ id: evermindLearningRuns.id });
    if (!run || !candidate) return;
    await db.insert(evermindLearningCandidates).values({
      tenantId,
      projectId,
      runId: run.id,
      statement: candidate.statement,
      factKey: candidate.factKey,
      baselineContent: candidate.baselineContent,
      contradicts: candidate.contradicts,
    });
  } catch (err) {
    reportCaughtError(err, {
      source: 'evermind-learning-pipeline',
      operation: 'record-run',
      context: { tenantId, projectId },
    });
  }
}

export async function reviewLearningCandidate(
  db: Db,
  tenantId: number,
  projectId: number,
  candidateId: number,
  verdict: 'approved' | 'rejected',
  reviewerId: string | null,
): Promise<{ id: number; status: string } | null> {
  const [row] = await db.select({ id: evermindLearningCandidates.id, status: evermindLearningCandidates.status })
    .from(evermindLearningCandidates)
    .where(and(
      eq(evermindLearningCandidates.id, candidateId),
      eq(evermindLearningCandidates.tenantId, tenantId),
      eq(evermindLearningCandidates.projectId, projectId),
    ))
    .limit(1);
  if (!row) return null;
  if (row.status !== 'pending') return row;
  const [updated] = await db.update(evermindLearningCandidates).set({
    status: verdict,
    reviewedAt: new Date(),
    reviewedBy: reviewerId,
  }).where(scopedToTenant(evermindLearningCandidates, tenantId, eq(evermindLearningCandidates.id, row.id))).returning({
    id: evermindLearningCandidates.id,
    status: evermindLearningCandidates.status,
  });
  return updated ?? row;
}

export async function transferLearningCandidate(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  candidateId: number,
  bench: { before?: number; after?: number; reviewerId?: string },
): Promise<{ ok: true; id: number } | { ok: false; error: string; status: number; code?: string }> {
  const [row] = await db.select().from(evermindLearningCandidates).where(and(
    eq(evermindLearningCandidates.id, candidateId),
    eq(evermindLearningCandidates.tenantId, tenantId),
    eq(evermindLearningCandidates.projectId, projectId),
  )).limit(1);
  if (!row) return { ok: false, error: 'candidate not found', status: 404 };
  if (row.status === 'rejected') return { ok: false, error: 'a rejected learning cannot be transferred', status: 409 };
  if (row.transferredAt) return { ok: true, id: row.id };
  // Only a manager-APPROVED learning reaches project_facts — a pending one must be
  // reviewed first (reviewLearningCandidate), never promoted by the transfer itself.
  if (row.status !== 'approved') return { ok: false, error: 'only an approved learning can be transferred', status: 409 };
  const now = new Date();
  const candidateRow = (onlyIfApproved: boolean) => scopedToTenant(
    evermindLearningCandidates,
    tenantId,
    eq(evermindLearningCandidates.id, row.id),
    onlyIfApproved ? eq(evermindLearningCandidates.status, 'approved') : undefined,
  );
  // Race-safe CLAIM before the fact write: the status read above is a prior read,
  // so the UPDATE re-asserts `approved` — a candidate rejected between the read
  // and this write is neither stamped nor promoted into project_facts.
  const [claimed] = await db.update(evermindLearningCandidates).set({
    reviewedAt: row.reviewedAt ?? now,
    reviewedBy: row.reviewedBy ?? bench.reviewerId ?? null,
    transferredAt: now,
    ...(typeof bench.before === 'number' ? { benchBefore: bench.before } : {}),
    ...(typeof bench.after === 'number' ? { benchAfter: bench.after } : {}),
  }).where(candidateRow(true)).returning({ id: evermindLearningCandidates.id });
  if (!claimed) return { ok: false, error: 'only an approved learning can be transferred', status: 409 };

  const release = () => db.update(evermindLearningCandidates).set({ transferredAt: null }).where(candidateRow(false));
  let written: KnowledgeWriteResult;
  try {
    written = await writeProjectFactResult({ env, db, tenantId, projectId }, { key: row.factKey, content: row.statement, source: 'evermind-pipeline' });
  } catch (error) {
    await release();
    throw error;
  }
  if (written.factsWritten === 0) {
    await release();
    // The writer never overwrites a fact a PERSON authored: that is a conflict the manager
    // resolves (edit or retire the fact, or reject the learning), not a store outage.
    if (written.factsSkipped?.includes(row.factKey)) {
      return {
        ok: false, status: 409, code: 'fact_owned_by_person',
        error: `the fact '${row.factKey}' was written by a person and is not overwritten by a learning; edit or retire that fact, or reject this learning`,
      };
    }
    return { ok: false, error: 'project facts store refused the learning', status: 503 };
  }
  return { ok: true, id: row.id };
}

export async function learningPipelineReport(
  db: Db,
  tenantId: number,
  projectId: number,
): Promise<LearningPipelineReport> {
  const scope = and(eq(evermindLearningRuns.tenantId, tenantId), eq(evermindLearningRuns.projectId, projectId));
  const candidateScope = and(
    eq(evermindLearningCandidates.tenantId, tenantId),
    eq(evermindLearningCandidates.projectId, projectId),
  );
  const [baseline] = await db.select({
    headVersion: evermindLearningBaselines.headVersion,
    factCount: evermindLearningBaselines.factCount,
    capturedAt: evermindLearningBaselines.capturedAt,
  }).from(evermindLearningBaselines).where(and(
    eq(evermindLearningBaselines.tenantId, tenantId),
    eq(evermindLearningBaselines.projectId, projectId),
  )).limit(1);
  const [runAgg] = await db.select({
    runs: sql<number>`count(*)::int`,
    produced: sql<number>`count(*) filter (where ${evermindLearningRuns.produced})::int`,
  }).from(evermindLearningRuns).where(scope);
  const [candidateAgg] = await db.select({
    candidates: sql<number>`count(*)::int`,
    contradictions: sql<number>`count(*) filter (where ${evermindLearningCandidates.contradicts})::int`,
  }).from(evermindLearningCandidates).where(candidateScope);
  const reviews = await db.select({
    createdAt: evermindLearningCandidates.createdAt,
    reviewedAt: evermindLearningCandidates.reviewedAt,
    benchBefore: evermindLearningCandidates.benchBefore,
    benchAfter: evermindLearningCandidates.benchAfter,
    transferredAt: evermindLearningCandidates.transferredAt,
  }).from(evermindLearningCandidates)
    .where(and(candidateScope, sql`${evermindLearningCandidates.reviewedAt} is not null`))
    .orderBy(desc(evermindLearningCandidates.reviewedAt))
    .limit(METRIC_CAP);
  const pending = await db.select({
    id: evermindLearningCandidates.id,
    statement: evermindLearningCandidates.statement,
    factKey: evermindLearningCandidates.factKey,
    contradicts: evermindLearningCandidates.contradicts,
    baselineContent: evermindLearningCandidates.baselineContent,
    createdAt: evermindLearningCandidates.createdAt,
  }).from(evermindLearningCandidates)
    .where(and(candidateScope, eq(evermindLearningCandidates.status, 'pending')))
    .orderBy(desc(evermindLearningCandidates.createdAt))
    .limit(PENDING_CAP);

  const runs = Number(runAgg?.runs ?? 0);
  const produced = Number(runAgg?.produced ?? 0);
  // Review timing and transfer uplift come from the reviewed rows. Run totals
  // come from the aggregate — materialising one object per run would allocate
  // the whole ledger into the request.
  const metrics = pipelineMetrics(reviews.map((row) => ({
    kind: 'candidate' as const,
    contradicts: false,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    benchBefore: row.benchBefore,
    benchAfter: row.benchAfter,
    transferred: row.transferredAt != null,
  })));
  const candidates = Number(candidateAgg?.candidates ?? 0);
  const contradictions = Number(candidateAgg?.contradictions ?? 0);
  const extractionRate = runs === 0 ? 0 : Math.round((produced / runs) * 1000) / 10;
  return {
    baseline: baseline
      ? { headVersion: baseline.headVersion, factCount: baseline.factCount, capturedAt: baseline.capturedAt.toISOString() }
      : null,
    pending: pending.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    metrics: {
      ...metrics,
      runs,
      produced,
      candidates,
      extractionRate,
      contradictionRate: candidates === 0 ? 0 : Math.round((contradictions / candidates) * 1000) / 10,
    },
  };
}

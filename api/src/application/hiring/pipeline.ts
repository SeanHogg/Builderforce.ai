/**
 * The pipeline WRITER — the half of `job_pipeline_entries` that never existed.
 *
 * ── WHAT WAS MISSING ─────────────────────────────────────────────────────────────
 * `hiringFunnel.ts` has read this table since 0419: stage conversion, time-in-stage,
 * source-of-hire, the bottleneck. Every one of those numbers is computed from
 * `entered_at`, `exited_at` and `days_in_stage` — and nothing in the codebase wrote a
 * row, so the Recruiter seat owned a report over an empty table and a board with no
 * candidates on it. This module is the writer those reads were waiting for.
 *
 * ── A MOVE IS TWO ROWS, NOT ONE UPDATE ───────────────────────────────────────────
 * The obvious implementation — one row per candidate, `UPDATE … SET stage = 'offer'` —
 * destroys the funnel. `days_in_stage` and `exited_at` only mean anything if the row
 * being LEFT keeps its own clock, so a transition closes the current entry (stamping
 * when it ended and how long it took) and opens a new one. The table's own shape says
 * so: it has both `entered_at` and `exited_at`, which a mutable-status row would never
 * need.
 *
 * A move WITHIN a stage is therefore deliberately not a transition. Dragging a card up
 * its own column is a priority change, and closing the entry for it would record a
 * zero-day pass through a stage the candidate never left — inventing conversion events
 * out of a recruiter tidying their board.
 *
 * ── ONE READ, THEN THE WRITES ────────────────────────────────────────────────────
 * Every mutation here starts from a single read of the pipeline's OPEN entries. Reading
 * the current entry, then the target column, then the neighbours to renumber is three
 * round trips against a table whose live set is board-sized; one read of that set answers
 * all three. `neon-http` has no transactions (see the gap register), so the ordering
 * below is chosen to be safe when interrupted: the new entry is written before the old
 * one is closed, because a candidate briefly in two stages is a visible duplicate a
 * recruiter can fix, while a candidate in none has silently fallen out of the funnel.
 *
 * ── EVERY WRITE INVALIDATES THE FUNNEL ───────────────────────────────────────────
 * `invalidateHiringFunnel` is called on every path that changes a stage. The funnel is
 * cached for five minutes and its docstring states the contract — "invalidate on every
 * pipeline write, so the number is never older than the last stage change that produced
 * it". This module is the only thing that produces one.
 */

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  candidateResumes,
  jobApplications,
  jobPipelineEntries,
} from '../../infrastructure/database/schema/hiring';
import { jobPostings } from '../../infrastructure/database/schema/agents';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { invalidateHiringFunnel } from './hiringFunnel';
import { AtsError } from './atsError';
import {
  boardStages,
  daysInStage,
  normalizeStage,
  ENTRY_STAGE,
  TERMINAL_STAGES,
} from '../../domain/hiring/pipelineStages';
import type { Env } from '../../env';

/** One candidate as the board draws them. */
export interface PipelineCard {
  entryId: number;
  applicationId: number | null;
  candidateRef: string;
  stage: string;
  position: number;
  enteredAt: string;
  ownerRef: string | null;
  source: string | null;
  /** From the employer-side résumé snapshot, so a card is a person rather than a ref. */
  headline: string | null;
  yearsExp: number | null;
  skills: string[];
  /** The application's own score, when it has one. */
  score: number | null;
  daysInStage: number;
}

export interface PipelineColumn {
  stage: string;
  cards: PipelineCard[];
}

export interface PipelineBoard {
  pipelineRef: string;
  columns: PipelineColumn[];
  totalOpen: number;
  fetchedAt: string;
}

/** The open entries of one pipeline, with the candidate detail a card shows. Exported
 *  so `composeBoard` can be exercised against fixture rows rather than a database. */
export interface OpenEntry {
  entryId: number;
  applicationId: number | null;
  candidateRef: string;
  stage: string;
  position: number;
  enteredAt: Date;
  ownerRef: string | null;
  source: string | null;
  headline: string | null;
  yearsExp: string | null;
  skills: unknown;
  score: string | null;
}

/**
 * One pipeline's still-open entries, with the candidate detail a card shows.
 *
 * Exported because `decisions.ts` needs the candidate's CURRENT stage before it can work
 * out where a decision puts them, and re-deriving "who is live here" from a second query
 * over the same table is how two surfaces come to disagree about which column somebody is
 * in.
 */
export async function readOpenEntries(db: Db, tenantId: number, pipelineRef: string): Promise<OpenEntry[]> {
  const rows = await db
    .select({
      entryId: jobPipelineEntries.id,
      applicationId: jobPipelineEntries.applicationId,
      candidateRef: jobPipelineEntries.candidateRef,
      stage: jobPipelineEntries.stage,
      position: jobPipelineEntries.position,
      enteredAt: jobPipelineEntries.enteredAt,
      ownerRef: jobPipelineEntries.ownerRef,
      source: jobPipelineEntries.source,
      headline: candidateResumes.headline,
      yearsExp: candidateResumes.yearsExp,
      skills: candidateResumes.skills,
      score: jobApplications.score,
    })
    .from(jobPipelineEntries)
    // The résumé snapshot is the employer's own copy (`candidateResumeProjection.ts`), so
    // joining it here is a read of this tenant's table and not a reach into the
    // candidate's private document store. Both join predicates carry the tenant: a join
    // key of `candidate_ref` alone would match the same person in another workspace.
    .leftJoin(candidateResumes, and(
      eq(candidateResumes.tenantId, jobPipelineEntries.tenantId),
      eq(candidateResumes.candidateRef, jobPipelineEntries.candidateRef),
    ))
    .leftJoin(jobApplications, and(
      eq(jobApplications.tenantId, jobPipelineEntries.tenantId),
      eq(jobApplications.id, jobPipelineEntries.applicationId),
    ))
    .where(scopedToTenant(
      jobPipelineEntries,
      tenantId,
      eq(jobPipelineEntries.pipelineRef, pipelineRef),
      isNull(jobPipelineEntries.exitedAt),
    ))
    .orderBy(asc(jobPipelineEntries.position), asc(jobPipelineEntries.enteredAt));
  return rows as unknown as OpenEntry[];
}

function toCard(entry: OpenEntry, now: Date): PipelineCard {
  const enteredAt = entry.enteredAt instanceof Date ? entry.enteredAt : new Date(entry.enteredAt);
  return {
    entryId: entry.entryId,
    applicationId: entry.applicationId ?? null,
    candidateRef: entry.candidateRef,
    stage: entry.stage,
    position: entry.position,
    enteredAt: enteredAt.toISOString(),
    ownerRef: entry.ownerRef ?? null,
    source: entry.source ?? null,
    headline: entry.headline ?? null,
    yearsExp: entry.yearsExp === null ? null : Number(entry.yearsExp),
    skills: Array.isArray(entry.skills) ? (entry.skills as string[]).filter((s): s is string => typeof s === 'string') : [],
    score: entry.score === null ? null : Number(entry.score),
    daysInStage: daysInStage(enteredAt, now),
  };
}

/** Compute the board from the open set. Separated from the cache so the column layout
 *  can be asserted without a KV binding, exactly as `computeHiringFunnel` is. */
export function composeBoard(pipelineRef: string, entries: OpenEntry[], now = new Date()): PipelineBoard {
  const stages = boardStages(entries.map((entry) => entry.stage));
  const byStage = new Map<string, PipelineCard[]>(stages.map((stage) => [stage, []]));
  for (const entry of entries) {
    const cards = byStage.get(entry.stage);
    // `boardStages` is derived from these same rows, so every stage has a column. The
    // guard is for the one case it cannot cover: a stage name that normalises to
    // something different from what is stored (mixed case written before 0983).
    if (cards) cards.push(toCard(entry, now));
    else byStage.set(entry.stage, [toCard(entry, now)]);
  }
  return {
    pipelineRef,
    columns: [...byStage.entries()].map(([stage, cards]) => ({
      stage,
      cards: cards.sort((a, b) => a.position - b.position),
    })),
    totalOpen: entries.length,
    fetchedAt: now.toISOString(),
  };
}

function boardKey(tenantId: number, pipelineRef: string): string {
  return `hiring:board:${tenantId}:${pipelineRef}`;
}

/**
 * The board, read through the canonical cache.
 *
 * A shorter TTL than the funnel's five minutes: a funnel is a report somebody reads once
 * an hour, while a board is a shared work surface where a stale column means two
 * recruiters phone the same candidate. Sixty seconds in KV with every write invalidating
 * it is the balance the rest of the app uses for collaborative lists.
 */
export async function pipelineBoard(
  env: Env,
  db: Db,
  tenantId: number,
  pipelineRef: string,
): Promise<PipelineBoard> {
  return getOrSetCached(
    env,
    boardKey(tenantId, pipelineRef),
    async () => composeBoard(pipelineRef, await readOpenEntries(db, tenantId, pipelineRef)),
    { kvTtlSeconds: 60, l1TtlMs: 5_000 },
  );
}

/**
 * Drop everything a stage change invalidates — the board AND the funnel.
 *
 * Both, always, from one function. The funnel's own docstring asks callers to invalidate
 * it on every pipeline write; adding a second cache made that two things to remember,
 * and the first one anybody forgets is the one they cannot see is stale.
 */
export async function invalidatePipeline(env: Env | undefined, tenantId: number, pipelineRef: string): Promise<void> {
  // `Env | undefined` on the WRITE paths, exactly as `activityLog.recordActivity` types
  // it and for the same reason: a write can reach this module from a caller that has no
  // Worker binding to hand (the marketplace's proposal route, and every unit test). Both
  // cache helpers already treat a missing binding as "nothing to invalidate" — they read
  // `env?.AUTH_CACHE_KV` — so the bridge is a single assertion here rather than an
  // optional `env` threaded through six signatures.
  const cacheEnv = env as Env;
  await Promise.all([
    invalidateCached(cacheEnv, boardKey(tenantId, pipelineRef)),
    // The pipeline PICKER counts open candidates, so it goes stale on exactly the same
    // writes as the board it sits above.
    invalidateCached(cacheEnv, `hiring:pipelines:${tenantId}`),
    invalidateHiringFunnel(cacheEnv, tenantId, pipelineRef),
  ]);
}

export interface EnterPipelineInput {
  tenantId: number;
  pipelineRef: string;
  candidateRef: string;
  applicationId?: number | null;
  /** Defaults to the ladder's entry stage — applying IS entering at the top. */
  stage?: string | null;
  /** Where the candidate came from, stamped once and never updated (0460). */
  source?: string | null;
  ownerRef?: string | null;
}

export interface PipelineEntryRef {
  entryId: number;
  stage: string;
  position: number;
  /** False when the candidate was already live in this pipeline. */
  created: boolean;
}

/**
 * Put a candidate into a pipeline, once.
 *
 * Idempotent on "is this person already live here": re-applying, or a recruiter adding
 * somebody who is already at `interview`, returns the existing entry rather than opening
 * a second one. Two open entries for one candidate would double-count them in every
 * stage of the funnel, and the funnel counts rows.
 */
export async function enterPipeline(
  db: Db,
  env: Env | undefined,
  input: EnterPipelineInput,
): Promise<PipelineEntryRef> {
  const stage = normalizeStage(input.stage) ?? ENTRY_STAGE;
  const entries = await readOpenEntries(db, input.tenantId, input.pipelineRef);
  const existing = entries.find((entry) => entry.candidateRef === input.candidateRef);
  if (existing) return { entryId: existing.entryId, stage: existing.stage, position: existing.position, created: false };

  const position = entries.filter((entry) => entry.stage === stage).length;
  const [row] = await db
    .insert(jobPipelineEntries)
    .values({
      tenantId: input.tenantId,
      pipelineRef: input.pipelineRef,
      candidateRef: input.candidateRef,
      applicationId: input.applicationId ?? null,
      stage,
      position,
      source: input.source ?? null,
      ownerRef: input.ownerRef ?? null,
    })
    .returning({ id: jobPipelineEntries.id });
  if (!row) throw new AtsError('The candidate could not be added to this pipeline.', 500);

  await invalidatePipeline(env, input.tenantId, input.pipelineRef);
  return { entryId: row.id, stage, position, created: true };
}

export interface MoveCandidateInput {
  tenantId: number;
  pipelineRef: string;
  candidateRef: string;
  toStage: string;
  /** Index within the target column. Appended when absent. */
  position?: number | null;
  ownerRef?: string | null;
}

export interface MoveResult {
  entryId: number;
  fromStage: string;
  toStage: string;
  position: number;
  /** False for a reorder inside one column — no funnel event was recorded. */
  transitioned: boolean;
  daysInPreviousStage: number | null;
}

/**
 * Move a live candidate to a stage, or reorder them within the one they are in.
 *
 * The stage vocabulary comes from `domain/hiring/pipelineStages.ts` and is NOT validated
 * against a fixed list here: a tenant renames its stages, and refusing an unknown name
 * would break every pipeline that ever did. What is validated is that the name is a name
 * — `normalizeStage` folds case and bounds the length, so `Screen` and `screen` cannot
 * become two columns of the same board.
 */
export async function moveCandidate(
  db: Db,
  env: Env | undefined,
  input: MoveCandidateInput,
  now = new Date(),
): Promise<MoveResult> {
  const toStage = normalizeStage(input.toStage);
  if (!toStage) throw new AtsError('Name the stage to move this candidate to.', 400);

  const entries = await readOpenEntries(db, input.tenantId, input.pipelineRef);
  const current = entries.find((entry) => entry.candidateRef === input.candidateRef);
  if (!current) throw new AtsError('That candidate is not live in this pipeline.', 404);

  const siblings = entries
    .filter((entry) => entry.stage === toStage && entry.entryId !== current.entryId)
    .sort((a, b) => a.position - b.position);
  const target = Math.max(0, Math.min(Math.round(input.position ?? siblings.length), siblings.length));

  // ── Reorder inside one column: a priority change, NOT a stage transition ──────────
  if (current.stage === toStage) {
    const reordered = [...siblings];
    reordered.splice(target, 0, current);
    await renumber(db, input.tenantId, reordered);
    if (input.ownerRef !== undefined) {
      await db
        .update(jobPipelineEntries)
        .set({ ownerRef: input.ownerRef ?? null, updatedAt: now })
        .where(scopedToTenant(jobPipelineEntries, input.tenantId, eq(jobPipelineEntries.id, current.entryId)));
    }
    await invalidatePipeline(env, input.tenantId, input.pipelineRef);
    return {
      entryId: current.entryId,
      fromStage: current.stage,
      toStage,
      position: target,
      transitioned: false,
      daysInPreviousStage: null,
    };
  }

  // ── A real transition: open the new entry, then close the old one ────────────────
  const enteredAt = current.enteredAt instanceof Date ? current.enteredAt : new Date(current.enteredAt);
  const [opened] = await db
    .insert(jobPipelineEntries)
    .values({
      tenantId: input.tenantId,
      pipelineRef: input.pipelineRef,
      candidateRef: current.candidateRef,
      applicationId: current.applicationId ?? null,
      stage: toStage,
      position: target,
      // Carried forward rather than re-derived. The column is denormalised with a single
      // writer precisely so source-of-hire conversion does not need a join per
      // transition (0460); re-reading the application here would reintroduce it.
      source: current.source ?? null,
      ownerRef: input.ownerRef === undefined ? current.ownerRef ?? null : input.ownerRef,
      enteredAt: now,
    })
    .returning({ id: jobPipelineEntries.id });
  if (!opened) throw new AtsError('The stage change could not be recorded.', 500);

  const days = daysInStage(enteredAt, now);
  await db
    .update(jobPipelineEntries)
    .set({ exitedAt: now, daysInStage: days, updatedAt: now })
    .where(scopedToTenant(
      jobPipelineEntries,
      input.tenantId,
      eq(jobPipelineEntries.id, current.entryId),
      // Only close an entry that is still open. Two concurrent moves would otherwise
      // both close it, and the second would overwrite the first's clock with a longer
      // one — a stage that reports as slower every time somebody double-clicks.
      isNull(jobPipelineEntries.exitedAt),
    ));

  const reordered = [...siblings];
  reordered.splice(target, 0, { ...current, entryId: opened.id, stage: toStage, position: target });
  await renumber(db, input.tenantId, reordered);

  // The application's status follows the board. It is the same fact — where this person
  // is — and a status that disagreed with the pipeline would make the applications list
  // and the board two answers to one question.
  if (current.applicationId != null) {
    await db
      .update(jobApplications)
      .set({
        status: toStage,
        ...(toStage === 'rejected' ? { rejectedAt: now } : {}),
        updatedAt: now,
      })
      .where(scopedToTenant(jobApplications, input.tenantId, eq(jobApplications.id, current.applicationId)));
  }

  await invalidatePipeline(env, input.tenantId, input.pipelineRef);
  return {
    entryId: opened.id,
    fromStage: current.stage,
    toStage,
    position: target,
    transitioned: true,
    daysInPreviousStage: days,
  };
}

/**
 * Give a column contiguous positions, writing only the rows that actually moved.
 *
 * A column holds the candidates a recruiter is working, so this is tens of rows at worst
 * — but writing every one of them on every drag would turn a reorder into a column-sized
 * write. Only the changed ones are updated.
 */
async function renumber(
  db: Db,
  tenantId: number,
  ordered: Array<{ entryId: number; position: number }>,
): Promise<void> {
  const updates = ordered.flatMap((entry, index) => (entry.position === index ? [] : [{ id: entry.entryId, position: index }]));
  await Promise.all(updates.map((update) =>
    db
      .update(jobPipelineEntries)
      .set({ position: update.position, updatedAt: sql`now()` })
      .where(scopedToTenant(jobPipelineEntries, tenantId, eq(jobPipelineEntries.id, update.id))),
  ));
}

/**
 * Close a candidate's open entry without opening another — the end of the road.
 *
 * Used when a pipeline itself ends (the requisition is filled or withdrawn), which is not
 * a stage the candidate reached and must not be recorded as one. A hire and a rejection
 * both go through `moveCandidate` into their terminal stage instead, because both ARE
 * outcomes the funnel is measuring.
 */
export async function closePipelineEntry(
  db: Db,
  env: Env | undefined,
  input: { tenantId: number; pipelineRef: string; candidateRef: string },
  now = new Date(),
): Promise<{ closed: boolean }> {
  const entries = await readOpenEntries(db, input.tenantId, input.pipelineRef);
  const current = entries.find((entry) => entry.candidateRef === input.candidateRef);
  if (!current) return { closed: false };
  const enteredAt = current.enteredAt instanceof Date ? current.enteredAt : new Date(current.enteredAt);
  await db
    .update(jobPipelineEntries)
    .set({ exitedAt: now, daysInStage: daysInStage(enteredAt, now), updatedAt: now })
    .where(scopedToTenant(
      jobPipelineEntries,
      input.tenantId,
      eq(jobPipelineEntries.id, current.entryId),
      isNull(jobPipelineEntries.exitedAt),
    ));
  await invalidatePipeline(env, input.tenantId, input.pipelineRef);
  return { closed: true };
}

/** One pipeline, as the picker above the board lists it. */
export interface PipelineSummary {
  pipelineRef: string;
  /** The posting's own title. Null when the pipeline names a posting that no longer
   *  exists — the entries survive it (ON DELETE SET NULL on the application), and a
   *  pipeline whose requisition was deleted is exactly the one somebody needs to find. */
  title: string | null;
  postingStatus: string | null;
  openCount: number;
  lastActivityAt: string | null;
}

/**
 * Every pipeline this workspace has candidates in — ONE grouped read.
 *
 * The title is joined from `job_postings`, which is the marketplace's table and not
 * hiring's. That is a deliberate read across the seam and not a leak: migration 0983
 * declares the foreign key between them, so this follows a declared reference rather
 * than matching on a string, and the alternative is a board headed by a bare uuid.
 */
export async function listPipelines(env: Env, db: Db, tenantId: number): Promise<PipelineSummary[]> {
  return getOrSetCached(env, `hiring:pipelines:${tenantId}`, async () => {
    const rows = await db
      .select({
        pipelineRef: jobPipelineEntries.pipelineRef,
        title: jobPostings.title,
        postingStatus: jobPostings.status,
        openCount: sql<number>`count(*) filter (where ${jobPipelineEntries.exitedAt} is null)::int`,
        lastActivityAt: sql<Date>`max(${jobPipelineEntries.enteredAt})`,
      })
      .from(jobPipelineEntries)
      .leftJoin(jobPostings, and(
        eq(jobPostings.tenantId, jobPipelineEntries.tenantId),
        eq(jobPostings.id, jobPipelineEntries.pipelineRef),
      ))
      .where(scopedToTenant(jobPipelineEntries, tenantId))
      .groupBy(jobPipelineEntries.pipelineRef, jobPostings.title, jobPostings.status)
      .orderBy(desc(sql`max(${jobPipelineEntries.enteredAt})`))
      .limit(200);

    return rows.map((row) => ({
      pipelineRef: row.pipelineRef,
      title: row.title ?? null,
      postingStatus: row.postingStatus ?? null,
      openCount: Number(row.openCount ?? 0),
      lastActivityAt: row.lastActivityAt ? new Date(row.lastActivityAt).toISOString() : null,
    }));
  }, { kvTtlSeconds: 60, l1TtlMs: 5_000 });
}

/** Whether a stage ends a candidate's run — the route uses it to decide whether a move
 *  needs a recorded decision behind it. */
export function isTerminalStage(stage: string): boolean {
  return TERMINAL_STAGES.includes(stage);
}

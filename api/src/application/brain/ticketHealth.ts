/**
 * ticketHealth — batched, LIVE health (% done) for a set of (kind, ref) tickets.
 *
 * Health is derived from ticket state that mutates on the board outside the chat
 * write path, so it is deliberately NOT cached — a stale ring would misreport
 * progress. Every read is a small, bounded aggregate, one query per tier, never N+1.
 * The task tier (task/gap/epic) lives in {@link addTaskTierHealth}; this module
 * orchestrates the batch and owns every other tier.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  tasks,
  objectives,
  keyResults,
  initiatives,
  portfolios,
  roadmapItems,
  specs,
  pokerSessions,
  pokerStories,
  retrospectives,
  retroItems,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { resolveSegment } from '../../infrastructure/auth/segmentResolver';
import { isCeremonySessionDone } from '../../domain/agile/ceremonySession';
import { keyResultProgress, objectiveProgress } from '../pmo/portfolioRollup';
import type { Db } from '../../infrastructure/database/connection';
import { isTicketKind, missingTicket, ticketKey as key, type TicketHealth } from './chatTicketTypes';
import { addTaskTierHealth, SQL_COUNT_DONE } from './taskTierTicketHealth';

/** Roadmap-item statuses that count as delivered ('shipped' is the publish marker). */
const ROADMAP_DONE = new Set(['shipped', 'done', 'complete', 'completed', 'released']);

/**
 * Batched health for a set of (kind, ref) targets — one aggregate query per
 * tier, so a chat with N linked tickets costs a constant handful of queries.
 *
 * Task-tier rows additionally carry {@link TicketHealth.parent}, so a chat's
 * ticket rail can say which epic each ticket belongs to.
 */
export async function ticketHealthBatch(db: Db, tenantId: number, targets: Array<{ kind: string; ref: string }>): Promise<Map<string, TicketHealth>> {
  const out = new Map<string, TicketHealth>();
  const clean = targets.filter((t) => isTicketKind(t.kind));
  if (clean.length === 0) return out;

  const taskIds = new Set<number>();
  const epicIds = new Set<number>();
  const gapIds = new Set<number>();
  const objIds = new Set<string>();
  const initIds = new Set<string>();
  const pfIds = new Set<string>();
  const roadmapIds = new Set<string>();
  const specIds = new Set<string>();
  const retroIds = new Set<string>();
  const pokerIds = new Set<string>();
  for (const t of clean) {
    if (t.kind === 'task') { const n = Number(t.ref); if (Number.isInteger(n)) taskIds.add(n); }
    else if (t.kind === 'epic') { const n = Number(t.ref); if (Number.isInteger(n)) epicIds.add(n); }
    else if (t.kind === 'gap') { const n = Number(t.ref); if (Number.isInteger(n)) gapIds.add(n); }
    else if (t.kind === 'objective') objIds.add(t.ref);
    else if (t.kind === 'initiative') initIds.add(t.ref);
    else if (t.kind === 'portfolio') pfIds.add(t.ref);
    else if (t.kind === 'roadmap') roadmapIds.add(t.ref);
    else if (t.kind === 'spec') specIds.add(t.ref);
    else if (t.kind === 'retro') retroIds.add(t.ref);
    else if (t.kind === 'poker') pokerIds.add(t.ref);
  }

  await addTaskTierHealth(db, tenantId, { taskIds, epicIds, gapIds }, out);

  if (objIds.size > 0) {
    const seg = await resolveSegment(db, tenantId);
    const objRows = await db.select({ id: objectives.id, title: objectives.title, status: objectives.status }).from(objectives)
      .where(and(inArray(objectives.id, [...objIds]), eq(objectives.tenantId, tenantId), eq(objectives.segmentId, seg)));
    const krRows = await db.select({
      objectiveId: keyResults.objectiveId, metricType: keyResults.metricType,
      startValue: keyResults.startValue, targetValue: keyResults.targetValue,
      currentValue: keyResults.currentValue, status: keyResults.status,
    }).from(keyResults).where(scopedToTenant(keyResults, tenantId, inArray(keyResults.objectiveId, [...objIds])));
    const krByObj = new Map<string, typeof krRows>();
    for (const kr of krRows) { const arr = krByObj.get(kr.objectiveId) ?? []; arr.push(kr); krByObj.set(kr.objectiveId, arr); }
    const objById = new Map(objRows.map((r) => [r.id, r]));
    for (const id of objIds) {
      const o = objById.get(id);
      if (!o) { out.set(key('objective', id), missingTicket('objective', id)); continue; }
      const krs = krByObj.get(id) ?? [];
      const progresses = krs.map((kr) => keyResultProgress(kr));
      const progressPct = Math.round(objectiveProgress(progresses) * 100);
      const done = krs.filter((kr) => kr.status === 'done').length;
      out.set(key('objective', id), { kind: 'objective', ref: id, label: o.title, status: o.status, progressPct, done, total: krs.length, exists: true });
    }
  }

  if (initIds.size > 0) {
    const seg = await resolveSegment(db, tenantId);
    const initRows = await db.select({ id: initiatives.id, name: initiatives.name, status: initiatives.status }).from(initiatives)
      .where(and(inArray(initiatives.id, [...initIds]), eq(initiatives.tenantId, tenantId), eq(initiatives.segmentId, seg)));
    const rollup = await db.select({
      initiativeId: tasks.initiativeId,
      total: sql<number>`count(*)`,
      done: SQL_COUNT_DONE,
    }).from(tasks).where(scopedToTenant(tasks, tenantId, inArray(tasks.initiativeId, [...initIds]))).groupBy(tasks.initiativeId);
    const byInit = new Map(rollup.map((r) => [String(r.initiativeId), { total: Number(r.total), done: Number(r.done) }]));
    const initById = new Map(initRows.map((r) => [r.id, r]));
    for (const id of initIds) {
      const i = initById.get(id);
      if (!i) { out.set(key('initiative', id), missingTicket('initiative', id)); continue; }
      const c = byInit.get(id) ?? { total: 0, done: 0 };
      const progressPct = c.total > 0 ? Math.round((c.done / c.total) * 100) : 0;
      out.set(key('initiative', id), { kind: 'initiative', ref: id, label: i.name, status: i.status, progressPct, done: c.done, total: c.total, exists: true });
    }
  }

  if (pfIds.size > 0) {
    const seg = await resolveSegment(db, tenantId);
    const pfRows = await db.select({ id: portfolios.id, name: portfolios.name, status: portfolios.status }).from(portfolios)
      .where(and(inArray(portfolios.id, [...pfIds]), eq(portfolios.tenantId, tenantId), eq(portfolios.segmentId, seg)));
    const rollup = await db.select({
      portfolioId: initiatives.portfolioId,
      total: sql<number>`count(${tasks.id})`,
      done: SQL_COUNT_DONE,
    }).from(tasks)
      .innerJoin(initiatives, eq(initiatives.id, tasks.initiativeId))
      .where(scopedToTenant(tasks, tenantId, inArray(initiatives.portfolioId, [...pfIds])))
      .groupBy(initiatives.portfolioId);
    const byPf = new Map(rollup.map((r) => [String(r.portfolioId), { total: Number(r.total), done: Number(r.done) }]));
    const pfById = new Map(pfRows.map((r) => [r.id, r]));
    for (const id of pfIds) {
      const p = pfById.get(id);
      if (!p) { out.set(key('portfolio', id), missingTicket('portfolio', id)); continue; }
      const c = byPf.get(id) ?? { total: 0, done: 0 };
      const progressPct = c.total > 0 ? Math.round((c.done / c.total) * 100) : 0;
      out.set(key('portfolio', id), { kind: 'portfolio', ref: id, label: p.name, status: p.status, progressPct, done: c.done, total: c.total, exists: true });
    }
  }

  if (roadmapIds.size > 0) {
    const rmRows = await db.select({ id: roadmapItems.id, title: roadmapItems.title, status: roadmapItems.status })
      .from(roadmapItems)
      .where(and(inArray(roadmapItems.id, [...roadmapIds]), eq(roadmapItems.tenantId, tenantId)));
    const rmById = new Map(rmRows.map((r) => [r.id, r]));
    for (const id of roadmapIds) {
      const r = rmById.get(id);
      if (!r) { out.set(key('roadmap', id), missingTicket('roadmap', id)); continue; }
      // A roadmap item has no child rollup — derive progress from its own status.
      const s = (r.status ?? '').toLowerCase();
      const done = ROADMAP_DONE.has(s) ? 1 : 0;
      const progressPct = done ? 100 : (s === 'in_progress' || s === 'active' ? 50 : 0);
      out.set(key('roadmap', id), { kind: 'roadmap', ref: id, label: r.title, status: r.status, progressPct, done, total: 1, exists: true });
    }
  }

  if (specIds.size > 0) {
    const specRows = await db.select({ id: specs.id, goal: specs.goal, status: specs.status })
      .from(specs)
      .where(and(inArray(specs.id, [...specIds]), eq(specs.tenantId, tenantId)));
    const specById = new Map(specRows.map((r) => [r.id, r]));
    for (const id of specIds) {
      const s = specById.get(id);
      if (!s) { out.set(key('spec', id), missingTicket('spec', id)); continue; }
      // A spec has no child rollup — derive progress from its own lifecycle status.
      const st = (s.status ?? '').toLowerCase();
      const done = st === 'complete' ? 1 : 0;
      const progressPct = done ? 100 : (st === 'in_progress' || st === 'ready' ? 50 : 0);
      out.set(key('spec', id), { kind: 'spec', ref: id, label: s.goal, status: s.status, progressPct, done, total: 1, exists: true });
    }
  }

  // ── Team ceremonies ──────────────────────────────────────────────────────
  // A retro is a LEAF (its items are observations, not work that completes), so it
  // reads like roadmap/spec: terminal status ⇒ 100. The middle value is the honest
  // part — an OPEN retro is only "underway" once the team has actually put something
  // in it, so an empty one reports 0 rather than the flat 50% a status-only rule
  // would give every retro the moment it is created.
  if (retroIds.size > 0) {
    const rows = await db.select({ id: retrospectives.id, name: retrospectives.name, status: retrospectives.status })
      .from(retrospectives)
      .where(and(inArray(retrospectives.id, [...retroIds]), eq(retrospectives.tenantId, tenantId)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    // One grouped count for EVERY linked retro — never a query per link.
    const itemCounts = rows.length
      ? await db.select({ retroId: retroItems.retroId, n: sql<number>`count(*)::int` })
          .from(retroItems)
          .where(and(inArray(retroItems.retroId, rows.map((r) => r.id)), eq(retroItems.tenantId, tenantId)))
          .groupBy(retroItems.retroId)
      : [];
    const itemsById = new Map(itemCounts.map((c) => [c.retroId, Number(c.n) || 0]));
    for (const id of retroIds) {
      const r = byId.get(id);
      if (!r) { out.set(key('retro', id), missingTicket('retro', id)); continue; }
      const done = isCeremonySessionDone(r.status) ? 1 : 0;
      const items = itemsById.get(id) ?? 0;
      const progressPct = done ? 100 : (items > 0 ? 50 : 0);
      out.set(key('retro', id), { kind: 'retro', ref: id, label: r.name, status: r.status, progressPct, done, total: 1, exists: true });
    }
  }

  // A poker session IS a container: its stories are the work, and a story is done
  // when it carries a final estimate — which is the entire point of the ceremony.
  // So the ring means "5 of 8 stories estimated", not merely "open / closed". A
  // session with no stories yet has nothing to roll up, so it falls back to its own
  // status, which is also what makes a closed-but-empty session read as complete.
  if (pokerIds.size > 0) {
    const rows = await db.select({ id: pokerSessions.id, name: pokerSessions.name, status: pokerSessions.status })
      .from(pokerSessions)
      .where(and(inArray(pokerSessions.id, [...pokerIds]), eq(pokerSessions.tenantId, tenantId)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const storyCounts = rows.length
      ? await db.select({
            sessionId: pokerStories.sessionId,
            total: sql<number>`count(*)::int`,
            estimated: sql<number>`count(*) filter (where ${pokerStories.finalEstimate} is not null)::int`,
          })
          .from(pokerStories)
          .where(and(inArray(pokerStories.sessionId, rows.map((r) => r.id)), eq(pokerStories.tenantId, tenantId)))
          .groupBy(pokerStories.sessionId)
      : [];
    const countsById = new Map(storyCounts.map((c) => [c.sessionId, { total: Number(c.total) || 0, done: Number(c.estimated) || 0 }]));
    for (const id of pokerIds) {
      const p = byId.get(id);
      if (!p) { out.set(key('poker', id), missingTicket('poker', id)); continue; }
      const c = countsById.get(id) ?? { total: 0, done: 0 };
      const closed = isCeremonySessionDone(p.status);
      const done = c.total > 0 ? c.done : (closed ? 1 : 0);
      const total = c.total > 0 ? c.total : (closed ? 1 : 0);
      const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;
      out.set(key('poker', id), { kind: 'poker', ref: id, label: p.name, status: p.status, progressPct, done, total, exists: true });
    }
  }

  return out;
}

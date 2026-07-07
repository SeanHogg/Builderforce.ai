/**
 * ChatTicketService — the single source of logic for tying Brain chats to work
 * items, computing a chat's ticket health, tracing chat↔ticket lineage, and
 * consolidating (merging) chats. The HTTP routes (brainRoutes) AND the built-in
 * MCP tools (builtinMcpService) both delegate here so the rules live ONCE (DRY).
 *
 * A "ticket" is any planning/project work item, addressed as (kind, ref):
 *   kind ∈ portfolio | objective | initiative | roadmap | spec | epic | gap | task
 *   ref  = tasks.id as text (epic/gap/task) OR a UUID
 *          (portfolio/objective/initiative/roadmap/spec)
 *
 * Health (% done) is derived from LIVE ticket state that mutates on the board
 * outside this service's write path, so it is deliberately NOT cached — a stale
 * ring would misreport progress. Every read is a small, bounded aggregate and
 * batched across a chat's links (≤ one query per tier, never N+1).
 */
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import {
  brainChats,
  brainChatMessages,
  chatTicketLinks,
  tasks,
  projects,
  objectives,
  keyResults,
  initiatives,
  portfolios,
  roadmapItems,
  specs,
} from '../../infrastructure/database/schema';
import { resolveSegment } from '../../infrastructure/auth/segmentResolver';
import { notSystemTask } from '../task/taskScope';
import { keyResultProgress, objectiveProgress } from '../pmo/portfolioRollup';
import { AgentAssignmentService } from '../agent/AgentAssignmentService';
import { resolveChatAccess } from './chatAccess';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

const CHAT_SCOPE = 'chat';

/** The work-item kinds a chat can be tied to (planning spine + roadmap + spec + gap). */
export const TICKET_KINDS = ['portfolio', 'objective', 'initiative', 'roadmap', 'spec', 'epic', 'gap', 'task'] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];

export type LinkType = 'linked' | 'created';

export interface TicketHealth {
  kind: TicketKind;
  ref: string;
  /** Display title/name; '(deleted)' when the target no longer resolves. */
  label: string;
  /** Raw status string of the work item (free-form for tasks). */
  status: string;
  /** 0–100 completion. Leaf task = done?100:0; container = completed/total. */
  progressPct: number;
  done: number;
  total: number;
  /** False when the referenced ticket no longer exists in the tenant. */
  exists: boolean;
}

export interface ChatTicketLink extends TicketHealth {
  linkId: number;
  linkType: LinkType;
  createdBy: string | null;
  createdAt: Date;
}

/** One typeahead hit — the minimal shape the link picker renders (ref + label). */
export interface TicketSearchHit {
  ref: string;
  label: string;
}

export interface LinkedChatRef {
  chatId: number;
  title: string;
  linkType: LinkType;
  projectId: number | null;
  createdAt: Date;
  updatedAt: Date;
  isArchived: boolean;
  mergedIntoChatId: number | null;
}

function isTicketKind(v: string): v is TicketKind {
  return (TICKET_KINDS as readonly string[]).includes(v);
}

/** Task/epic statuses that count as complete when a ticket has no completed_at. */
const DONE_STATUS = new Set(['done', 'completed', 'archived']);

/** Roadmap-item statuses that count as delivered ('shipped' is the publish marker). */
const ROADMAP_DONE = new Set(['shipped', 'done', 'complete', 'completed', 'released']);

export class ChatTicketService {
  private readonly assignments: AgentAssignmentService;

  constructor(private readonly db: Db, private readonly env: Env) {
    this.assignments = new AgentAssignmentService(db, env);
  }

  // ── ownership guards ──────────────────────────────────────────────────────

  /** A Brain chat the caller may ACCESS, scoped to the tenant. Delegates to the
   *  shared {@link resolveChatAccess} guard so team group chats and shared-visibility
   *  chats opened by a non-owner teammate resolve here EXACTLY as they do for the
   *  chat read/message endpoints — no more brainstorm-only / owner-only 404s on a
   *  chat the user can plainly open. Gateway-key callers pass null → tenant-wide
   *  access (matching the brain.* tools). */
  private async ownedChat(chatId: number, tenantId: number, userId: string | null) {
    return resolveChatAccess(this.db, {
      chatId, tenantId, userId,
      selectExtra: { projectId: brainChats.projectId },
    }) as Promise<{ id: number; ownerId: string | null; visibility: string; projectId: number | null } | null>;
  }

  // ── ticket resolution + health ────────────────────────────────────────────

  /** Verify a (kind, ref) resolves to a work item in this tenant. Returns its
   *  display label + status, or null when it does not exist / is cross-tenant. */
  async resolveTicket(tenantId: number, kind: string, ref: string): Promise<{ label: string; status: string } | null> {
    if (!isTicketKind(kind)) return null;
    if (kind === 'task' || kind === 'epic' || kind === 'gap') {
      const id = Number(ref);
      if (!Number.isInteger(id) || id <= 0) return null;
      const [row] = await this.db
        .select({ title: tasks.title, status: tasks.status })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .where(and(eq(tasks.id, id), eq(projects.tenantId, tenantId)))
        .limit(1);
      return row ? { label: row.title, status: row.status } : null;
    }
    // Roadmap items are a standalone product artifact (their own uuid-keyed table),
    // scoped by tenant — not part of the planning spine, so no segment filter.
    if (kind === 'roadmap') {
      const [row] = await this.db
        .select({ title: roadmapItems.title, status: roadmapItems.status })
        .from(roadmapItems)
        .where(and(eq(roadmapItems.id, ref), eq(roadmapItems.tenantId, tenantId)))
        .limit(1);
      return row ? { label: row.title, status: row.status } : null;
    }
    // Specs / PRDs — tenant-scoped product artifact (the goal is the label).
    if (kind === 'spec') {
      const [row] = await this.db
        .select({ goal: specs.goal, status: specs.status })
        .from(specs)
        .where(and(eq(specs.id, ref), eq(specs.tenantId, tenantId)))
        .limit(1);
      return row ? { label: row.goal, status: row.status } : null;
    }
    const seg = await resolveSegment(this.db, tenantId);
    if (kind === 'objective') {
      const [row] = await this.db.select({ title: objectives.title, status: objectives.status }).from(objectives)
        .where(and(eq(objectives.id, ref), eq(objectives.tenantId, tenantId), eq(objectives.segmentId, seg))).limit(1);
      return row ? { label: row.title, status: row.status } : null;
    }
    if (kind === 'initiative') {
      const [row] = await this.db.select({ name: initiatives.name, status: initiatives.status }).from(initiatives)
        .where(and(eq(initiatives.id, ref), eq(initiatives.tenantId, tenantId), eq(initiatives.segmentId, seg))).limit(1);
      return row ? { label: row.name, status: row.status } : null;
    }
    // portfolio
    const [row] = await this.db.select({ name: portfolios.name, status: portfolios.status }).from(portfolios)
      .where(and(eq(portfolios.id, ref), eq(portfolios.tenantId, tenantId), eq(portfolios.segmentId, seg))).limit(1);
    return row ? { label: row.name, status: row.status } : null;
  }

  /**
   * Server-side typeahead over a SINGLE ticket tier. Returns up to `limit`
   * (kind, ref) hits whose title / name / goal / key matches `query` (a
   * case-insensitive substring), most-recently-updated first. An empty query
   * returns the newest items so the picker has an initial page.
   *
   * This replaces the client's old "fetch EVERY ticket then filter in the DOM"
   * (which was both heavy AND incomplete once a list endpoint's 200-row cap hit)
   * with a bounded, indexed search — fast and complete on a 20k+ ticket tenant.
   * task/epic/gap/roadmap/spec honour the current project scope; the strategy
   * tiers (objective/initiative/portfolio) are segment-scoped tenant-wide, exactly
   * as the picker loaded them before.
   */
  async searchTickets(
    tenantId: number,
    kind: string,
    query: string,
    projectId: number | null,
    limit = 40,
  ): Promise<TicketSearchHit[]> {
    if (!isTicketKind(kind)) return [];
    const lim = Math.min(Math.max(Math.trunc(limit) || 40, 1), 50);
    const q = query.trim();
    // Escape LIKE metacharacters so a user's literal "%" / "_" / "\" isn't a wildcard.
    const like = q ? `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;

    if (kind === 'task' || kind === 'epic' || kind === 'gap') {
      const conds: SQL[] = [eq(projects.tenantId, tenantId), eq(tasks.archived, false), eq(tasks.taskType, kind), notSystemTask];
      if (projectId != null) conds.push(eq(tasks.projectId, projectId));
      if (like) conds.push(or(ilike(tasks.title, like), ilike(tasks.key, like))!);
      const rows = await this.db
        .select({ id: tasks.id, key: tasks.key, title: tasks.title })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .where(and(...conds))
        .orderBy(desc(tasks.updatedAt))
        .limit(lim);
      return rows.map((r) => ({ ref: String(r.id), label: r.key ? `${r.key} — ${r.title}` : r.title }));
    }

    if (kind === 'roadmap') {
      const conds: SQL[] = [eq(roadmapItems.tenantId, tenantId)];
      if (projectId != null) conds.push(eq(roadmapItems.projectId, projectId));
      if (like) conds.push(ilike(roadmapItems.title, like));
      const rows = await this.db.select({ id: roadmapItems.id, title: roadmapItems.title })
        .from(roadmapItems).where(and(...conds)).orderBy(desc(roadmapItems.updatedAt)).limit(lim);
      return rows.map((r) => ({ ref: r.id, label: r.title }));
    }

    if (kind === 'spec') {
      const conds: SQL[] = [eq(specs.tenantId, tenantId)];
      if (projectId != null) conds.push(eq(specs.projectId, projectId));
      if (like) conds.push(ilike(specs.goal, like));
      const rows = await this.db.select({ id: specs.id, goal: specs.goal })
        .from(specs).where(and(...conds)).orderBy(desc(specs.updatedAt)).limit(lim);
      return rows.map((r) => ({ ref: r.id, label: r.goal }));
    }

    // Strategy tiers — segment-scoped, tenant-wide (no project filter, matching the picker).
    const seg = await resolveSegment(this.db, tenantId);
    if (kind === 'objective') {
      const conds: SQL[] = [eq(objectives.tenantId, tenantId), eq(objectives.segmentId, seg)];
      if (like) conds.push(ilike(objectives.title, like));
      const rows = await this.db.select({ id: objectives.id, title: objectives.title })
        .from(objectives).where(and(...conds)).orderBy(desc(objectives.updatedAt)).limit(lim);
      return rows.map((r) => ({ ref: r.id, label: r.title }));
    }
    if (kind === 'initiative') {
      const conds: SQL[] = [eq(initiatives.tenantId, tenantId), eq(initiatives.segmentId, seg)];
      if (like) conds.push(ilike(initiatives.name, like));
      const rows = await this.db.select({ id: initiatives.id, name: initiatives.name })
        .from(initiatives).where(and(...conds)).orderBy(desc(initiatives.updatedAt)).limit(lim);
      return rows.map((r) => ({ ref: r.id, label: r.name }));
    }
    // portfolio
    const conds: SQL[] = [eq(portfolios.tenantId, tenantId), eq(portfolios.segmentId, seg)];
    if (like) conds.push(ilike(portfolios.name, like));
    const rows = await this.db.select({ id: portfolios.id, name: portfolios.name })
      .from(portfolios).where(and(...conds)).orderBy(desc(portfolios.updatedAt)).limit(lim);
    return rows.map((r) => ({ ref: r.id, label: r.name }));
  }

  /**
   * Batched health for a set of (kind, ref) targets — one aggregate query per
   * tier, so a chat with N linked tickets costs a constant handful of queries.
   */
  async ticketHealthBatch(tenantId: number, targets: Array<{ kind: string; ref: string }>): Promise<Map<string, TicketHealth>> {
    const out = new Map<string, TicketHealth>();
    const key = (k: string, r: string) => `${k}:${r}`;
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
    for (const t of clean) {
      if (t.kind === 'task') { const n = Number(t.ref); if (Number.isInteger(n)) taskIds.add(n); }
      else if (t.kind === 'epic') { const n = Number(t.ref); if (Number.isInteger(n)) epicIds.add(n); }
      else if (t.kind === 'gap') { const n = Number(t.ref); if (Number.isInteger(n)) gapIds.add(n); }
      else if (t.kind === 'objective') objIds.add(t.ref);
      else if (t.kind === 'initiative') initIds.add(t.ref);
      else if (t.kind === 'portfolio') pfIds.add(t.ref);
      else if (t.kind === 'roadmap') roadmapIds.add(t.ref);
      else if (t.kind === 'spec') specIds.add(t.ref);
    }

    // Tasks + epics + gaps share the tasks table: fetch self rows (title/status) for
    // all, plus child rollups for epics. Gaps are leaf work items (like tasks).
    const allTaskLike = [...taskIds, ...epicIds, ...gapIds];
    if (allTaskLike.length > 0) {
      const rows = await this.db
        .select({ id: tasks.id, title: tasks.title, status: tasks.status, completedAt: tasks.completedAt })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .where(and(inArray(tasks.id, allTaskLike), eq(projects.tenantId, tenantId)));
      const selfById = new Map(rows.map((r) => [r.id, r]));

      // Tasks and gaps are both leaf work items — identical health derivation.
      for (const kind of ['task', 'gap'] as const) {
        for (const id of kind === 'task' ? taskIds : gapIds) {
          const r = selfById.get(id);
          if (!r) { out.set(key(kind, String(id)), missing(kind, String(id))); continue; }
          const done = r.completedAt != null || DONE_STATUS.has(r.status) ? 1 : 0;
          out.set(key(kind, String(id)), {
            kind, ref: String(id), label: r.title, status: r.status,
            progressPct: done ? 100 : (r.status === 'in_progress' || r.status === 'in_review' ? 50 : 0),
            done, total: 1, exists: true,
          });
        }
      }

      if (epicIds.size > 0) {
        const childRows = await this.db
          .select({
            parentId: tasks.parentTaskId,
            total: sql<number>`count(*)`,
            done: sql<number>`count(${tasks.completedAt})`,
          })
          .from(tasks)
          .where(inArray(tasks.parentTaskId, [...epicIds]))
          .groupBy(tasks.parentTaskId);
        const childByParent = new Map(childRows.map((r) => [Number(r.parentId), { total: Number(r.total), done: Number(r.done) }]));
        for (const id of epicIds) {
          const r = selfById.get(id);
          if (!r) { out.set(key('epic', String(id)), missing('epic', String(id))); continue; }
          const c = childByParent.get(id) ?? { total: 0, done: 0 };
          const total = c.total;
          const done = c.done;
          const progressPct = total > 0 ? Math.round((done / total) * 100) : (r.completedAt != null || DONE_STATUS.has(r.status) ? 100 : 0);
          out.set(key('epic', String(id)), { kind: 'epic', ref: String(id), label: r.title, status: r.status, progressPct, done, total, exists: true });
        }
      }
    }

    if (objIds.size > 0) {
      const seg = await resolveSegment(this.db, tenantId);
      const objRows = await this.db.select({ id: objectives.id, title: objectives.title, status: objectives.status }).from(objectives)
        .where(and(inArray(objectives.id, [...objIds]), eq(objectives.tenantId, tenantId), eq(objectives.segmentId, seg)));
      const krRows = await this.db.select({
        objectiveId: keyResults.objectiveId, metricType: keyResults.metricType,
        startValue: keyResults.startValue, targetValue: keyResults.targetValue,
        currentValue: keyResults.currentValue, status: keyResults.status,
      }).from(keyResults).where(inArray(keyResults.objectiveId, [...objIds]));
      const krByObj = new Map<string, typeof krRows>();
      for (const kr of krRows) { const arr = krByObj.get(kr.objectiveId) ?? []; arr.push(kr); krByObj.set(kr.objectiveId, arr); }
      const objById = new Map(objRows.map((r) => [r.id, r]));
      for (const id of objIds) {
        const o = objById.get(id);
        if (!o) { out.set(key('objective', id), missing('objective', id)); continue; }
        const krs = krByObj.get(id) ?? [];
        const progresses = krs.map((kr) => keyResultProgress(kr));
        const progressPct = Math.round(objectiveProgress(progresses) * 100);
        const done = krs.filter((kr) => kr.status === 'done').length;
        out.set(key('objective', id), { kind: 'objective', ref: id, label: o.title, status: o.status, progressPct, done, total: krs.length, exists: true });
      }
    }

    if (initIds.size > 0) {
      const seg = await resolveSegment(this.db, tenantId);
      const initRows = await this.db.select({ id: initiatives.id, name: initiatives.name, status: initiatives.status }).from(initiatives)
        .where(and(inArray(initiatives.id, [...initIds]), eq(initiatives.tenantId, tenantId), eq(initiatives.segmentId, seg)));
      const rollup = await this.db.select({
        initiativeId: tasks.initiativeId,
        total: sql<number>`count(*)`,
        done: sql<number>`count(${tasks.completedAt})`,
      }).from(tasks).where(inArray(tasks.initiativeId, [...initIds])).groupBy(tasks.initiativeId);
      const byInit = new Map(rollup.map((r) => [String(r.initiativeId), { total: Number(r.total), done: Number(r.done) }]));
      const initById = new Map(initRows.map((r) => [r.id, r]));
      for (const id of initIds) {
        const i = initById.get(id);
        if (!i) { out.set(key('initiative', id), missing('initiative', id)); continue; }
        const c = byInit.get(id) ?? { total: 0, done: 0 };
        const progressPct = c.total > 0 ? Math.round((c.done / c.total) * 100) : 0;
        out.set(key('initiative', id), { kind: 'initiative', ref: id, label: i.name, status: i.status, progressPct, done: c.done, total: c.total, exists: true });
      }
    }

    if (pfIds.size > 0) {
      const seg = await resolveSegment(this.db, tenantId);
      const pfRows = await this.db.select({ id: portfolios.id, name: portfolios.name, status: portfolios.status }).from(portfolios)
        .where(and(inArray(portfolios.id, [...pfIds]), eq(portfolios.tenantId, tenantId), eq(portfolios.segmentId, seg)));
      const rollup = await this.db.select({
        portfolioId: initiatives.portfolioId,
        total: sql<number>`count(${tasks.id})`,
        done: sql<number>`count(${tasks.completedAt})`,
      }).from(tasks)
        .innerJoin(initiatives, eq(initiatives.id, tasks.initiativeId))
        .where(inArray(initiatives.portfolioId, [...pfIds]))
        .groupBy(initiatives.portfolioId);
      const byPf = new Map(rollup.map((r) => [String(r.portfolioId), { total: Number(r.total), done: Number(r.done) }]));
      const pfById = new Map(pfRows.map((r) => [r.id, r]));
      for (const id of pfIds) {
        const p = pfById.get(id);
        if (!p) { out.set(key('portfolio', id), missing('portfolio', id)); continue; }
        const c = byPf.get(id) ?? { total: 0, done: 0 };
        const progressPct = c.total > 0 ? Math.round((c.done / c.total) * 100) : 0;
        out.set(key('portfolio', id), { kind: 'portfolio', ref: id, label: p.name, status: p.status, progressPct, done: c.done, total: c.total, exists: true });
      }
    }

    if (roadmapIds.size > 0) {
      const rmRows = await this.db.select({ id: roadmapItems.id, title: roadmapItems.title, status: roadmapItems.status })
        .from(roadmapItems)
        .where(and(inArray(roadmapItems.id, [...roadmapIds]), eq(roadmapItems.tenantId, tenantId)));
      const rmById = new Map(rmRows.map((r) => [r.id, r]));
      for (const id of roadmapIds) {
        const r = rmById.get(id);
        if (!r) { out.set(key('roadmap', id), missing('roadmap', id)); continue; }
        // A roadmap item has no child rollup — derive progress from its own status.
        const s = (r.status ?? '').toLowerCase();
        const done = ROADMAP_DONE.has(s) ? 1 : 0;
        const progressPct = done ? 100 : (s === 'in_progress' || s === 'active' ? 50 : 0);
        out.set(key('roadmap', id), { kind: 'roadmap', ref: id, label: r.title, status: r.status, progressPct, done, total: done ? 1 : 0, exists: true });
      }
    }

    if (specIds.size > 0) {
      const specRows = await this.db.select({ id: specs.id, goal: specs.goal, status: specs.status })
        .from(specs)
        .where(and(inArray(specs.id, [...specIds]), eq(specs.tenantId, tenantId)));
      const specById = new Map(specRows.map((r) => [r.id, r]));
      for (const id of specIds) {
        const s = specById.get(id);
        if (!s) { out.set(key('spec', id), missing('spec', id)); continue; }
        // A spec has no child rollup — derive progress from its own lifecycle status.
        const st = (s.status ?? '').toLowerCase();
        const done = st === 'complete' ? 1 : 0;
        const progressPct = done ? 100 : (st === 'in_progress' || st === 'ready' ? 50 : 0);
        out.set(key('spec', id), { kind: 'spec', ref: id, label: s.goal, status: s.status, progressPct, done, total: done ? 1 : 0, exists: true });
      }
    }

    return out;
  }

  // ── chat message history (so an agent can "review the chat history") ───────

  /** A chat's message transcript (role/content/seq), tenant/user-scoped through
   *  the same ownership guard. Lets the Brain read a conversation before deciding
   *  what to merge/consolidate — the missing half of "review the chat history". */
  async listMessages(
    tenantId: number, chatId: number, userId: string | null, limit = 200,
  ): Promise<{ error: string } | Array<{ role: string; content: string; seq: number; createdAt: Date }>> {
    const chat = await this.ownedChat(chatId, tenantId, userId);
    if (!chat) return { error: 'Chat not found' };
    return this.db
      .select({ role: brainChatMessages.role, content: brainChatMessages.content, seq: brainChatMessages.seq, createdAt: brainChatMessages.createdAt })
      .from(brainChatMessages)
      .where(eq(brainChatMessages.chatId, chatId))
      .orderBy(brainChatMessages.seq)
      .limit(Math.min(limit, 500));
  }

  // ── links (forward: chat → tickets) ───────────────────────────────────────

  /** Tickets a chat is tied to, each with live health. */
  async listTicketsForChat(tenantId: number, chatId: number, userId: string | null): Promise<{ error: string } | ChatTicketLink[]> {
    const chat = await this.ownedChat(chatId, tenantId, userId);
    if (!chat) return { error: 'Chat not found' };
    const links = await this.db.select().from(chatTicketLinks)
      .where(and(eq(chatTicketLinks.tenantId, tenantId), eq(chatTicketLinks.chatId, chatId)))
      .orderBy(chatTicketLinks.createdAt);
    if (links.length === 0) return [];
    const health = await this.ticketHealthBatch(tenantId, links.map((l) => ({ kind: l.ticketKind, ref: l.ticketRef })));
    return links.map((l) => {
      const h = health.get(`${l.ticketKind}:${l.ticketRef}`) ?? missing(l.ticketKind as TicketKind, l.ticketRef);
      return { ...h, linkId: l.id, linkType: l.linkType as LinkType, createdBy: l.createdBy, createdAt: l.createdAt };
    });
  }

  /** Link a chat to a ticket (idempotent — re-links update link_type). */
  async linkTicket(
    tenantId: number, chatId: number, userId: string | null,
    input: { kind: string; ref: string; linkType?: LinkType; createdBy?: string | null },
  ): Promise<{ error: string } | ChatTicketLink> {
    const chat = await this.ownedChat(chatId, tenantId, userId);
    if (!chat) return { error: 'Chat not found' };
    if (!isTicketKind(input.kind)) return { error: 'Invalid ticket kind' };
    const resolved = await this.resolveTicket(tenantId, input.kind, input.ref);
    if (!resolved) return { error: 'Ticket not found in tenant' };

    const seg = await resolveSegment(this.db, tenantId);
    const linkType: LinkType = input.linkType === 'created' ? 'created' : 'linked';
    const [existing] = await this.db.select({ id: chatTicketLinks.id }).from(chatTicketLinks)
      .where(and(eq(chatTicketLinks.chatId, chatId), eq(chatTicketLinks.ticketKind, input.kind), eq(chatTicketLinks.ticketRef, input.ref))).limit(1);

    let row;
    if (existing) {
      [row] = await this.db.update(chatTicketLinks).set({ linkType }).where(eq(chatTicketLinks.id, existing.id)).returning();
    } else {
      [row] = await this.db.insert(chatTicketLinks).values({
        tenantId, segmentId: seg, chatId, ticketKind: input.kind, ticketRef: input.ref,
        linkType, createdBy: input.createdBy ?? userId ?? null,
      }).returning();
    }
    const health = await this.ticketHealthBatch(tenantId, [{ kind: input.kind, ref: input.ref }]);
    const h = health.get(`${input.kind}:${input.ref}`)!;
    return { ...h, linkId: row!.id, linkType: row!.linkType as LinkType, createdBy: row!.createdBy, createdAt: row!.createdAt };
  }

  /** Remove a chat↔ticket link (by kind+ref). */
  async unlinkTicket(tenantId: number, chatId: number, userId: string | null, kind: string, ref: string): Promise<{ error: string } | { removed: boolean }> {
    const chat = await this.ownedChat(chatId, tenantId, userId);
    if (!chat) return { error: 'Chat not found' };
    const rows = await this.db.delete(chatTicketLinks)
      .where(and(eq(chatTicketLinks.tenantId, tenantId), eq(chatTicketLinks.chatId, chatId), eq(chatTicketLinks.ticketKind, kind), eq(chatTicketLinks.ticketRef, ref)))
      .returning({ id: chatTicketLinks.id });
    return { removed: rows.length > 0 };
  }

  // ── lineage (reverse: ticket → chats) ─────────────────────────────────────

  /** Chats that reference a ticket — the lineage view (which conversations shaped
   *  this work item, and which SPAWNED it via link_type='created'). */
  async listChatsForTicket(tenantId: number, kind: string, ref: string): Promise<LinkedChatRef[]> {
    if (!isTicketKind(kind)) return [];
    const rows = await this.db
      .select({
        chatId: brainChats.id, title: brainChats.title, projectId: brainChats.projectId,
        isArchived: brainChats.isArchived, mergedIntoChatId: brainChats.mergedIntoChatId,
        createdAt: brainChats.createdAt, updatedAt: brainChats.updatedAt,
        linkType: chatTicketLinks.linkType,
      })
      .from(chatTicketLinks)
      .innerJoin(brainChats, eq(brainChats.id, chatTicketLinks.chatId))
      .where(and(eq(chatTicketLinks.tenantId, tenantId), eq(chatTicketLinks.ticketKind, kind), eq(chatTicketLinks.ticketRef, ref)))
      .orderBy(chatTicketLinks.createdAt);
    return rows.map((r) => ({
      chatId: r.chatId, title: r.title, linkType: r.linkType as LinkType, projectId: r.projectId,
      createdAt: r.createdAt, updatedAt: r.updatedAt, isArchived: r.isArchived, mergedIntoChatId: r.mergedIntoChatId,
    }));
  }

  // ── consolidation (merge chats into one) ──────────────────────────────────

  /**
   * Merge source chats into a target: source messages are appended to the target
   * in chronological order, their ticket links + agent invites move to the target,
   * then each source is archived and stamped with merged_into_chat_id so the
   * lineage survives and any ticket resolves to the one surviving conversation.
   */
  async consolidate(
    tenantId: number, userId: string | null,
    input: { targetChatId: number; sourceChatIds: number[] },
  ): Promise<{ error: string } | { targetChatId: number; mergedChats: number; messagesMoved: number; linksMoved: number }> {
    const target = await this.ownedChat(input.targetChatId, tenantId, userId);
    if (!target) return { error: 'Target chat not found' };
    const sources = [...new Set(input.sourceChatIds)].filter((id) => id !== input.targetChatId);
    if (sources.length === 0) return { error: 'No source chats to merge' };

    // Verify every source belongs to the tenant/user before mutating anything.
    for (const sid of sources) {
      const owned = await this.ownedChat(sid, tenantId, userId);
      if (!owned) return { error: `Source chat ${sid} not found` };
    }

    // Current max seq on the target, so appended messages continue the sequence.
    const [maxRow] = await this.db
      .select({ maxSeq: sql<number>`COALESCE(MAX(${brainChatMessages.seq}), 0)` })
      .from(brainChatMessages).where(eq(brainChatMessages.chatId, input.targetChatId));
    let seq = Number(maxRow?.maxSeq ?? 0);

    // Gather source messages, ordered chronologically across all sources.
    const srcMsgs = await this.db
      .select({ role: brainChatMessages.role, content: brainChatMessages.content, metadata: brainChatMessages.metadata, createdAt: brainChatMessages.createdAt, seq: brainChatMessages.seq })
      .from(brainChatMessages)
      .where(inArray(brainChatMessages.chatId, sources))
      .orderBy(brainChatMessages.createdAt, brainChatMessages.seq);

    let messagesMoved = 0;
    for (const m of srcMsgs) {
      seq += 1;
      await this.db.insert(brainChatMessages).values({
        chatId: input.targetChatId, role: m.role, content: m.content, metadata: m.metadata, seq,
      });
      messagesMoved += 1;
    }

    // Move ticket links to the target (skip ones already present on the target).
    const srcLinks = await this.db.select().from(chatTicketLinks)
      .where(and(eq(chatTicketLinks.tenantId, tenantId), inArray(chatTicketLinks.chatId, sources)));
    const [targetLinksRows] = [await this.db.select({ kind: chatTicketLinks.ticketKind, ref: chatTicketLinks.ticketRef }).from(chatTicketLinks).where(eq(chatTicketLinks.chatId, input.targetChatId))];
    const targetHas = new Set(targetLinksRows.map((l) => `${l.kind}:${l.ref}`));
    const seg = await resolveSegment(this.db, tenantId);
    let linksMoved = 0;
    for (const l of srcLinks) {
      if (targetHas.has(`${l.ticketKind}:${l.ticketRef}`)) continue;
      await this.db.insert(chatTicketLinks).values({
        tenantId, segmentId: seg, chatId: input.targetChatId, ticketKind: l.ticketKind, ticketRef: l.ticketRef,
        linkType: l.linkType, createdBy: l.createdBy,
      });
      targetHas.add(`${l.ticketKind}:${l.ticketRef}`);
      linksMoved += 1;
    }
    // Drop the source links (their chats are about to be archived/redirected).
    await this.db.delete(chatTicketLinks).where(and(eq(chatTicketLinks.tenantId, tenantId), inArray(chatTicketLinks.chatId, sources)));

    // Re-point any chat-scoped agent invites from the sources onto the target.
    for (const sid of sources) {
      const invites = await this.assignments.list(tenantId, CHAT_SCOPE, String(sid));
      for (const inv of invites) {
        await this.assignments.assign(tenantId, { agentKind: inv.agentKind, agentRef: inv.agentRef, scope: CHAT_SCOPE, scopeId: String(input.targetChatId), role: inv.role });
        await this.assignments.unassign(tenantId, inv.id);
      }
    }

    // Archive + redirect each source; touch the target.
    await this.db.update(brainChats)
      .set({ isArchived: true, mergedIntoChatId: input.targetChatId, updatedAt: new Date() })
      .where(and(eq(brainChats.tenantId, tenantId), inArray(brainChats.id, sources)));
    await this.db.update(brainChats).set({ updatedAt: new Date() }).where(eq(brainChats.id, input.targetChatId));

    return { targetChatId: input.targetChatId, mergedChats: sources.length, messagesMoved, linksMoved };
  }

  // ── agent invites into a chat (reuse agent_assignments, scope='chat') ──────

  async listAgents(tenantId: number, chatId: number, userId: string | null) {
    const chat = await this.ownedChat(chatId, tenantId, userId);
    if (!chat) return { error: 'Chat not found' as const };
    return this.assignments.list(tenantId, CHAT_SCOPE, String(chatId));
  }

  async inviteAgent(tenantId: number, chatId: number, userId: string | null, input: { agentKind?: string; agentRef: string; role?: string }) {
    const chat = await this.ownedChat(chatId, tenantId, userId);
    if (!chat) return { error: 'Chat not found' as const };
    if (!input.agentRef) return { error: 'agentRef is required' as const };
    return this.assignments.assign(tenantId, {
      agentKind: input.agentKind || 'workforce', agentRef: input.agentRef,
      scope: CHAT_SCOPE, scopeId: String(chatId), role: input.role || 'participant',
    });
  }

  async removeAgent(tenantId: number, chatId: number, userId: string | null, assignmentId: string) {
    const chat = await this.ownedChat(chatId, tenantId, userId);
    if (!chat) return { error: 'Chat not found' as const };
    const ok = await this.assignments.unassign(tenantId, assignmentId);
    return { removed: ok };
  }
}

function missing(kind: TicketKind, ref: string): TicketHealth {
  return { kind, ref, label: '(deleted)', status: 'unknown', progressPct: 0, done: 0, total: 0, exists: false };
}

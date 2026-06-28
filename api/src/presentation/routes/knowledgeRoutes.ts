/**
 * Knowledge Management — SOPs, processes & documents (migration 0227).
 *
 * Team-authored knowledge with versioning, tagging, read-acknowledgement
 * (audit evidence for SOX/TISAX/ISO), training assignments with due dates, and
 * AI-assisted authoring via the shared LLM gateway. Tenant + segment scoped;
 * optionally project scoped (null = workspace-wide).
 *
 * Reads are served through the read-through cache keyed by a per-tenant version
 * token; every write bumps the token so the next read recomputes.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { and, eq, desc, inArray, sql } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole, hasMinRole } from '../../domain/shared/types';
import {
  knowledgeDocuments,
  knowledgeDocumentVersions,
  knowledgeDocumentTags,
  knowledgeAcknowledgements,
  knowledgeTrainingAssignments,
  knowledgeDocumentCollaborators,
  marketplaceKnowledge,
  tenantMembers,
  users,
} from '../../infrastructure/database/schema';
import {
  getOrSetCached,
  getCacheVersion,
  bumpCacheVersion,
} from '../../infrastructure/cache/readThroughCache';
import { ideProxy, newTraceId } from '../../application/llm/LlmProxyService';
import { logTrace } from '../../application/llm/traceLogger';
import {
  notifyCollaboratorInvited,
  notifyTrainingAssigned,
  type KnowledgeNotifierEnv,
} from '../../application/knowledge/knowledgeNotifier';
import { STANDARD_LIBRARY, standardItem, computeCoverage } from '../../application/knowledge/standardLibrary';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const DOC_TYPES = ['sop', 'process', 'doc'] as const;
type DocType = (typeof DOC_TYPES)[number];
const STATUSES = ['draft', 'published', 'archived'] as const;

function knowledgeVersionKey(tenantId: number): string {
  return `knowledge:${tenantId}`;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested) — compliance / training rollups.
// ---------------------------------------------------------------------------

export interface MemberLite {
  userId: string;
  name: string;
  email: string;
}
export interface AckLite {
  userId: string;
  versionNumber: number;
  acknowledgedAt: string;
}
export interface TrainingLite {
  userId: string;
  dueAt: string | null;
}

export type ComplianceState = 'acknowledged' | 'pending' | 'overdue' | 'not_required';

export interface ComplianceRow {
  userId: string;
  name: string;
  email: string;
  state: ComplianceState;
  acknowledgedVersion: number | null;
  acknowledgedAt: string | null;
  dueAt: string | null;
}

export interface ComplianceSummary {
  required: number;
  acknowledged: number;
  pending: number;
  overdue: number;
  /** 0..100, share of required readers who have acknowledged the current version. */
  percent: number;
}

/**
 * Per-document compliance: for each required reader, is their acknowledgement of
 * the CURRENT published version present, still pending, or overdue (assigned with
 * a due date that has passed)?
 *
 * A reader is "required" when the doc requires acknowledgement (every active
 * member) OR the reader has an explicit training assignment for the doc.
 */
export function buildDocCompliance(input: {
  members: MemberLite[];
  acks: AckLite[];
  training: TrainingLite[];
  currentVersion: number;
  requiresAck: boolean;
  nowMs: number;
}): { rows: ComplianceRow[]; summary: ComplianceSummary } {
  const { members, acks, training, currentVersion, requiresAck, nowMs } = input;
  const ackByUser = new Map(acks.map((a) => [a.userId, a]));
  const dueByUser = new Map(training.map((t) => [t.userId, t.dueAt]));
  const memberById = new Map(members.map((m) => [m.userId, m]));

  // Required set = all members (when requiresAck) ∪ explicitly assigned users.
  const requiredIds = new Set<string>();
  if (requiresAck) for (const m of members) requiredIds.add(m.userId);
  for (const t of training) requiredIds.add(t.userId);

  const rows: ComplianceRow[] = [];
  let acknowledged = 0;
  let overdue = 0;

  for (const userId of requiredIds) {
    const m = memberById.get(userId) ?? { userId, name: userId, email: '' };
    const ack = ackByUser.get(userId);
    const dueAt = dueByUser.get(userId) ?? null;
    const hasCurrent = !!ack && ack.versionNumber >= currentVersion && currentVersion > 0;
    let state: ComplianceState;
    if (hasCurrent) {
      state = 'acknowledged';
      acknowledged++;
    } else if (dueAt && Date.parse(dueAt) < nowMs) {
      state = 'overdue';
      overdue++;
    } else {
      state = 'pending';
    }
    rows.push({
      userId,
      name: m.name,
      email: m.email,
      state,
      acknowledgedVersion: ack?.versionNumber ?? null,
      acknowledgedAt: hasCurrent ? (ack?.acknowledgedAt ?? null) : null,
      dueAt,
    });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));
  const required = requiredIds.size;
  const pending = required - acknowledged;
  const percent = required === 0 ? 100 : Math.round((acknowledged / required) * 100);
  return { rows, summary: { required, acknowledged, pending, overdue, percent } };
}

export type DocAccess = 'manager' | 'editor' | 'viewer' | 'none';

/**
 * A user's effective access to a single document. Workspace managers always
 * have full access; the document creator and invited 'editor' collaborators can
 * co-edit; invited 'viewer' collaborators are explicitly associated for
 * awareness; everyone else falls back to tenant-level read ('none').
 */
export function resolveAccess(opts: {
  role: TenantRole;
  isCreator: boolean;
  collabRole: string | null;
}): DocAccess {
  if (hasMinRole(opts.role, TenantRole.MANAGER)) return 'manager';
  if (opts.isCreator || opts.collabRole === 'editor') return 'editor';
  if (opts.collabRole === 'viewer') return 'viewer';
  return 'none';
}

export function canEditAccess(access: DocAccess): boolean {
  return access === 'manager' || access === 'editor';
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function createKnowledgeRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  /** Load active tenant members (id, name, email) for compliance rollups. */
  async function loadMembers(tenantId: number): Promise<MemberLite[]> {
    const rows = await db
      .select({
        userId: tenantMembers.userId,
        displayName: users.displayName,
        email: users.email,
      })
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.userId))
      .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.isActive, true)));
    return rows.map((r) => ({
      userId: r.userId,
      name: r.displayName?.trim() || r.email,
      email: r.email,
    }));
  }

  /** Fetch a tenant-scoped document or null (IDOR guard). */
  async function loadDoc(tenantId: number, id: string) {
    const [doc] = await db
      .select()
      .from(knowledgeDocuments)
      .where(and(eq(knowledgeDocuments.id, id), eq(knowledgeDocuments.tenantId, tenantId)));
    return doc ?? null;
  }

  /** The current user's collaborator role on a document, or null. */
  async function loadCollabRole(documentId: string, userId: string): Promise<string | null> {
    const [row] = await db
      .select({ role: knowledgeDocumentCollaborators.role })
      .from(knowledgeDocumentCollaborators)
      .where(
        and(
          eq(knowledgeDocumentCollaborators.documentId, documentId),
          eq(knowledgeDocumentCollaborators.userId, userId),
        ),
      );
    return row?.role ?? null;
  }

  /** Resolve the caller's effective access to a document. */
  async function accessFor(c: Context<HonoEnv>, doc: { id: string; createdBy: string | null }): Promise<DocAccess> {
    const role = c.get('role') as TenantRole;
    const userId = c.get('userId') as string;
    if (hasMinRole(role, TenantRole.MANAGER)) return 'manager';
    const collabRole = doc.createdBy === userId ? null : await loadCollabRole(doc.id, userId);
    return resolveAccess({ role, isCreator: doc.createdBy === userId, collabRole });
  }

  async function tagsFor(documentIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (documentIds.length === 0) return map;
    const rows = await db
      .select({ documentId: knowledgeDocumentTags.documentId, tag: knowledgeDocumentTags.tag })
      .from(knowledgeDocumentTags)
      .where(inArray(knowledgeDocumentTags.documentId, documentIds));
    for (const r of rows) {
      const list = map.get(r.documentId) ?? [];
      list.push(r.tag);
      map.set(r.documentId, list);
    }
    return map;
  }

  // ---- LIST -------------------------------------------------------------
  router.get('/documents', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const env = c.env as Env;
    const type = c.req.query('type');
    const status = c.req.query('status');
    const projectQ = c.req.query('project');
    const tag = c.req.query('tag');
    const q = c.req.query('q')?.trim().toLowerCase();

    const ver = await getCacheVersion(env, knowledgeVersionKey(tenantId));
    const key = `knowledge:list:${tenantId}:v:${ver}:${type ?? ''}:${status ?? ''}:${projectQ ?? ''}:${tag ?? ''}:${q ?? ''}`;

    const payload = await getOrSetCached(env, key, async () => {
      const conds = [eq(knowledgeDocuments.tenantId, tenantId)];
      if (type && (DOC_TYPES as readonly string[]).includes(type)) {
        conds.push(eq(knowledgeDocuments.docType, type));
      }
      if (status && (STATUSES as readonly string[]).includes(status)) {
        conds.push(eq(knowledgeDocuments.status, status));
      }
      if (projectQ && Number.isFinite(Number(projectQ))) {
        conds.push(eq(knowledgeDocuments.projectId, Number(projectQ)));
      }
      const docs = await db
        .select()
        .from(knowledgeDocuments)
        .where(and(...conds))
        .orderBy(desc(knowledgeDocuments.updatedAt));

      const tagMap = await tagsFor(docs.map((d) => d.id));
      let enriched = docs.map((d) => ({ ...d, tags: tagMap.get(d.id) ?? [] }));
      if (tag) enriched = enriched.filter((d) => d.tags.includes(tag));
      if (q) {
        enriched = enriched.filter(
          (d) =>
            d.title.toLowerCase().includes(q) ||
            (d.summary ?? '').toLowerCase().includes(q),
        );
      }
      return { documents: enriched };
    }, { kvTtlSeconds: 120, l1TtlMs: 30_000 });

    return c.json(payload);
  });

  // ---- DISTINCT TAGS (filter UI) ---------------------------------------
  router.get('/tags', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const env = c.env as Env;
    const ver = await getCacheVersion(env, knowledgeVersionKey(tenantId));
    const tags = await getOrSetCached(env, `knowledge:tags:${tenantId}:v:${ver}`, async () => {
      const rows = await db
        .selectDistinct({ tag: knowledgeDocumentTags.tag })
        .from(knowledgeDocumentTags)
        .where(eq(knowledgeDocumentTags.tenantId, tenantId));
      return rows.map((r) => r.tag).sort((a, b) => a.localeCompare(b));
    }, { kvTtlSeconds: 300 });
    return c.json({ tags });
  });

  // ---- KNOWLEDGE OVERVIEW (dashboard graphs + gap analysis) -------------
  // The unified Knowledge home: how much knowledge exists, by type, how fresh
  // it is, and — measured against the curated standard library — what coverage
  // the team has and which standard SOPs/processes are still missing. The
  // standardLibrary doubles as the template catalogue (present flag per item).
  const STALE_DAYS = 90;
  router.get('/overview', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const env = c.env as Env;
    const ver = await getCacheVersion(env, knowledgeVersionKey(tenantId));
    const payload = await getOrSetCached(env, `knowledge:overview:${tenantId}:v:${ver}`, async () => {
      const docs = await db
        .select()
        .from(knowledgeDocuments)
        .where(eq(knowledgeDocuments.tenantId, tenantId));
      const tagMap = await tagsFor(docs.map((d) => d.id));

      const counts: Record<string, number> = { total: docs.length, sop: 0, process: 0, doc: 0, published: 0, draft: 0, archived: 0, requiresAck: 0 };
      const staleMs = STALE_DAYS * 24 * 60 * 60 * 1000;
      const nowMs = Date.now();
      let stale = 0;
      const liteDocs = docs.map((d) => {
        counts[d.docType] = (counts[d.docType] ?? 0) + 1;
        counts[d.status] = (counts[d.status] ?? 0) + 1;
        if (d.requiresAck) counts.requiresAck = (counts.requiresAck ?? 0) + 1;
        const updated = d.updatedAt instanceof Date ? d.updatedAt.getTime() : new Date(d.updatedAt).getTime();
        if (d.status === 'published' && nowMs - updated > staleMs) stale += 1;
        return { title: d.title, summary: d.summary, tags: tagMap.get(d.id) ?? [] };
      });

      const coverage = computeCoverage(liteDocs);
      // Missing standard items become actionable "create from template" gaps.
      const gaps = coverage.items.filter((i) => !i.present);
      // Full catalogue for the template gallery (present flag included).
      const templates = STANDARD_LIBRARY.map((t) => {
        const item = coverage.items.find((i) => i.key === t.key);
        return { key: t.key, title: t.title, docType: t.docType, summary: t.summary, tags: t.tags, present: item?.present ?? false };
      });

      return {
        counts,
        stale,
        staleDays: STALE_DAYS,
        coverage: { score: coverage.score, present: coverage.present, total: coverage.total },
        gaps,
        templates,
      };
    }, { kvTtlSeconds: 60, l1TtlMs: 30_000 });

    return c.json(payload);
  });

  // ---- DETAIL -----------------------------------------------------------
  router.get('/documents/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const doc = await loadDoc(tenantId, id);
    if (!doc) return c.json({ error: 'Document not found' }, 404);

    const [tagMap, [myAck], versionCount] = await Promise.all([
      tagsFor([id]),
      db
        .select()
        .from(knowledgeAcknowledgements)
        .where(and(eq(knowledgeAcknowledgements.documentId, id), eq(knowledgeAcknowledgements.userId, userId))),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(knowledgeDocumentVersions)
        .where(eq(knowledgeDocumentVersions.documentId, id)),
    ]);

    const acknowledgedCurrent =
      !!myAck && doc.versionNumber > 0 && myAck.versionNumber >= doc.versionNumber;
    const myAccess = await accessFor(c, doc);

    return c.json({
      ...doc,
      tags: tagMap.get(id) ?? [],
      myAccess,
      canEdit: canEditAccess(myAccess),
      myAcknowledgement: myAck
        ? { versionNumber: myAck.versionNumber, acknowledgedAt: myAck.acknowledgedAt, current: acknowledgedCurrent }
        : null,
      versionCount: versionCount[0]?.n ?? 0,
    });
  });

  // ---- CREATE -----------------------------------------------------------
  // Any team member (developer+) can author knowledge; the creator becomes the
  // document owner (implicit editor) and can invite collaborators to the page.
  router.post('/documents', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const segmentId = (c.get('segmentId') as string | undefined) ?? null;
    const body = await c.req.json<{
      title?: string;
      summary?: string;
      content?: string;
      docType?: DocType;
      projectId?: number | null;
      requiresAck?: boolean;
      tags?: string[];
      /** Start from a curated standard-library template (fills title/content/docType/tags). */
      templateKey?: string;
    }>();

    // A template seeds defaults; explicit request fields still win. With the
    // create-modal gone, an untitled draft is valid — the editor renames inline.
    const tmpl = body.templateKey ? standardItem(body.templateKey) : undefined;
    const title = body.title?.trim() || tmpl?.title || 'Untitled document';
    const docType: DocType = (DOC_TYPES as readonly string[]).includes(body.docType ?? '')
      ? (body.docType as DocType)
      : (tmpl?.docType ?? 'doc');

    const [doc] = await db
      .insert(knowledgeDocuments)
      .values({
        tenantId,
        segmentId,
        projectId: body.projectId ?? null,
        docType,
        title,
        summary: body.summary?.trim() || tmpl?.summary || null,
        content: body.content ?? tmpl?.starter ?? '',
        requiresAck: body.requiresAck ?? false,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    if (!doc) return c.json({ error: 'Failed to create document' }, 500);

    const tags = normaliseTags(body.tags ?? tmpl?.tags);
    if (tags.length) {
      await db.insert(knowledgeDocumentTags).values(
        tags.map((tag) => ({ tenantId, documentId: doc.id, tag })),
      );
    }

    await bumpCacheVersion(c.env as Env, knowledgeVersionKey(tenantId));
    return c.json({ ...doc, tags }, 201);
  });

  // ---- UPDATE -----------------------------------------------------------
  router.patch('/documents/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const body = await c.req.json<{
      title?: string;
      summary?: string | null;
      content?: string;
      docType?: DocType;
      projectId?: number | null;
      requiresAck?: boolean;
      status?: 'draft' | 'published' | 'archived';
    }>();

    const doc = await loadDoc(tenantId, id);
    if (!doc) return c.json({ error: 'Document not found' }, 404);
    if (!canEditAccess(await accessFor(c, doc))) return c.json({ error: 'You do not have edit access to this document' }, 403);

    await db
      .update(knowledgeDocuments)
      .set({
        ...(body.title !== undefined ? { title: body.title.trim() } : {}),
        ...(body.summary !== undefined ? { summary: body.summary?.trim() || null } : {}),
        ...(body.content !== undefined ? { content: body.content } : {}),
        ...(body.docType && (DOC_TYPES as readonly string[]).includes(body.docType) ? { docType: body.docType } : {}),
        ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
        ...(body.requiresAck !== undefined ? { requiresAck: body.requiresAck } : {}),
        ...(body.status === 'archived' || body.status === 'draft' ? { status: body.status } : {}),
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(and(eq(knowledgeDocuments.id, id), eq(knowledgeDocuments.tenantId, tenantId)));

    await bumpCacheVersion(c.env as Env, knowledgeVersionKey(tenantId));
    return c.json(await loadDoc(tenantId, id));
  });

  // ---- DELETE -----------------------------------------------------------
  // Deletion is restricted to workspace managers or the document creator —
  // invited editors can change content but not destroy the page.
  router.delete('/documents/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const role = c.get('role') as TenantRole;
    const id = c.req.param('id');
    const doc = await loadDoc(tenantId, id);
    if (!doc) return c.json({ error: 'Document not found' }, 404);
    if (!hasMinRole(role, TenantRole.MANAGER) && doc.createdBy !== userId) {
      return c.json({ error: 'Only a manager or the creator can delete this document' }, 403);
    }
    await db
      .delete(knowledgeDocuments)
      .where(and(eq(knowledgeDocuments.id, id), eq(knowledgeDocuments.tenantId, tenantId)));
    await bumpCacheVersion(c.env as Env, knowledgeVersionKey(tenantId));
    return c.body(null, 204);
  });

  // ---- PUBLISH (snapshot a new immutable version) -----------------------
  router.post('/documents/:id/publish', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const body = await c.req.json<{ changeNote?: string }>().catch(() => ({} as { changeNote?: string }));

    const doc = await loadDoc(tenantId, id);
    if (!doc) return c.json({ error: 'Document not found' }, 404);
    if (!canEditAccess(await accessFor(c, doc))) return c.json({ error: 'You do not have edit access to this document' }, 403);

    const nextVersion = doc.versionNumber + 1;
    const now = new Date();
    await db.insert(knowledgeDocumentVersions).values({
      tenantId,
      documentId: id,
      versionNumber: nextVersion,
      title: doc.title,
      content: doc.content,
      changeNote: body.changeNote?.trim() || null,
      publishedBy: userId,
    });
    await db
      .update(knowledgeDocuments)
      .set({ status: 'published', versionNumber: nextVersion, publishedAt: now, updatedBy: userId, updatedAt: now })
      .where(and(eq(knowledgeDocuments.id, id), eq(knowledgeDocuments.tenantId, tenantId)));

    await bumpCacheVersion(c.env as Env, knowledgeVersionKey(tenantId));
    return c.json(await loadDoc(tenantId, id));
  });

  // ---- VERSION HISTORY --------------------------------------------------
  router.get('/documents/:id/versions', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const doc = await loadDoc(tenantId, id);
    if (!doc) return c.json({ error: 'Document not found' }, 404);
    const versions = await db
      .select()
      .from(knowledgeDocumentVersions)
      .where(eq(knowledgeDocumentVersions.documentId, id))
      .orderBy(desc(knowledgeDocumentVersions.versionNumber));
    return c.json({ versions });
  });

  // ---- ACKNOWLEDGE (audit evidence) ------------------------------------
  router.post('/documents/:id/acknowledge', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const doc = await loadDoc(tenantId, id);
    if (!doc) return c.json({ error: 'Document not found' }, 404);
    if (doc.status !== 'published' || doc.versionNumber < 1) {
      return c.json({ error: 'Only published documents can be acknowledged' }, 400);
    }

    const now = new Date();
    await db
      .insert(knowledgeAcknowledgements)
      .values({ tenantId, documentId: id, userId, versionNumber: doc.versionNumber, acknowledgedAt: now })
      .onConflictDoUpdate({
        target: [knowledgeAcknowledgements.documentId, knowledgeAcknowledgements.userId],
        set: { versionNumber: doc.versionNumber, acknowledgedAt: now },
      });

    await bumpCacheVersion(c.env as Env, knowledgeVersionKey(tenantId));
    return c.json({ acknowledged: true, versionNumber: doc.versionNumber, acknowledgedAt: now.toISOString() }, 201);
  });

  // ---- REPLACE TAGS -----------------------------------------------------
  router.put('/documents/:id/tags', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const body = await c.req.json<{ tags?: string[] }>();
    const doc = await loadDoc(tenantId, id);
    if (!doc) return c.json({ error: 'Document not found' }, 404);
    if (!canEditAccess(await accessFor(c, doc))) return c.json({ error: 'You do not have edit access to this document' }, 403);

    const tags = normaliseTags(body.tags);
    await db.delete(knowledgeDocumentTags).where(eq(knowledgeDocumentTags.documentId, id));
    if (tags.length) {
      await db.insert(knowledgeDocumentTags).values(tags.map((tag) => ({ tenantId, documentId: id, tag })));
    }
    await bumpCacheVersion(c.env as Env, knowledgeVersionKey(tenantId));
    return c.json({ tags });
  });

  // ---- PER-DOCUMENT COMPLIANCE (audit rollup) --------------------------
  router.get('/documents/:id/compliance', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const doc = await loadDoc(tenantId, id);
    if (!doc) return c.json({ error: 'Document not found' }, 404);

    const [members, ackRows, trainingRows] = await Promise.all([
      loadMembers(tenantId),
      db
        .select()
        .from(knowledgeAcknowledgements)
        .where(and(eq(knowledgeAcknowledgements.documentId, id), eq(knowledgeAcknowledgements.tenantId, tenantId))),
      db
        .select()
        .from(knowledgeTrainingAssignments)
        .where(and(eq(knowledgeTrainingAssignments.documentId, id), eq(knowledgeTrainingAssignments.tenantId, tenantId))),
    ]);

    const result = buildDocCompliance({
      members,
      acks: ackRows.map((a) => ({
        userId: a.userId,
        versionNumber: a.versionNumber,
        acknowledgedAt: a.acknowledgedAt.toISOString(),
      })),
      training: trainingRows.map((t) => ({ userId: t.userId, dueAt: t.dueAt ? t.dueAt.toISOString() : null })),
      currentVersion: doc.versionNumber,
      requiresAck: doc.requiresAck,
      nowMs: Date.now(),
    });
    return c.json(result);
  });

  // ---- TENANT-WIDE COMPLIANCE SUMMARY (Training/Compliance tab) ---------
  router.get('/compliance', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const env = c.env as Env;
    const ver = await getCacheVersion(env, knowledgeVersionKey(tenantId));
    const payload = await getOrSetCached(env, `knowledge:compliance:${tenantId}:v:${ver}`, async () => {
      const [docs, members, allAcks, allTraining] = await Promise.all([
        db
          .select()
          .from(knowledgeDocuments)
          .where(and(eq(knowledgeDocuments.tenantId, tenantId), eq(knowledgeDocuments.status, 'published'))),
        loadMembers(tenantId),
        db.select().from(knowledgeAcknowledgements).where(eq(knowledgeAcknowledgements.tenantId, tenantId)),
        db.select().from(knowledgeTrainingAssignments).where(eq(knowledgeTrainingAssignments.tenantId, tenantId)),
      ]);

      const nowMs = Date.now();
      const rows = docs
        .filter((d) => d.requiresAck || allTraining.some((t) => t.documentId === d.id))
        .map((d) => {
          const { summary } = buildDocCompliance({
            members,
            acks: allAcks
              .filter((a) => a.documentId === d.id)
              .map((a) => ({ userId: a.userId, versionNumber: a.versionNumber, acknowledgedAt: a.acknowledgedAt.toISOString() })),
            training: allTraining
              .filter((t) => t.documentId === d.id)
              .map((t) => ({ userId: t.userId, dueAt: t.dueAt ? t.dueAt.toISOString() : null })),
            currentVersion: d.versionNumber,
            requiresAck: d.requiresAck,
            nowMs,
          });
          return {
            documentId: d.id,
            title: d.title,
            docType: d.docType,
            versionNumber: d.versionNumber,
            ...summary,
          };
        });

      const totals = rows.reduce(
        (acc, r) => ({
          required: acc.required + r.required,
          acknowledged: acc.acknowledged + r.acknowledged,
          overdue: acc.overdue + r.overdue,
        }),
        { required: 0, acknowledged: 0, overdue: 0 },
      );
      const percent = totals.required === 0 ? 100 : Math.round((totals.acknowledged / totals.required) * 100);
      return { documents: rows, totals: { ...totals, percent } };
    }, { kvTtlSeconds: 60 });

    return c.json(payload);
  });

  // ---- ASSIGNABLE / INVITABLE MEMBERS ----------------------------------
  // Member display names within a workspace are not sensitive; any author
  // (developer+) needs this to invite collaborators or assign training.
  router.get('/members', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    return c.json({ members: await loadMembers(tenantId) });
  });

  // ---- PER-DOCUMENT COLLABORATORS (invite users to a page) -------------
  router.get('/documents/:id/collaborators', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const doc = await loadDoc(tenantId, id);
    if (!doc) return c.json({ error: 'Document not found' }, 404);
    const [rows, ownerRow] = await Promise.all([
      db
        .select({
          userId: knowledgeDocumentCollaborators.userId,
          role: knowledgeDocumentCollaborators.role,
          createdAt: knowledgeDocumentCollaborators.createdAt,
          displayName: users.displayName,
          email: users.email,
        })
        .from(knowledgeDocumentCollaborators)
        .innerJoin(users, eq(users.id, knowledgeDocumentCollaborators.userId))
        .where(eq(knowledgeDocumentCollaborators.documentId, id)),
      doc.createdBy
        ? db
            .select({ id: users.id, displayName: users.displayName, email: users.email })
            .from(users)
            .where(eq(users.id, doc.createdBy))
        : Promise.resolve([]),
    ]);
    const owner = ownerRow[0]
      ? { userId: ownerRow[0].id, name: ownerRow[0].displayName?.trim() || ownerRow[0].email, email: ownerRow[0].email }
      : null;
    return c.json({
      // The creator is the implicit owner — surface them alongside invitees.
      owner,
      collaborators: rows.map((r) => ({
        userId: r.userId,
        name: r.displayName?.trim() || r.email,
        email: r.email,
        role: r.role,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  });

  router.post('/documents/:id/collaborators', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const invitedBy = c.get('userId') as string;
    const id = c.req.param('id');
    const body = await c.req.json<{ userId?: string; role?: 'editor' | 'viewer' }>();
    const doc = await loadDoc(tenantId, id);
    if (!doc) return c.json({ error: 'Document not found' }, 404);
    if (!canEditAccess(await accessFor(c, doc))) return c.json({ error: 'You do not have access to manage this page' }, 403);

    const userId = body.userId?.trim();
    if (!userId) return c.json({ error: 'userId is required' }, 400);
    const role = body.role === 'viewer' ? 'viewer' : 'editor';
    if (userId === doc.createdBy) return c.json({ error: 'The document creator is already the owner' }, 400);

    // Only invite users who are members of this tenant (scope guard).
    const [member] = await db
      .select({ userId: tenantMembers.userId })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)));
    if (!member) return c.json({ error: 'User is not a member of this workspace' }, 400);

    await db
      .insert(knowledgeDocumentCollaborators)
      .values({ tenantId, documentId: id, userId, role, invitedBy })
      .onConflictDoUpdate({
        target: [knowledgeDocumentCollaborators.documentId, knowledgeDocumentCollaborators.userId],
        set: { role, invitedBy },
      });

    await bumpCacheVersion(c.env as Env, knowledgeVersionKey(tenantId));
    c.executionCtx.waitUntil(
      notifyCollaboratorInvited(c.env as KnowledgeNotifierEnv, db, {
        tenantId,
        documentId: id,
        title: doc.title,
        userId,
        role,
      }),
    );
    return c.json({ userId, role }, 201);
  });

  router.delete('/documents/:id/collaborators/:userId', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const targetUserId = c.req.param('userId');
    const doc = await loadDoc(tenantId, id);
    if (!doc) return c.json({ error: 'Document not found' }, 404);
    if (!canEditAccess(await accessFor(c, doc))) return c.json({ error: 'You do not have access to manage this page' }, 403);
    await db
      .delete(knowledgeDocumentCollaborators)
      .where(
        and(
          eq(knowledgeDocumentCollaborators.documentId, id),
          eq(knowledgeDocumentCollaborators.userId, targetUserId),
        ),
      );
    await bumpCacheVersion(c.env as Env, knowledgeVersionKey(tenantId));
    return c.body(null, 204);
  });

  // ---- TRAINING: my assignments ----------------------------------------
  router.get('/training/me', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;

    const assignments = await db
      .select({
        id: knowledgeTrainingAssignments.id,
        documentId: knowledgeTrainingAssignments.documentId,
        dueAt: knowledgeTrainingAssignments.dueAt,
        title: knowledgeDocuments.title,
        docType: knowledgeDocuments.docType,
        status: knowledgeDocuments.status,
        versionNumber: knowledgeDocuments.versionNumber,
      })
      .from(knowledgeTrainingAssignments)
      .innerJoin(knowledgeDocuments, eq(knowledgeDocuments.id, knowledgeTrainingAssignments.documentId))
      .where(and(eq(knowledgeTrainingAssignments.tenantId, tenantId), eq(knowledgeTrainingAssignments.userId, userId)));

    const myAcks = await db
      .select()
      .from(knowledgeAcknowledgements)
      .where(and(eq(knowledgeAcknowledgements.tenantId, tenantId), eq(knowledgeAcknowledgements.userId, userId)));
    const ackByDoc = new Map(myAcks.map((a) => [a.documentId, a]));
    const nowMs = Date.now();

    const items = assignments.map((a) => {
      const ack = ackByDoc.get(a.documentId);
      const completed = !!ack && a.versionNumber > 0 && ack.versionNumber >= a.versionNumber;
      const overdue = !completed && !!a.dueAt && a.dueAt.getTime() < nowMs;
      return {
        id: a.id,
        documentId: a.documentId,
        title: a.title,
        docType: a.docType,
        dueAt: a.dueAt ? a.dueAt.toISOString() : null,
        completed,
        overdue,
        state: completed ? 'completed' : overdue ? 'overdue' : 'pending',
      };
    });
    return c.json({ assignments: items });
  });

  // ---- TRAINING: assign a document to users ----------------------------
  router.post('/documents/:id/training', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const assignedBy = c.get('userId') as string;
    const id = c.req.param('id');
    const body = await c.req.json<{ userIds?: string[]; dueAt?: string | null }>();
    const doc = await loadDoc(tenantId, id);
    if (!doc) return c.json({ error: 'Document not found' }, 404);

    const userIds = Array.from(new Set((body.userIds ?? []).filter((u) => typeof u === 'string' && u.trim())));
    if (userIds.length === 0) return c.json({ error: 'userIds is required' }, 400);
    const dueAt = body.dueAt ? new Date(body.dueAt) : null;
    if (dueAt && Number.isNaN(dueAt.getTime())) return c.json({ error: 'dueAt must be a valid date' }, 400);

    await db
      .insert(knowledgeTrainingAssignments)
      .values(userIds.map((userId) => ({ tenantId, documentId: id, userId, assignedBy, dueAt })))
      .onConflictDoUpdate({
        target: [knowledgeTrainingAssignments.documentId, knowledgeTrainingAssignments.userId],
        set: { dueAt, assignedBy },
      });

    await bumpCacheVersion(c.env as Env, knowledgeVersionKey(tenantId));
    c.executionCtx.waitUntil(
      notifyTrainingAssigned(c.env as KnowledgeNotifierEnv, db, {
        tenantId,
        documentId: id,
        title: doc.title,
        userIds,
        dueAt,
      }),
    );
    return c.json({ assigned: userIds.length }, 201);
  });

  // ---- TRAINING: unassign ----------------------------------------------
  router.delete('/training/:assignmentId', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const assignmentId = c.req.param('assignmentId');
    await db
      .delete(knowledgeTrainingAssignments)
      .where(and(eq(knowledgeTrainingAssignments.id, assignmentId), eq(knowledgeTrainingAssignments.tenantId, tenantId)));
    await bumpCacheVersion(c.env as Env, knowledgeVersionKey(tenantId));
    return c.body(null, 204);
  });

  // ---- AI-ASSISTED AUTHORING -------------------------------------------
  // Generate or refine SOP/process/doc markdown from a natural-language prompt.
  // Routed through the shared LLM gateway (ideProxy) and metered via logTrace.
  router.post('/ai/draft', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const body = await c.req.json<{
      prompt?: string;
      docType?: DocType;
      title?: string;
      existingContent?: string;
    }>();
    if (!body.prompt?.trim()) return c.json({ error: 'prompt is required' }, 400);

    const docType: DocType = (DOC_TYPES as readonly string[]).includes(body.docType ?? '')
      ? (body.docType as DocType)
      : 'sop';
    const kind =
      docType === 'sop'
        ? 'a Standard Operating Procedure (SOP)'
        : docType === 'process'
          ? 'a process / workflow document'
          : 'a knowledge-base document';

    const system =
      `You are an expert technical writer producing ${kind} for a company knowledge base used for ` +
      `compliance audits (SOX, TISAX, ISO 27001). Write clear, well-structured GitHub-flavored Markdown. ` +
      `Use a top-level "# Title" heading, a one-line purpose/summary, then numbered steps or clearly ` +
      `delineated sections (Purpose, Scope, Roles & Responsibilities, Procedure, Records). Be specific and ` +
      `actionable. Output ONLY the Markdown document — no preamble, no commentary.`;
    const userMsg =
      (body.title ? `Title: ${body.title}\n` : '') +
      (body.existingContent?.trim()
        ? `Improve and expand the following existing document according to the instruction.\n\n--- Existing document ---\n${body.existingContent}\n\n--- Instruction ---\n${body.prompt}`
        : `Instruction: ${body.prompt}`);

    const traceId = newTraceId();
    // Stream the draft (SSE) so long SOPs render progressively in the editor.
    const requestBody = {
      messages: [
        { role: 'system' as const, content: system },
        { role: 'user' as const, content: userMsg },
      ],
      stream: true as const,
      temperature: 0.6,
    };

    let result;
    try {
      result = await ideProxy(c.env).complete(requestBody, undefined, traceId);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'AI generation failed' }, 502);
    }

    // Meter the call (token usage + diagnostic trace), fire-and-forget.
    logTrace(c.env, c.executionCtx, {
      traceId,
      surface: 'knowledge-ai',
      tenantId,
      userId,
      result,
      streamed: true,
      requestIp: c.req.header('cf-connecting-ip') ?? null,
      origin: c.req.header('Origin') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
      requestBody: requestBody as unknown as Record<string, unknown>,
      responseBody: null,
      errorMessage: null,
    });

    // Pass the gateway's OpenAI-compatible SSE stream straight through; the
    // client accumulates `choices[].delta.content` (same shape as IDE chat).
    return new Response(result.response.body, {
      status: result.response.status,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'x-builderforce-model': result.resolvedModel,
      },
    });
  });

  // ---- AI PROCESS ANALYSIS (review an SOP → improvement findings) -------
  // Realises the "review SOPs → propose a more efficient flow" promise from the
  // knowledge side: runs the document through the gateway and returns structured
  // findings + a proposed improved flow. Editors only (it spends tokens).
  router.post('/documents/:id/analyze', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const doc = await loadDoc(tenantId, id);
    if (!doc) return c.json({ error: 'Document not found' }, 404);
    if (!canEditAccess(await accessFor(c, doc))) return c.json({ error: 'You do not have edit access to this document' }, 403);
    if (!doc.content.trim()) return c.json({ error: 'Document is empty — nothing to analyze' }, 400);

    const system =
      `You are a process-improvement analyst reviewing a company ${doc.docType === 'process' ? 'process/workflow' : doc.docType === 'sop' ? 'Standard Operating Procedure' : 'knowledge document'} ` +
      `for clarity, efficiency, compliance (SOX/TISAX/ISO 27001) and missing controls. ` +
      `Respond with ONLY a JSON object (no markdown fence, no prose) of the shape: ` +
      `{"summary": string, "findings": [{"category": "inefficiency"|"gap"|"risk"|"clarity", "severity": "low"|"medium"|"high", "issue": string, "recommendation": string}], "improvedFlow": string}. ` +
      `"improvedFlow" is a concise GitHub-flavored Markdown rewrite of the procedure as a clearer, more efficient numbered flow. Keep findings specific and actionable.`;
    const userMsg = `Title: ${doc.title}\n\n--- Document ---\n${doc.content}`;

    const traceId = newTraceId();
    const requestBody = {
      messages: [
        { role: 'system' as const, content: system },
        { role: 'user' as const, content: userMsg },
      ],
      stream: false as const,
      temperature: 0.4,
    };

    let result;
    try {
      result = await ideProxy(c.env).complete(requestBody, undefined, traceId);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Analysis failed' }, 502);
    }
    const json = (await result.response.json().catch(() => null)) as
      | { choices?: Array<{ message?: { content?: string } }> }
      | null;
    const raw = json?.choices?.[0]?.message?.content ?? '';

    logTrace(c.env, c.executionCtx, {
      traceId,
      surface: 'knowledge-ai',
      tenantId,
      userId,
      result,
      streamed: false,
      requestIp: c.req.header('cf-connecting-ip') ?? null,
      origin: c.req.header('Origin') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
      requestBody: requestBody as unknown as Record<string, unknown>,
      responseBody: null,
      errorMessage: raw ? null : 'empty response',
    });

    if (!raw.trim()) return c.json({ error: 'Model returned an empty response' }, 502);
    return c.json({ ...parseAnalysis(raw), model: result.resolvedModel });
  });

  // =====================================================================
  // MARKETPLACE — sell knowledge documents (migration 0252).
  // A listing snapshots the doc's content so installing copies it into the
  // buyer's tenant as a fresh document. Browse reads are cached behind a global
  // version token (cross-tenant) bumped on every listing write. Charging/checkout
  // (priceCents) is a separate Stripe integration — install grants a copy.
  // =====================================================================
  const MARKET_VERSION_KEY = 'knowledge-market';
  const LISTING_VISIBILITIES = ['private', 'tenant', 'public'] as const;

  function parseTags(json: string): string[] {
    try {
      const v = JSON.parse(json);
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  // ---- LIST A DOC FOR SALE (publish / re-list) -------------------------
  router.post('/documents/:id/list', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const doc = await loadDoc(tenantId, id);
    if (!doc) return c.json({ error: 'Document not found' }, 404);
    const access = await accessFor(c, doc);
    if (!canEditAccess(access)) return c.json({ error: 'Forbidden' }, 403);

    type ListBody = { priceCents?: number; category?: string; visibility?: string };
    const body = await c.req.json<ListBody>().catch((): ListBody => ({}));
    const priceCents = Math.max(0, Math.round(Number(body.priceCents) || 0));
    const visibility = (LISTING_VISIBILITIES as readonly string[]).includes(body.visibility ?? '')
      ? (body.visibility as string)
      : 'public';

    const tags = (await tagsFor([id])).get(id) ?? [];
    const [author] = await db.select({ name: users.displayName, email: users.email }).from(users).where(eq(users.id, userId));
    const authorName = author?.name?.trim() || author?.email || null;

    const values = {
      tenantId,
      createdBy: userId,
      sourceDocumentId: id,
      title: doc.title,
      summary: doc.summary,
      docType: doc.docType,
      content: doc.content,
      category: body.category?.trim() || null,
      tags: JSON.stringify(tags),
      priceCents,
      visibility,
      authorName,
      updatedAt: new Date(),
    };

    const [existing] = await db.select().from(marketplaceKnowledge).where(eq(marketplaceKnowledge.sourceDocumentId, id));
    const [listing] = existing
      ? await db.update(marketplaceKnowledge).set(values).where(eq(marketplaceKnowledge.id, existing.id)).returning()
      : await db.insert(marketplaceKnowledge).values(values).returning();
    await bumpCacheVersion(c.env as Env, MARKET_VERSION_KEY);
    return c.json({ listing: { ...listing, tags } });
  });

  // ---- THE CALLER-TENANT'S LISTING FOR A DOC (editor list/unlist UI) ----
  router.get('/documents/:id/listing', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [listing] = await db
      .select()
      .from(marketplaceKnowledge)
      .where(and(eq(marketplaceKnowledge.sourceDocumentId, id), eq(marketplaceKnowledge.tenantId, tenantId)));
    return c.json({ listing: listing ? { ...listing, tags: parseTags(listing.tags) } : null });
  });

  // ---- UNLIST (seller tenant only) -------------------------------------
  router.delete('/listings/:listingId', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const listingId = c.req.param('listingId');
    const [listing] = await db.select().from(marketplaceKnowledge).where(eq(marketplaceKnowledge.id, listingId));
    if (!listing) return c.json({ error: 'Listing not found' }, 404);
    if (listing.tenantId !== tenantId) return c.json({ error: 'Forbidden' }, 403);
    await db.delete(marketplaceKnowledge).where(eq(marketplaceKnowledge.id, listingId));
    await bumpCacheVersion(c.env as Env, MARKET_VERSION_KEY);
    return c.body(null, 204);
  });

  // ---- BROWSE PUBLIC LISTINGS (cross-tenant, cached) -------------------
  router.get('/listings', async (c) => {
    const env = c.env as Env;
    const ver = await getCacheVersion(env, MARKET_VERSION_KEY);
    const payload = await getOrSetCached(env, `knowledge-market:listings:v:${ver}`, async () => {
      const rows = await db
        .select()
        .from(marketplaceKnowledge)
        .where(eq(marketplaceKnowledge.visibility, 'public'))
        .orderBy(desc(marketplaceKnowledge.installCount), desc(marketplaceKnowledge.createdAt));
      return {
        listings: rows.map((r) => ({
          id: r.id,
          title: r.title,
          summary: r.summary,
          docType: r.docType,
          category: r.category,
          tags: parseTags(r.tags),
          priceCents: r.priceCents,
          authorName: r.authorName,
          installCount: r.installCount,
          createdAt: r.createdAt,
        })),
      };
    }, { kvTtlSeconds: 120, l1TtlMs: 30_000 });
    return c.json(payload);
  });

  // ---- INSTALL A LISTING (copy into the caller's tenant) ---------------
  router.post('/listings/:listingId/install', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const segmentId = (c.get('segmentId') as string | undefined) ?? null;
    const listingId = c.req.param('listingId');
    const [listing] = await db.select().from(marketplaceKnowledge).where(eq(marketplaceKnowledge.id, listingId));
    if (!listing) return c.json({ error: 'Listing not found' }, 404);
    // Public listings install anywhere; non-public only within the owning tenant.
    if (listing.visibility !== 'public' && listing.tenantId !== tenantId) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const [doc] = await db
      .insert(knowledgeDocuments)
      .values({
        tenantId,
        segmentId,
        projectId: null,
        docType: listing.docType,
        title: listing.title,
        summary: listing.summary,
        content: listing.content,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    if (!doc) return c.json({ error: 'Failed to install listing' }, 500);

    const tags = parseTags(listing.tags);
    if (tags.length) {
      await db.insert(knowledgeDocumentTags).values(tags.map((tag) => ({ tenantId, documentId: doc.id, tag })));
    }
    await db
      .update(marketplaceKnowledge)
      .set({ installCount: listing.installCount + 1 })
      .where(eq(marketplaceKnowledge.id, listingId));

    await bumpCacheVersion(c.env as Env, knowledgeVersionKey(tenantId));
    await bumpCacheVersion(c.env as Env, MARKET_VERSION_KEY);
    return c.json({ documentId: doc.id }, 201);
  });

  return router;
}

export type AnalysisCategory = 'inefficiency' | 'gap' | 'risk' | 'clarity';
export interface AnalysisFinding {
  category: AnalysisCategory;
  severity: 'low' | 'medium' | 'high';
  issue: string;
  recommendation: string;
}
export interface AnalysisResult {
  summary: string;
  findings: AnalysisFinding[];
  improvedFlow: string;
}

const ANALYSIS_CATEGORIES: AnalysisCategory[] = ['inefficiency', 'gap', 'risk', 'clarity'];
const ANALYSIS_SEVERITIES = ['low', 'medium', 'high'] as const;

/**
 * Parse the model's analysis response into a validated shape. Tolerates a
 * ```json fenced block or surrounding prose; falls back to a summary-only result
 * (raw text) when no valid JSON object is present, so the endpoint never 500s on
 * a non-conforming model.
 */
export function parseAnalysis(raw: string): AnalysisResult {
  const empty: AnalysisResult = { summary: '', findings: [], improvedFlow: '' };
  if (!raw?.trim()) return empty;

  // Pull the outermost {...} (handles fences / leading prose).
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  let parsed: unknown = null;
  if (start !== -1 && end > start) {
    try {
      parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
      parsed = null;
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { summary: raw.trim().slice(0, 2000), findings: [], improvedFlow: '' };
  }

  const obj = parsed as Record<string, unknown>;
  const findings: AnalysisFinding[] = Array.isArray(obj.findings)
    ? obj.findings
        .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
        .map((f) => ({
          category: ANALYSIS_CATEGORIES.includes(f.category as AnalysisCategory) ? (f.category as AnalysisCategory) : 'clarity',
          severity: (ANALYSIS_SEVERITIES as readonly string[]).includes(f.severity as string) ? (f.severity as AnalysisFinding['severity']) : 'medium',
          issue: typeof f.issue === 'string' ? f.issue : '',
          recommendation: typeof f.recommendation === 'string' ? f.recommendation : '',
        }))
        .filter((f) => f.issue || f.recommendation)
    : [];

  return {
    summary: typeof obj.summary === 'string' ? obj.summary : '',
    findings,
    improvedFlow: typeof obj.improvedFlow === 'string' ? obj.improvedFlow : '',
  };
}

/** Normalise tags: trim, lowercase, dedupe, drop empties, cap length & count. */
export function normaliseTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim().toLowerCase().slice(0, 64);
    if (tag) seen.add(tag);
    if (seen.size >= 25) break;
  }
  return Array.from(seen);
}

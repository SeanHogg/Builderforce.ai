import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
/**
 * In-platform messaging for the freelance marketplace — /api/conversations/*.
 *
 * A two-party thread between an EMPLOYER (a tenant; any manager acts on its behalf)
 * and a FREELANCER (a specific user), scoped to an engagement, a job+proposal, or a
 * direct talent contact. Hiring, interviewing and scoping now have a durable,
 * auditable home instead of happening off-platform.
 *
 *   Employer actions  → TENANT JWT  (GET / , POST / , /:id/messages , /:id/read)
 *   Freelancer actions → WEB JWT     (GET /mine , POST /mine , /mine/:id/*)
 *
 * A message is "from the freelancer" iff sender_user_id = freelancer_user_id, else it
 * is from the employer side; that comparison drives per-side unread counts. Read state
 * is a per-side watermark on the conversation (see migration 0298).
 *
 * The feed itself is NOT read-through cached: a conversation thread is single-viewer,
 * private, and mutates on every send/read, so a cache would thrash and risk staleness
 * with no cross-request reuse — the same rationale the notification feed follows. New
 * messages surface via the shared notification pipeline (kind='message').
 *
 * Data access is Drizzle end-to-end (query builder; `db.execute(sql\`\`)` only where the
 * builder cannot express the statement). No raw `neon()` client lives here.
 */
import { Hono } from 'hono';
import { and, asc, eq, getTableColumns, isNull, sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import { verifyWebJwt, verifyJwt } from '../../infrastructure/auth/JwtService';
import { notify } from '../../application/notifications/notify';
import { buildDatabase } from '../../infrastructure/database/connection';
import {
  freelancerConversations,
  freelancerEngagements,
  freelancerMessages,
  freelancerProfiles,
  jobPostings,
  jobProposals,
  tenants,
  users,
} from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { HonoEnv } from '../../env';

const MESSAGE_MAX = 8000;
const ATTACH_MAX_BYTES = 15 * 1024 * 1024;
const SUBJECT_TYPES = ['engagement', 'job', 'proposal', 'direct'] as const;

type ConversationRow = typeof freelancerConversations.$inferSelect;
type ConversationView = ConversationRow & {
  tenantName?: string | null;
  freelancerName?: string | null;
  unread?: number | null;
};
type MessageView = typeof freelancerMessages.$inferSelect & { senderName?: string | null };

const mapMessage = (r: MessageView, freelancerUserId: string) => ({
  id: r.id,
  conversationId: r.conversationId,
  senderUserId: r.senderUserId,
  senderName: r.senderName ?? null,
  fromFreelancer: r.senderUserId === freelancerUserId,
  body: r.body,
  attachmentName: r.attachmentName ?? null,
  attachmentType: r.attachmentType ?? null,
  hasAttachment: Boolean(r.attachmentKey),
  createdAt: r.createdAt ?? null,
});

const mapConversation = (r: ConversationView) => ({
  id: r.id,
  tenantId: Number(r.tenantId),
  tenantName: r.tenantName ?? null,
  freelancerUserId: r.freelancerUserId,
  freelancerName: r.freelancerName ?? null,
  employerUserId: r.employerUserId ?? null,
  subjectType: r.subjectType ?? 'direct',
  engagementId: r.engagementId ?? null,
  jobId: r.jobId ?? null,
  proposalId: r.proposalId ?? null,
  projectId: r.projectId == null ? null : Number(r.projectId),
  title: r.title ?? null,
  lastMessageAt: r.lastMessageAt ?? null,
  lastMessagePreview: r.lastMessagePreview ?? null,
  unread: r.unread == null ? 0 : Number(r.unread),
  updatedAt: r.updatedAt ?? null,
});

/** Conversations, newest-active first — the ordering both list views share. */
const CONVERSATION_ORDER = [
  sql`${freelancerConversations.lastMessageAt} DESC NULLS LAST`,
  sql`${freelancerConversations.createdAt} DESC`,
];

/** Messages the OTHER side sent since this side's read watermark. `side` picks which
 *  watermark and which direction of the sender_user_id = freelancer_user_id test. */
const unreadCount = (side: 'employer' | 'freelancer') => {
  // employer reads messages FROM the freelancer (=); the freelancer reads everything
  // that is NOT from themselves (<>). Inverting this silently breaks unread badges.
  const direction = side === 'employer'
    ? sql`${freelancerMessages.senderUserId} = ${freelancerConversations.freelancerUserId}`
    : sql`${freelancerMessages.senderUserId} <> ${freelancerConversations.freelancerUserId}`;
  const watermark = side === 'employer'
    ? freelancerConversations.employerLastReadAt
    : freelancerConversations.freelancerLastReadAt;
  return sql<number>`(SELECT COUNT(*) FROM ${freelancerMessages}
      WHERE ${freelancerMessages.conversationId} = ${freelancerConversations.id}
        AND ${direction}
        AND ${freelancerMessages.createdAt} > COALESCE(${watermark}, 'epoch'))::int`;
};

export function createFreelancerMessagingRoutes(_db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  /** Append a message to an already-authorized conversation, refresh the denormalized
   *  last-message cache, and notify the OTHER side. ONE writer both sides share. */
  async function appendMessage(
    db: Db, env: HonoEnv['Bindings'],
    conv: ConversationRow, senderUserId: string, body: string,
    attach?: { key: string; name: string; type: string } | null,
  ): Promise<{ id: string }> {
    const id = crypto.randomUUID();
    const trimmed = body.slice(0, MESSAGE_MAX);
    await db.insert(freelancerMessages).values({
      id,
      conversationId: conv.id,
      senderUserId,
      body: trimmed,
      attachmentKey: attach?.key ?? null,
      attachmentName: attach?.name ?? null,
      attachmentType: attach?.type ?? null,
    });
    const preview = (trimmed || (attach ? `📎 ${attach.name}` : '')).slice(0, 280);
    await db.update(freelancerConversations)
      .set({
        lastMessageAt: sql`NOW()`,
        lastMessagePreview: preview,
        lastSenderUserId: senderUserId,
        updatedAt: sql`NOW()`,
      })
      .where(eq(freelancerConversations.id, conv.id));
    // Notify the other party. Employer→freelancer targets freelancer_user_id; the
    // reverse targets the manager who opened the thread (employer_user_id fallback).
    const freelancerUserId = conv.freelancerUserId;
    const fromFreelancer = senderUserId === freelancerUserId;
    const [sender] = await db.select({ displayName: users.displayName })
      .from(users).where(eq(users.id, senderUserId)).limit(1);
    const senderName = sender?.displayName ?? (fromFreelancer ? 'A freelancer' : 'A client');
    if (fromFreelancer) {
      const target = conv.employerUserId ?? conv.lastSenderUserId;
      if (target && target !== senderUserId) {
        await notify(db, env, { userId: target, tenantId: Number(conv.tenantId), kind: 'message', title: `${senderName} sent you a message`, body: preview, ref: conv.id });
      }
    } else {
      await notify(db, env, { userId: freelancerUserId, tenantId: Number(conv.tenantId), kind: 'message', title: `${senderName} sent you a message`, body: preview, ref: conv.id });
    }
    return { id };
  }

  /** Parse a send request as either JSON {body} or multipart {body,file}. Uploads the
   *  attachment to R2 when present (shared by both sides). */
  async function readSendPayload(c: { req: { header(n: string): string | undefined; json<T>(): Promise<T>; formData(): Promise<FormData> }; env: HonoEnv['Bindings'] }, senderUserId: string): Promise<{ body: string; attach: { key: string; name: string; type: string } | null } | { error: string; status: 400 | 413 | 415 }> {
    const ct = c.req.header('content-type') ?? '';
    if (!ct.includes('multipart/form-data')) {
      const b = await c.req.json<{ body?: string }>().catch(() => ({} as { body?: string }));
      const body = typeof b.body === 'string' ? b.body.trim() : '';
      if (!body) return { error: 'body required', status: 400 };
      return { body, attach: null };
    }
    const form = await c.req.formData();
    const body = String(form.get('body') ?? '').trim();
    const entry = form.get('file');
    if ((!entry || typeof entry === 'string') && !body) return { error: 'body or file required', status: 400 };
    let attach: { key: string; name: string; type: string } | null = null;
    if (entry && typeof entry !== 'string') {
      const file = entry as unknown as File;
      if (file.size > ATTACH_MAX_BYTES) return { error: 'Attachment too large (max 15MB)', status: 413 };
      const type = file.type || 'application/octet-stream';
      if (c.env.UPLOADS) {
        const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
        const key = `messages/${senderUserId}/${crypto.randomUUID()}.${ext}`;
        await c.env.UPLOADS.put(key, file.stream(), { httpMetadata: { contentType: type } });
        attach = { key, name: file.name.slice(0, 255), type: type.slice(0, 120) };
      }
    }
    return { body, attach };
  }

  // ------------------------------------------------------------- ATTACHMENT ---
  // Serve a message attachment to EITHER participant. Registered before /:id so the
  // literal segment isn't swallowed. Accepts a tenant OR web token and authorizes the
  // viewer as a party to the conversation.
  router.get('/attachment/:messageId', async (c) => {
    const db = buildDatabase(c.env);
    const messageId = c.req.param('messageId');
    const h = c.req.header('Authorization') ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!c.env.UPLOADS) return c.json({ error: 'Not found' }, 404);
    const [row] = await db.select({
      attachmentKey: freelancerMessages.attachmentKey,
      attachmentName: freelancerMessages.attachmentName,
      attachmentType: freelancerMessages.attachmentType,
      tenantId: freelancerConversations.tenantId,
      freelancerUserId: freelancerConversations.freelancerUserId,
    })
      .from(freelancerMessages)
      .innerJoin(freelancerConversations, eq(freelancerConversations.id, freelancerMessages.conversationId))
      .where(eq(freelancerMessages.id, messageId));
    if (!row || !row.attachmentKey) return c.json({ error: 'Not found' }, 404);
    // Authorize: the freelancer (web token sub = freelancer_user_id) OR a tenant member
    // (tenant token tid = tenant_id). The two sides carry different token kinds, so try
    // the web verifier first, then the tenant verifier.
    let authorized = false;
    try {
      const p = await verifyWebJwt(token, c.env.JWT_SECRET);
      if (p.sub && p.sub === row.freelancerUserId) authorized = true;
    } catch (error) { /* not a web token */ 
      reportCaughtError(error, { source: "presentation/routes/freelancerMessagingRoutes.ts", operation: "createFreelancerMessagingRoutes" });
    }
    if (!authorized) {
      try {
        const p = await verifyJwt(token, c.env.JWT_SECRET);
        if (p.tid != null && Number(p.tid) === Number(row.tenantId)) authorized = true;
      } catch (error) { /* not a tenant token */ 
        reportCaughtError(error, { source: "presentation/routes/freelancerMessagingRoutes.ts", operation: "createFreelancerMessagingRoutes" });
      }
    }
    if (!authorized) return c.json({ error: 'Forbidden' }, 403);
    const obj = await c.env.UPLOADS.get(row.attachmentKey);
    if (!obj) return c.json({ error: 'Not found' }, 404);
    const headers = new Headers();
    headers.set('Content-Type', row.attachmentType ?? obj.httpMetadata?.contentType ?? 'application/octet-stream');
    headers.set('Content-Disposition', `inline; filename="${encodeURIComponent(row.attachmentName ?? 'attachment')}"`);
    headers.set('Cache-Control', 'private, max-age=3600');
    return new Response(obj.body, { headers });
  });

  // =================================================================== FREELANCER
  // Registered before the employer /:id routes so "mine" isn't swallowed.

  // GET /mine — the freelancer's conversations across all tenants, with unread counts.
  router.get('/mine', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const userId = c.get('userId') as string;
    const rows = await db.select({
      ...getTableColumns(freelancerConversations),
      tenantName: tenants.name,
      freelancerName: users.displayName,
      unread: unreadCount('freelancer'),
    })
      .from(freelancerConversations)
      .innerJoin(tenants, eq(tenants.id, freelancerConversations.tenantId))
      .innerJoin(users, eq(users.id, freelancerConversations.freelancerUserId))
      .where(eq(freelancerConversations.freelancerUserId, userId))
      .orderBy(...CONVERSATION_ORDER)
      .limit(200);
    const items = rows.map(mapConversation);
    return c.json({ items, unread: items.reduce((s, r) => s + r.unread, 0) });
  });

  // POST /mine — freelancer opens a thread with a tenant they are ENGAGED with
  // (reuses the engagement-scoped thread when one exists).
  router.post('/mine', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const userId = c.get('userId') as string;
    const b = await c.req.json<{ engagementId?: string; body?: string; title?: string }>().catch(() => ({} as Record<string, string>));
    if (!b.engagementId) return c.json({ error: 'engagementId required' }, 400);
    const [eng] = await db.select({
      id: freelancerEngagements.id,
      tenantId: freelancerEngagements.tenantId,
      projectId: freelancerEngagements.projectId,
      title: freelancerEngagements.title,
      createdByUserId: freelancerEngagements.createdByUserId,
    })
      .from(freelancerEngagements)
      .where(and(
        eq(freelancerEngagements.id, b.engagementId),
        eq(freelancerEngagements.freelancerUserId, userId),
        isNull(freelancerEngagements.terminatedAt),
      ));
    if (!eng) return c.json({ error: 'Engagement not found' }, 404);
    const conv = await getOrCreateConversation(db, {
      tenantId: Number(eng.tenantId), freelancerUserId: userId,
      employerUserId: eng.createdByUserId ?? null,
      subjectType: 'engagement', engagementId: eng.id, jobId: null, proposalId: null,
      projectId: eng.projectId == null ? null : Number(eng.projectId),
      title: b.title ?? eng.title ?? null,
    });
    if (b.body && b.body.trim()) await appendMessage(db, c.env, conv, userId, b.body.trim());
    return c.json({ id: conv.id }, 201);
  });

  // GET /mine/:id/messages — thread messages (freelancer side).
  router.get('/mine/:id/messages', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const [conv] = await db.select().from(freelancerConversations)
      .where(and(eq(freelancerConversations.id, id), eq(freelancerConversations.freelancerUserId, userId)));
    if (!conv) return c.json({ error: 'Not found' }, 404);
    return c.json({ conversation: mapConversation({ ...conv, unread: 0 }), messages: await loadMessages(db, id, userId) });
  });

  // POST /mine/:id/messages — freelancer sends (text or attachment).
  router.post('/mine/:id/messages', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const [conv] = await db.select().from(freelancerConversations)
      .where(and(eq(freelancerConversations.id, id), eq(freelancerConversations.freelancerUserId, userId)));
    if (!conv) return c.json({ error: 'Not found' }, 404);
    const payload = await readSendPayload(c, userId);
    if ('error' in payload) return c.json({ error: payload.error }, payload.status);
    const { id: msgId } = await appendMessage(db, c.env, conv, userId, payload.body, payload.attach);
    // Sending implies reading everything before it on your side.
    await db.update(freelancerConversations)
      .set({ freelancerLastReadAt: sql`NOW()` })
      .where(eq(freelancerConversations.id, id));
    return c.json({ id: msgId }, 201);
  });

  // POST /mine/:id/read — advance the freelancer's read watermark.
  router.post('/mine/:id/read', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    await db.update(freelancerConversations)
      .set({ freelancerLastReadAt: sql`NOW()` })
      .where(and(eq(freelancerConversations.id, id), eq(freelancerConversations.freelancerUserId, userId)));
    return c.json({ ok: true });
  });

  // =================================================================== EMPLOYER

  // GET / — this tenant's conversations, with unread counts.
  router.get('/', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const rows = await db.select({
      ...getTableColumns(freelancerConversations),
      tenantName: tenants.name,
      freelancerName: users.displayName,
      unread: unreadCount('employer'),
    })
      .from(freelancerConversations)
      .innerJoin(tenants, eq(tenants.id, freelancerConversations.tenantId))
      .innerJoin(users, eq(users.id, freelancerConversations.freelancerUserId))
      .where(eq(freelancerConversations.tenantId, tenantId))
      .orderBy(...CONVERSATION_ORDER)
      .limit(200);
    const items = rows.map(mapConversation);
    return c.json({ items, unread: items.reduce((s, r) => s + r.unread, 0) });
  });

  // POST / — employer opens (or reuses) a conversation with a freelancer. Optionally
  // scoped to an engagement / job / proposal, with an optional first message.
  router.post('/', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const actor = c.get('userId') as string;
    const b = await c.req.json<{ freelancerUserId?: string; engagementId?: string; jobId?: string; proposalId?: string; subjectType?: string; title?: string; body?: string; projectId?: number }>();
    if (!b.freelancerUserId) return c.json({ error: 'freelancerUserId required' }, 400);
    // Resolve scope + verify it belongs to this tenant (no cross-tenant threads).
    let subjectType = SUBJECT_TYPES.includes(b.subjectType as never) ? (b.subjectType as string) : 'direct';
    let engagementId: string | null = null, jobId: string | null = null, proposalId: string | null = null, projectId: number | null = typeof b.projectId === 'number' ? b.projectId : null;
    if (b.engagementId) {
      const [eng] = await db.select({ id: freelancerEngagements.id, projectId: freelancerEngagements.projectId })
        .from(freelancerEngagements)
        .where(and(
          eq(freelancerEngagements.id, b.engagementId),
          eq(freelancerEngagements.tenantId, tenantId),
          eq(freelancerEngagements.freelancerUserId, b.freelancerUserId),
        ));
      if (!eng) return c.json({ error: 'Engagement not found' }, 404);
      engagementId = eng.id; subjectType = 'engagement'; projectId = eng.projectId == null ? projectId : Number(eng.projectId);
    }
    if (b.jobId) {
      const [job] = await db.select({ id: jobPostings.id, projectId: jobPostings.projectId })
        .from(jobPostings)
        .where(and(eq(jobPostings.id, b.jobId), eq(jobPostings.tenantId, tenantId)));
      if (!job) return c.json({ error: 'Job not found' }, 404);
      jobId = job.id; if (subjectType === 'direct') subjectType = 'job'; projectId = projectId ?? (job.projectId == null ? null : Number(job.projectId));
    }
    if (b.proposalId) {
      const [pr] = await db.select({ id: jobProposals.id, jobId: jobProposals.jobId })
        .from(jobProposals)
        .innerJoin(jobPostings, eq(jobPostings.id, jobProposals.jobId))
        .where(and(
          eq(jobProposals.id, b.proposalId),
          eq(jobPostings.tenantId, tenantId),
          eq(jobProposals.freelancerUserId, b.freelancerUserId),
        ));
      if (!pr) return c.json({ error: 'Proposal not found' }, 404);
      proposalId = pr.id; jobId = jobId ?? pr.jobId; if (subjectType === 'direct') subjectType = 'proposal';
    }
    // Must be a hireable target (published profile) — same gate as engagements.
    const [prof] = await db.select({ userId: freelancerProfiles.userId })
      .from(freelancerProfiles)
      .where(and(eq(freelancerProfiles.userId, b.freelancerUserId), eq(freelancerProfiles.published, true)));
    if (!prof && !engagementId) return c.json({ error: 'Freelancer not found' }, 404);

    const conv = await getOrCreateConversation(db, {
      tenantId, freelancerUserId: b.freelancerUserId, employerUserId: actor,
      subjectType, engagementId, jobId, proposalId, projectId, title: b.title ?? null,
    });
    if (b.body && b.body.trim()) {
      await appendMessage(db, c.env, conv, actor, b.body.trim());
      await db.update(freelancerConversations)
        .set({ employerLastReadAt: sql`NOW()` })
        .where(eq(freelancerConversations.id, conv.id));
    }
    return c.json({ id: conv.id }, 201);
  });

  // GET /:id/messages — thread messages (employer side).
  router.get('/:id/messages', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [conv] = await db.select().from(freelancerConversations)
      .where(and(eq(freelancerConversations.id, id), eq(freelancerConversations.tenantId, tenantId)));
    if (!conv) return c.json({ error: 'Not found' }, 404);
    return c.json({ conversation: mapConversation({ ...conv, unread: 0 }), messages: await loadMessages(db, id, conv.freelancerUserId) });
  });

  // POST /:id/messages — employer sends (text or attachment).
  router.post('/:id/messages', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const actor = c.get('userId') as string;
    const id = c.req.param('id');
    const [conv] = await db.select().from(freelancerConversations)
      .where(and(eq(freelancerConversations.id, id), eq(freelancerConversations.tenantId, tenantId)));
    if (!conv) return c.json({ error: 'Not found' }, 404);
    const payload = await readSendPayload(c, actor);
    if ('error' in payload) return c.json({ error: payload.error }, payload.status);
    const { id: msgId } = await appendMessage(db, c.env, conv, actor, payload.body, payload.attach);
    await db.update(freelancerConversations)
      .set({ employerLastReadAt: sql`NOW()` })
      .where(eq(freelancerConversations.id, id));
    return c.json({ id: msgId }, 201);
  });

  // POST /:id/read — advance the employer side's read watermark.
  router.post('/:id/read', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    await db.update(freelancerConversations)
      .set({ employerLastReadAt: sql`NOW()` })
      .where(and(eq(freelancerConversations.id, id), eq(freelancerConversations.tenantId, tenantId)));
    return c.json({ ok: true });
  });

  return router;
}

/** Load a conversation's messages (oldest→newest), tagging sender identity. */
async function loadMessages(db: Db, conversationId: string, freelancerUserId: string) {
  const rows = await db.select({
    ...getTableColumns(freelancerMessages),
    senderName: users.displayName,
  })
    .from(freelancerMessages)
    .leftJoin(users, eq(users.id, freelancerMessages.senderUserId))
    .where(eq(freelancerMessages.conversationId, conversationId))
    .orderBy(asc(freelancerMessages.createdAt))
    .limit(500);
  return rows.map((r) => mapMessage(r, freelancerUserId));
}

/** Find the scoped conversation for (tenant, freelancer, engagement|job) or create it.
 *  Engagement scope wins over job scope; a null-scope thread is always new (direct). */
async function getOrCreateConversation(db: Db, input: {
  tenantId: number; freelancerUserId: string; employerUserId: string | null;
  subjectType: string; engagementId: string | null; jobId: string | null; proposalId: string | null;
  projectId: number | null; title: string | null;
}): Promise<ConversationRow> {
  /** The scoped lookup the partial unique indexes back (uq_fl_conv_engagement / _job). */
  const findScoped = async (): Promise<ConversationRow | undefined> => {
    if (input.engagementId) {
      const [ex] = await db.select().from(freelancerConversations).where(and(
        eq(freelancerConversations.tenantId, input.tenantId),
        eq(freelancerConversations.freelancerUserId, input.freelancerUserId),
        eq(freelancerConversations.engagementId, input.engagementId),
      ));
      return ex;
    }
    if (input.jobId) {
      const [ex] = await db.select().from(freelancerConversations).where(and(
        eq(freelancerConversations.tenantId, input.tenantId),
        eq(freelancerConversations.freelancerUserId, input.freelancerUserId),
        eq(freelancerConversations.jobId, input.jobId),
        isNull(freelancerConversations.engagementId),
      ));
      return ex;
    }
    return undefined;
  };

  const existing = await findScoped();
  if (existing) return existing;

  const id = crypto.randomUUID();
  const [created] = await db.insert(freelancerConversations).values({
    id,
    tenantId: input.tenantId,
    freelancerUserId: input.freelancerUserId,
    employerUserId: input.employerUserId,
    subjectType: input.subjectType,
    engagementId: input.engagementId,
    jobId: input.jobId,
    proposalId: input.proposalId,
    projectId: input.projectId,
    title: input.title,
  }).onConflictDoNothing().returning();
  if (created) return created;
  // Lost a race on the unique index — read the winner back.
  const winner = await findScoped();
  if (winner) return winner;
  const [any] = await db.select().from(freelancerConversations).where(eq(freelancerConversations.id, id));
  return any as ConversationRow;
}

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
 */
import { Hono } from 'hono';
import { neon } from '@neondatabase/serverless';
import { authMiddleware } from '../middleware/authMiddleware';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import { verifyWebJwt, verifyJwt } from '../../infrastructure/auth/JwtService';
import { notify } from '../../application/notifications/notify';
import type { Db } from '../../infrastructure/database/connection';
import type { HonoEnv } from '../../env';

const MESSAGE_MAX = 8000;
const ATTACH_MAX_BYTES = 15 * 1024 * 1024;
const SUBJECT_TYPES = ['engagement', 'job', 'proposal', 'direct'] as const;

type Sql = ReturnType<typeof neon<false, false>>;

const mapMessage = (r: Record<string, unknown>, freelancerUserId: string) => ({
  id: r.id as string,
  conversationId: r.conversation_id as string,
  senderUserId: r.sender_user_id as string,
  senderName: (r.sender_name as string) ?? null,
  fromFreelancer: r.sender_user_id === freelancerUserId,
  body: r.body as string,
  attachmentName: (r.attachment_name as string) ?? null,
  attachmentType: (r.attachment_type as string) ?? null,
  hasAttachment: Boolean(r.attachment_key),
  createdAt: r.created_at ?? null,
});

const mapConversation = (r: Record<string, unknown>) => ({
  id: r.id as string,
  tenantId: Number(r.tenant_id),
  tenantName: (r.tenant_name as string) ?? null,
  freelancerUserId: r.freelancer_user_id as string,
  freelancerName: (r.freelancer_name as string) ?? null,
  employerUserId: (r.employer_user_id as string) ?? null,
  subjectType: (r.subject_type as string) ?? 'direct',
  engagementId: (r.engagement_id as string) ?? null,
  jobId: (r.job_id as string) ?? null,
  proposalId: (r.proposal_id as string) ?? null,
  projectId: r.project_id == null ? null : Number(r.project_id),
  title: (r.title as string) ?? null,
  lastMessageAt: r.last_message_at ?? null,
  lastMessagePreview: (r.last_message_preview as string) ?? null,
  unread: r.unread == null ? 0 : Number(r.unread),
  updatedAt: r.updated_at ?? null,
});

export function createFreelancerMessagingRoutes(_db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const sql = (env: HonoEnv['Bindings']) => neon(env.NEON_DATABASE_URL);

  /** Append a message to an already-authorized conversation, refresh the denormalized
   *  last-message cache, and notify the OTHER side. ONE writer both sides share. */
  async function appendMessage(
    db: Sql, env: HonoEnv['Bindings'],
    conv: Record<string, unknown>, senderUserId: string, body: string,
    attach?: { key: string; name: string; type: string } | null,
  ): Promise<{ id: string }> {
    const id = crypto.randomUUID();
    const trimmed = body.slice(0, MESSAGE_MAX);
    await db`
      INSERT INTO freelancer_messages (id, conversation_id, sender_user_id, body, attachment_key, attachment_name, attachment_type)
      VALUES (${id}, ${conv.id as string}, ${senderUserId}, ${trimmed}, ${attach?.key ?? null}, ${attach?.name ?? null}, ${attach?.type ?? null})
    `;
    const preview = (trimmed || (attach ? `📎 ${attach.name}` : '')).slice(0, 280);
    await db`
      UPDATE freelancer_conversations
      SET last_message_at = NOW(), last_message_preview = ${preview}, last_sender_user_id = ${senderUserId},
          updated_at = NOW()
      WHERE id = ${conv.id as string}
    `;
    // Notify the other party. Employer→freelancer targets freelancer_user_id; the
    // reverse targets the manager who opened the thread (employer_user_id fallback).
    const freelancerUserId = conv.freelancer_user_id as string;
    const fromFreelancer = senderUserId === freelancerUserId;
    const [sender] = await db`SELECT display_name FROM users WHERE id = ${senderUserId}` as unknown as Record<string, unknown>[];
    const senderName = (sender?.display_name as string) ?? (fromFreelancer ? 'A freelancer' : 'A client');
    if (fromFreelancer) {
      const target = (conv.employer_user_id as string) ?? (conv.last_sender_user_id as string);
      if (target && target !== senderUserId) {
        await notify(db, env, { userId: target, tenantId: Number(conv.tenant_id), kind: 'message', title: `${senderName} sent you a message`, body: preview, ref: conv.id as string });
      }
    } else {
      await notify(db, env, { userId: freelancerUserId, tenantId: Number(conv.tenant_id), kind: 'message', title: `${senderName} sent you a message`, body: preview, ref: conv.id as string });
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
    const messageId = c.req.param('messageId');
    const h = c.req.header('Authorization') ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!c.env.UPLOADS) return c.json({ error: 'Not found' }, 404);
    const [row] = await sql(c.env)`
      SELECT m.attachment_key, m.attachment_name, m.attachment_type, cv.tenant_id, cv.freelancer_user_id
      FROM freelancer_messages m JOIN freelancer_conversations cv ON cv.id = m.conversation_id
      WHERE m.id = ${messageId}
    `;
    if (!row || !row.attachment_key) return c.json({ error: 'Not found' }, 404);
    // Authorize: the freelancer (web token sub = freelancer_user_id) OR a tenant member
    // (tenant token tid = tenant_id). The two sides carry different token kinds, so try
    // the web verifier first, then the tenant verifier.
    let authorized = false;
    try {
      const p = await verifyWebJwt(token, c.env.JWT_SECRET);
      if (p.sub && p.sub === row.freelancer_user_id) authorized = true;
    } catch { /* not a web token */ }
    if (!authorized) {
      try {
        const p = await verifyJwt(token, c.env.JWT_SECRET);
        if (p.tid != null && Number(p.tid) === Number(row.tenant_id)) authorized = true;
      } catch { /* not a tenant token */ }
    }
    if (!authorized) return c.json({ error: 'Forbidden' }, 403);
    const obj = await c.env.UPLOADS.get(row.attachment_key as string);
    if (!obj) return c.json({ error: 'Not found' }, 404);
    const headers = new Headers();
    headers.set('Content-Type', (row.attachment_type as string) ?? obj.httpMetadata?.contentType ?? 'application/octet-stream');
    headers.set('Content-Disposition', `inline; filename="${encodeURIComponent((row.attachment_name as string) ?? 'attachment')}"`);
    headers.set('Cache-Control', 'private, max-age=3600');
    return new Response(obj.body, { headers });
  });

  // =================================================================== FREELANCER
  // Registered before the employer /:id routes so "mine" isn't swallowed.

  // GET /mine — the freelancer's conversations across all tenants, with unread counts.
  router.get('/mine', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const rows = await sql(c.env)`
      SELECT cv.*, t.name AS tenant_name, fu.display_name AS freelancer_name,
        (SELECT COUNT(*) FROM freelancer_messages m WHERE m.conversation_id = cv.id
           AND m.sender_user_id <> cv.freelancer_user_id
           AND m.created_at > COALESCE(cv.freelancer_last_read_at, 'epoch'))::int AS unread
      FROM freelancer_conversations cv
      JOIN tenants t ON t.id = cv.tenant_id
      JOIN users fu ON fu.id = cv.freelancer_user_id
      WHERE cv.freelancer_user_id = ${userId}
      ORDER BY cv.last_message_at DESC NULLS LAST, cv.created_at DESC LIMIT 200
    ` as unknown as Record<string, unknown>[];
    const items = rows.map(mapConversation);
    return c.json({ items, unread: items.reduce((s, r) => s + r.unread, 0) });
  });

  // POST /mine — freelancer opens a thread with a tenant they are ENGAGED with
  // (reuses the engagement-scoped thread when one exists).
  router.post('/mine', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const b = await c.req.json<{ engagementId?: string; body?: string; title?: string }>().catch(() => ({} as Record<string, string>));
    if (!b.engagementId) return c.json({ error: 'engagementId required' }, 400);
    const [eng] = await sql(c.env)`
      SELECT id, tenant_id, project_id, title, created_by_user_id FROM freelancer_engagements
      WHERE id = ${b.engagementId} AND freelancer_user_id = ${userId} AND terminated_at IS NULL
    `;
    if (!eng) return c.json({ error: 'Engagement not found' }, 404);
    const conv = await getOrCreateConversation(sql(c.env), {
      tenantId: Number(eng.tenant_id), freelancerUserId: userId,
      employerUserId: (eng.created_by_user_id as string) ?? null,
      subjectType: 'engagement', engagementId: eng.id as string, jobId: null, proposalId: null,
      projectId: eng.project_id == null ? null : Number(eng.project_id),
      title: (b.title as string) ?? (eng.title as string) ?? null,
    });
    if (b.body && b.body.trim()) await appendMessage(sql(c.env), c.env, conv, userId, b.body.trim());
    return c.json({ id: conv.id }, 201);
  });

  // GET /mine/:id/messages — thread messages (freelancer side).
  router.get('/mine/:id/messages', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const [conv] = await sql(c.env)`SELECT * FROM freelancer_conversations WHERE id = ${id} AND freelancer_user_id = ${userId}`;
    if (!conv) return c.json({ error: 'Not found' }, 404);
    return c.json({ conversation: mapConversation({ ...conv, unread: 0 }), messages: await loadMessages(sql(c.env), id, userId) });
  });

  // POST /mine/:id/messages — freelancer sends (text or attachment).
  router.post('/mine/:id/messages', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const [conv] = await sql(c.env)`SELECT * FROM freelancer_conversations WHERE id = ${id} AND freelancer_user_id = ${userId}`;
    if (!conv) return c.json({ error: 'Not found' }, 404);
    const payload = await readSendPayload(c, userId);
    if ('error' in payload) return c.json({ error: payload.error }, payload.status);
    const { id: msgId } = await appendMessage(sql(c.env), c.env, conv, userId, payload.body, payload.attach);
    // Sending implies reading everything before it on your side.
    await sql(c.env)`UPDATE freelancer_conversations SET freelancer_last_read_at = NOW() WHERE id = ${id}`;
    return c.json({ id: msgId }, 201);
  });

  // POST /mine/:id/read — advance the freelancer's read watermark.
  router.post('/mine/:id/read', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    await sql(c.env)`UPDATE freelancer_conversations SET freelancer_last_read_at = NOW() WHERE id = ${id} AND freelancer_user_id = ${userId}`;
    return c.json({ ok: true });
  });

  // =================================================================== EMPLOYER

  // GET / — this tenant's conversations, with unread counts.
  router.get('/', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const rows = await sql(c.env)`
      SELECT cv.*, t.name AS tenant_name, fu.display_name AS freelancer_name,
        (SELECT COUNT(*) FROM freelancer_messages m WHERE m.conversation_id = cv.id
           AND m.sender_user_id = cv.freelancer_user_id
           AND m.created_at > COALESCE(cv.employer_last_read_at, 'epoch'))::int AS unread
      FROM freelancer_conversations cv
      JOIN tenants t ON t.id = cv.tenant_id
      JOIN users fu ON fu.id = cv.freelancer_user_id
      WHERE cv.tenant_id = ${tenantId}
      ORDER BY cv.last_message_at DESC NULLS LAST, cv.created_at DESC LIMIT 200
    ` as unknown as Record<string, unknown>[];
    const items = rows.map(mapConversation);
    return c.json({ items, unread: items.reduce((s, r) => s + r.unread, 0) });
  });

  // POST / — employer opens (or reuses) a conversation with a freelancer. Optionally
  // scoped to an engagement / job / proposal, with an optional first message.
  router.post('/', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const actor = c.get('userId') as string;
    const b = await c.req.json<{ freelancerUserId?: string; engagementId?: string; jobId?: string; proposalId?: string; subjectType?: string; title?: string; body?: string; projectId?: number }>();
    if (!b.freelancerUserId) return c.json({ error: 'freelancerUserId required' }, 400);
    // Resolve scope + verify it belongs to this tenant (no cross-tenant threads).
    let subjectType = SUBJECT_TYPES.includes(b.subjectType as never) ? (b.subjectType as string) : 'direct';
    let engagementId: string | null = null, jobId: string | null = null, proposalId: string | null = null, projectId: number | null = typeof b.projectId === 'number' ? b.projectId : null;
    if (b.engagementId) {
      const [eng] = await sql(c.env)`SELECT id, project_id FROM freelancer_engagements WHERE id = ${b.engagementId} AND tenant_id = ${tenantId} AND freelancer_user_id = ${b.freelancerUserId}`;
      if (!eng) return c.json({ error: 'Engagement not found' }, 404);
      engagementId = eng.id as string; subjectType = 'engagement'; projectId = eng.project_id == null ? projectId : Number(eng.project_id);
    }
    if (b.jobId) {
      const [job] = await sql(c.env)`SELECT id, project_id FROM job_postings WHERE id = ${b.jobId} AND tenant_id = ${tenantId}`;
      if (!job) return c.json({ error: 'Job not found' }, 404);
      jobId = job.id as string; if (subjectType === 'direct') subjectType = 'job'; projectId = projectId ?? (job.project_id == null ? null : Number(job.project_id));
    }
    if (b.proposalId) {
      const [pr] = await sql(c.env)`SELECT pr.id, pr.job_id FROM job_proposals pr JOIN job_postings j ON j.id = pr.job_id WHERE pr.id = ${b.proposalId} AND j.tenant_id = ${tenantId} AND pr.freelancer_user_id = ${b.freelancerUserId}`;
      if (!pr) return c.json({ error: 'Proposal not found' }, 404);
      proposalId = pr.id as string; jobId = jobId ?? (pr.job_id as string); if (subjectType === 'direct') subjectType = 'proposal';
    }
    // Must be a hireable target (published profile) — same gate as engagements.
    const [prof] = await sql(c.env)`SELECT user_id FROM freelancer_profiles WHERE user_id = ${b.freelancerUserId} AND published = true`;
    if (!prof && !engagementId) return c.json({ error: 'Freelancer not found' }, 404);

    const conv = await getOrCreateConversation(sql(c.env), {
      tenantId, freelancerUserId: b.freelancerUserId, employerUserId: actor,
      subjectType, engagementId, jobId, proposalId, projectId, title: (b.title as string) ?? null,
    });
    if (b.body && b.body.trim()) {
      await appendMessage(sql(c.env), c.env, conv, actor, b.body.trim());
      await sql(c.env)`UPDATE freelancer_conversations SET employer_last_read_at = NOW() WHERE id = ${conv.id as string}`;
    }
    return c.json({ id: conv.id }, 201);
  });

  // GET /:id/messages — thread messages (employer side).
  router.get('/:id/messages', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [conv] = await sql(c.env)`SELECT * FROM freelancer_conversations WHERE id = ${id} AND tenant_id = ${tenantId}`;
    if (!conv) return c.json({ error: 'Not found' }, 404);
    return c.json({ conversation: mapConversation({ ...conv, unread: 0 }), messages: await loadMessages(sql(c.env), id, conv.freelancer_user_id as string) });
  });

  // POST /:id/messages — employer sends (text or attachment).
  router.post('/:id/messages', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const actor = c.get('userId') as string;
    const id = c.req.param('id');
    const [conv] = await sql(c.env)`SELECT * FROM freelancer_conversations WHERE id = ${id} AND tenant_id = ${tenantId}`;
    if (!conv) return c.json({ error: 'Not found' }, 404);
    const payload = await readSendPayload(c, actor);
    if ('error' in payload) return c.json({ error: payload.error }, payload.status);
    const { id: msgId } = await appendMessage(sql(c.env), c.env, conv, actor, payload.body, payload.attach);
    await sql(c.env)`UPDATE freelancer_conversations SET employer_last_read_at = NOW() WHERE id = ${id}`;
    return c.json({ id: msgId }, 201);
  });

  // POST /:id/read — advance the employer side's read watermark.
  router.post('/:id/read', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    await sql(c.env)`UPDATE freelancer_conversations SET employer_last_read_at = NOW() WHERE id = ${id} AND tenant_id = ${tenantId}`;
    return c.json({ ok: true });
  });

  return router;
}

/** Load a conversation's messages (oldest→newest), tagging sender identity. */
async function loadMessages(db: Sql, conversationId: string, freelancerUserId: string) {
  const rows = await db`
    SELECT m.*, su.display_name AS sender_name
    FROM freelancer_messages m LEFT JOIN users su ON su.id = m.sender_user_id
    WHERE m.conversation_id = ${conversationId} ORDER BY m.created_at ASC LIMIT 500
  ` as unknown as Record<string, unknown>[];
  return rows.map((r) => mapMessage(r, freelancerUserId));
}

/** Find the scoped conversation for (tenant, freelancer, engagement|job) or create it.
 *  Engagement scope wins over job scope; a null-scope thread is always new (direct). */
async function getOrCreateConversation(db: Sql, input: {
  tenantId: number; freelancerUserId: string; employerUserId: string | null;
  subjectType: string; engagementId: string | null; jobId: string | null; proposalId: string | null;
  projectId: number | null; title: string | null;
}): Promise<Record<string, unknown>> {
  if (input.engagementId) {
    const [ex] = await db`SELECT * FROM freelancer_conversations WHERE tenant_id = ${input.tenantId} AND freelancer_user_id = ${input.freelancerUserId} AND engagement_id = ${input.engagementId}`;
    if (ex) return ex;
  } else if (input.jobId) {
    const [ex] = await db`SELECT * FROM freelancer_conversations WHERE tenant_id = ${input.tenantId} AND freelancer_user_id = ${input.freelancerUserId} AND job_id = ${input.jobId} AND engagement_id IS NULL`;
    if (ex) return ex;
  }
  const id = crypto.randomUUID();
  const [created] = await db`
    INSERT INTO freelancer_conversations (id, tenant_id, freelancer_user_id, employer_user_id, subject_type, engagement_id, job_id, proposal_id, project_id, title)
    VALUES (${id}, ${input.tenantId}, ${input.freelancerUserId}, ${input.employerUserId}, ${input.subjectType}, ${input.engagementId}, ${input.jobId}, ${input.proposalId}, ${input.projectId}, ${input.title})
    ON CONFLICT DO NOTHING
    RETURNING *
  `;
  if (created) return created;
  // Lost a race on the unique index — read the winner back.
  if (input.engagementId) {
    const [ex] = await db`SELECT * FROM freelancer_conversations WHERE tenant_id = ${input.tenantId} AND freelancer_user_id = ${input.freelancerUserId} AND engagement_id = ${input.engagementId}`;
    if (ex) return ex;
  } else if (input.jobId) {
    const [ex] = await db`SELECT * FROM freelancer_conversations WHERE tenant_id = ${input.tenantId} AND freelancer_user_id = ${input.freelancerUserId} AND job_id = ${input.jobId} AND engagement_id IS NULL`;
    if (ex) return ex;
  }
  const [any] = await db`SELECT * FROM freelancer_conversations WHERE id = ${id}`;
  return any as Record<string, unknown>;
}

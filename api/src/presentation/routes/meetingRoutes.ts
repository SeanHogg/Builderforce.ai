/**
 * Meetings — /api/meetings/*
 *
 * A meeting is a live video/audio gathering: a standup / planning / retrospective
 * bound to a project, an ad-hoc call, or a direct 1:1. It carries a media room key;
 * peers exchange WebRTC offers/answers/ICE candidates over the CeremonyRoomDO relay
 * keyed `media:<roomKey>` (mesh P2P — no media flows through the server). When the
 * organizer has a connected calendar, a scheduled meeting is mirrored as a calendar
 * event (invites go to attendee emails).
 *
 * Create + join are open to any workspace member (anyone can start a call). Mutating
 * a meeting's lifecycle (start/end/cancel/patch) is limited to the organizer or a
 * manager.
 */
import { Hono, type Context } from 'hono';
import { and, desc, eq, inArray, gte, lte, or, isNull } from 'drizzle-orm';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { authMiddleware, isManager } from '../middleware/authMiddleware';
import { scope } from './segmentTrackerRoutes';
import { meetings, meetingAttendees, userAvailability } from '../../infrastructure/database/schema';
import { relayToRoom } from './realtimeRelay';
import { pushMeetingEvent, deleteMeetingEvent } from '../../application/calendar/calendarService';
import type { CalendarProviderName } from '../../application/calendar/calendarProviders';
import { loadProjectTeamMembers } from '../../application/metrics/assigneeRecommender';
import {
  suggestSlots, normalizeWindows, type Availability, type BusyInterval,
} from '../../application/calendar/availabilitySolver';

const KINDS = new Set(['standup', 'planning', 'retrospective', 'adhoc', 'direct', 'interview', 'review']);

interface AttendeeInput { kind?: string; ref: string; name: string; email?: string; role?: string; }

/** WebRTC ICE server descriptor (the DOM `RTCIceServer` type is absent in the
 *  Workers lib, so declare the shape we serialize to the client). */
interface IceServer { urls: string | string[]; username?: string; credential?: string; }

/** ICE servers for mesh P2P — public STUN, plus a TURN relay when configured. */
function iceServers(env: Env): IceServer[] {
  const servers: IceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];
  if (env.TURN_URL) {
    servers.push({
      urls: env.TURN_URL.split(',').map((u) => u.trim()).filter(Boolean),
      username: env.TURN_USERNAME,
      credential: env.TURN_CREDENTIAL,
    });
  }
  return servers;
}

export function createMeetingRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();
  r.use('*', authMiddleware);

  // ── Media signaling relay + ICE config ─────────────────────────────────────
  // WebRTC offers/answers/ICE candidates fan out over the shared ceremony relay
  // DO (keyed distinctly per media room). No domain data flows through it.
  r.get('/rooms/:key/ws', (c) => relayToRoom(c, c.env?.CEREMONY_ROOM, `media:${c.req.param('key')}`));

  r.get('/ice', (c) => c.json({ iceServers: iceServers(c.env as Env) }));

  // ── Helpers ─────────────────────────────────────────────────────────────────
  async function hydrate(tenantId: number, id: string) {
    const [m] = await db.select().from(meetings)
      .where(and(eq(meetings.id, id), eq(meetings.tenantId, tenantId)));
    if (!m) return null;
    const attendees = await db.select().from(meetingAttendees).where(eq(meetingAttendees.meetingId, id));
    return { meeting: m, attendees };
  }

  /** Load a meeting the caller may mutate (organizer or manager), else null + status. */
  async function loadForMutation(c: Context<HonoEnv>, id: string) {
    const { tenantId } = scope(c);
    const [m] = await db.select().from(meetings).where(and(eq(meetings.id, id), eq(meetings.tenantId, tenantId)));
    if (!m) return { error: 'Not found' as const, code: 404 as const };
    const canMutate = isManager(c) || m.createdBy === (c.get('userId') ?? '');
    if (!canMutate) return { error: 'Only the organizer or a manager can change this meeting' as const, code: 403 as const };
    return { meeting: m };
  }

  /**
   * Authorization to VIEW/JOIN a meeting. Cross-tenant is already blocked (rows are
   * fetched by tenantId). Within the tenant a caller may access a meeting when they
   * are: a manager, the organizer, a listed attendee, or — for a project meeting —
   * a member of that project's team. A tenant-wide meeting (no project) is open to
   * any authenticated tenant member holding the link.
   */
  async function canAccess(
    c: Context<HonoEnv>,
    meeting: typeof meetings.$inferSelect,
    attendees: Array<typeof meetingAttendees.$inferSelect>,
  ): Promise<boolean> {
    const userId = (c.get('userId') as string) ?? '';
    if (isManager(c)) return true;
    if (meeting.createdBy === userId) return true;
    if (attendees.some((a) => a.memberRef === userId)) return true;
    if (meeting.projectId != null) {
      const members = await loadProjectTeamMembers(db, meeting.projectId, scope(c).tenantId);
      return members.some((m) => m.memberRef === userId);
    }
    return true; // tenant-wide meeting: any tenant member with the link
  }

  // ── List ─────────────────────────────────────────────────────────────────────
  // GET /?projectId=&scope=upcoming|all
  r.get('/', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const projectId = c.req.query('projectId');
    const view = c.req.query('scope') ?? 'upcoming';

    const conds = [eq(meetings.tenantId, tenantId), eq(meetings.segmentId, segmentId)];
    if (projectId) conds.push(eq(meetings.projectId, Number(projectId)));
    // Gig Marketplace (0293): a review/interview meeting is tracked against the exact
    // work item, posting, or engagement — filter the agenda to one of them.
    const ticketId = c.req.query('ticketId');
    const jobId = c.req.query('jobId');
    const engagementId = c.req.query('engagementId');
    if (ticketId) conds.push(eq(meetings.ticketId, Number(ticketId)));
    if (jobId) conds.push(eq(meetings.jobId, jobId));
    if (engagementId) conds.push(eq(meetings.engagementId, engagementId));
    if (view === 'upcoming') {
      // Upcoming or live: not ended/cancelled, and (no schedule OR scheduled in the
      // future OR still live).
      // Keep every live meeting, plus scheduled ones that are undated or still in
      // the future / within the last hour (grace for a just-started standup).
      const cutoff = new Date(Date.now() - 60 * 60 * 1000);
      conds.push(inArray(meetings.status, ['scheduled', 'live']));
      conds.push(or(eq(meetings.status, 'live'), isNull(meetings.scheduledAt), gte(meetings.scheduledAt, cutoff))!);
    }
    const rows = await db.select().from(meetings).where(and(...conds)).orderBy(desc(meetings.scheduledAt), desc(meetings.createdAt)).limit(100);

    // Attach attendees in one round-trip.
    const ids = rows.map((m) => m.id);
    const atts = ids.length ? await db.select().from(meetingAttendees).where(inArray(meetingAttendees.meetingId, ids)) : [];
    const byMeeting = new Map<string, typeof atts>();
    for (const a of atts) { const list = byMeeting.get(a.meetingId) ?? []; list.push(a); byMeeting.set(a.meetingId, list); }
    return c.json({ meetings: rows.map((m) => ({ meeting: m, attendees: byMeeting.get(m.id) ?? [] })) });
  });

  // ── Create / schedule ─────────────────────────────────────────────────────────
  r.post('/', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const env = c.env as Env;
    const userId = (c.get('userId') as string) ?? '';
    const body = await c.req.json<{
      title?: string;
      kind?: string;
      projectId?: number | null;
      scheduledAt?: string | null;
      durationMinutes?: number;
      videoEnabled?: boolean;
      attendees?: AttendeeInput[];
      organizerName?: string;
      organizerEmail?: string;
      // Gig Marketplace (0293): optional back-links so this meeting is tracked against
      // a work item / job posting / engagement (e.g. a review or interview).
      ticketId?: number | null;
      jobId?: string | null;
      engagementId?: string | null;
    }>();

    const kind = body.kind && KINDS.has(body.kind) ? body.kind : 'adhoc';
    const title = body.title?.trim() || defaultTitle(kind);
    const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
    const durationMinutes = Math.min(480, Math.max(5, body.durationMinutes ?? 30));
    const roomKey = crypto.randomUUID();

    const [meeting] = await db.insert(meetings).values({
      tenantId, segmentId,
      projectId: body.projectId ?? null,
      kind,
      title,
      scheduledAt,
      durationMinutes,
      status: 'scheduled',
      createdBy: userId,
      roomKey,
      videoEnabled: body.videoEnabled ?? true,
      ticketId: body.ticketId ?? null,
      jobId: body.jobId ?? null,
      engagementId: body.engagementId ?? null,
    }).returning();
    if (!meeting) return c.json({ error: 'Failed to create meeting' }, 500);

    // Organizer is always attendee #0 (host, auto-accepted). De-dupe by ref.
    const invited: AttendeeInput[] = [
      { kind: 'human', ref: userId, name: body.organizerName || 'Organizer', email: body.organizerEmail, role: 'host' },
      ...(body.attendees ?? []),
    ];
    const seen = new Set<string>();
    const rows = invited.filter((a) => a.ref && !seen.has(a.ref) && seen.add(a.ref)).map((a) => ({
      tenantId,
      meetingId: meeting.id,
      memberKind: a.kind ?? 'human',
      memberRef: a.ref,
      memberName: a.name,
      email: a.email ?? null,
      role: a.role === 'host' ? 'host' : 'attendee',
      response: a.ref === userId ? 'accepted' : 'invited',
    }));
    if (rows.length) await db.insert(meetingAttendees).values(rows);

    // Mirror scheduled meetings onto the organizer's calendar (best-effort).
    if (scheduledAt && userId) {
      const joinUrl = `${(env.APP_URL ?? 'https://builderforce.ai').replace(/\/$/, '')}/meetings?join=${meeting.id}`;
      const attendeeEmails = rows.map((a) => a.email).filter((e): e is string => !!e && e !== body.organizerEmail);
      const synced = await pushMeetingEvent(db, env, tenantId, userId, {
        title, startISO: scheduledAt.toISOString(),
        endISO: new Date(scheduledAt.getTime() + durationMinutes * 60_000).toISOString(),
        attendeeEmails, joinUrl,
      });
      if (synced) {
        await db.update(meetings).set({
          calendarProvider: synced.provider, calendarEventId: synced.eventId, calendarHtmlLink: synced.htmlLink ?? null, updatedAt: new Date(),
        }).where(eq(meetings.id, meeting.id));
      }
    }
    return c.json(await hydrate(tenantId, meeting.id), 201);
  });

  // ── Detail ─────────────────────────────────────────────────────────────────
  r.get('/:id', async (c) => {
    const { tenantId } = scope(c);
    const detail = await hydrate(tenantId, c.req.param('id'));
    if (!detail) return c.json({ error: 'Not found' }, 404);
    if (!(await canAccess(c, detail.meeting, detail.attendees))) return c.json({ error: 'Not authorized for this meeting' }, 403);
    return c.json(detail);
  });

  // ── Join — returns the room key + ICE config; marks presence + goes live ──────
  r.post('/:id/join', async (c) => {
    const { tenantId } = scope(c);
    const env = c.env as Env;
    const id = c.req.param('id');
    const userId = (c.get('userId') as string) ?? '';
    const body = await c.req.json<{ name?: string; email?: string }>().catch(() => ({} as { name?: string; email?: string }));
    const [m] = await db.select().from(meetings).where(and(eq(meetings.id, id), eq(meetings.tenantId, tenantId)));
    if (!m) return c.json({ error: 'Not found' }, 404);
    if (m.status === 'cancelled' || m.status === 'ended') return c.json({ error: `Meeting has ${m.status}` }, 409);

    // Only an authorized member (organizer / attendee / manager / project member)
    // may join — the "meeting link" alone is not enough.
    const existingAttendees = await db.select().from(meetingAttendees).where(eq(meetingAttendees.meetingId, id));
    if (!(await canAccess(c, m, existingAttendees))) return c.json({ error: 'Not authorized for this meeting' }, 403);

    const now = new Date();
    // First join flips a scheduled meeting live.
    if (m.status === 'scheduled') {
      await db.update(meetings).set({ status: 'live', startedAt: m.startedAt ?? now, updatedAt: now }).where(eq(meetings.id, id));
    }
    // Upsert my attendee row (walk-ins allowed) + stamp joinedAt.
    const [mine] = await db.select().from(meetingAttendees)
      .where(and(eq(meetingAttendees.meetingId, id), eq(meetingAttendees.memberRef, userId)));
    if (mine) {
      await db.update(meetingAttendees).set({ joinedAt: now, leftAt: null, response: 'accepted' }).where(eq(meetingAttendees.id, mine.id));
    } else {
      await db.insert(meetingAttendees).values({
        tenantId, meetingId: id, memberKind: 'human', memberRef: userId,
        memberName: body.name || 'Guest', email: body.email ?? null, role: 'attendee', response: 'accepted', joinedAt: now,
      });
    }
    return c.json({ roomKey: m.roomKey, videoEnabled: m.videoEnabled, iceServers: iceServers(env), meeting: await hydrate(tenantId, id) });
  });

  // ── Leave — stamp leftAt ─────────────────────────────────────────────────────
  r.post('/:id/leave', async (c) => {
    const { tenantId } = scope(c);
    const id = c.req.param('id');
    const userId = (c.get('userId') as string) ?? '';
    await db.update(meetingAttendees).set({ leftAt: new Date() })
      .where(and(eq(meetingAttendees.meetingId, id), eq(meetingAttendees.memberRef, userId), eq(meetingAttendees.tenantId, tenantId)));
    return c.body(null, 204);
  });

  // ── RSVP ─────────────────────────────────────────────────────────────────────
  r.post('/:id/rsvp', async (c) => {
    const { tenantId } = scope(c);
    const id = c.req.param('id');
    const userId = (c.get('userId') as string) ?? '';
    const { response } = await c.req.json<{ response: string }>();
    if (!['accepted', 'declined', 'tentative'].includes(response)) return c.json({ error: 'Invalid response' }, 400);
    await db.update(meetingAttendees).set({ response })
      .where(and(eq(meetingAttendees.meetingId, id), eq(meetingAttendees.memberRef, userId), eq(meetingAttendees.tenantId, tenantId)));
    return c.json(await hydrate(tenantId, id));
  });

  // ── Lifecycle: start / end / cancel (organizer or manager) ────────────────────
  r.post('/:id/start', async (c) => {
    const { tenantId } = scope(c);
    const res = await loadForMutation(c, c.req.param('id'));
    if ('error' in res) return c.json({ error: res.error }, res.code);
    const now = new Date();
    await db.update(meetings).set({ status: 'live', startedAt: res.meeting.startedAt ?? now, updatedAt: now }).where(eq(meetings.id, res.meeting.id));
    return c.json(await hydrate(tenantId, res.meeting.id));
  });

  r.post('/:id/end', async (c) => {
    const { tenantId } = scope(c);
    const res = await loadForMutation(c, c.req.param('id'));
    if ('error' in res) return c.json({ error: res.error }, res.code);
    const now = new Date();
    await db.update(meetings).set({ status: 'ended', endedAt: now, updatedAt: now }).where(eq(meetings.id, res.meeting.id));
    return c.json(await hydrate(tenantId, res.meeting.id));
  });

  r.post('/:id/cancel', async (c) => {
    const { tenantId } = scope(c);
    const env = c.env as Env;
    const res = await loadForMutation(c, c.req.param('id'));
    if ('error' in res) return c.json({ error: res.error }, res.code);
    const m = res.meeting;
    await db.update(meetings).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(meetings.id, m.id));
    // Remove the mirrored calendar event.
    if (m.calendarProvider && m.calendarEventId && m.createdBy) {
      await deleteMeetingEvent(db, env, tenantId, m.createdBy, m.calendarProvider as CalendarProviderName, m.calendarEventId);
    }
    return c.json(await hydrate(tenantId, m.id));
  });

  // ── Patch (title/schedule/duration) ──────────────────────────────────────────
  r.patch('/:id', async (c) => {
    const { tenantId } = scope(c);
    const res = await loadForMutation(c, c.req.param('id'));
    if ('error' in res) return c.json({ error: res.error }, res.code);
    const body = await c.req.json<{ title?: string; scheduledAt?: string | null; durationMinutes?: number; videoEnabled?: boolean }>();
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title != null) patch.title = body.title.trim();
    if (body.scheduledAt !== undefined) patch.scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
    if (body.durationMinutes != null) patch.durationMinutes = Math.min(480, Math.max(5, body.durationMinutes));
    if (body.videoEnabled != null) patch.videoEnabled = body.videoEnabled;
    await db.update(meetings).set(patch).where(eq(meetings.id, res.meeting.id));
    return c.json(await hydrate(tenantId, res.meeting.id));
  });

  // ── Availability windows (bookable working hours) ─────────────────────────────
  const DEFAULT_TZ = 'UTC';

  /** Load availability for a set of user refs (missing = "available anytime"). */
  async function loadAvailability(tenantId: number, refs: string[]): Promise<Availability[]> {
    if (refs.length === 0) return [];
    const rows = await db.select().from(userAvailability).where(and(
      eq(userAvailability.tenantId, tenantId), inArray(userAvailability.userId, refs),
    ));
    const byUser = new Map(rows.map((r) => [r.userId, r]));
    return refs.map((userId) => {
      const row = byUser.get(userId);
      return { userId, timezone: row?.timezone ?? DEFAULT_TZ, windows: normalizeWindows(row?.windows) };
    });
  }

  /** Busy intervals (epoch-ms) for each ref from scheduled/live meetings in a window. */
  async function loadBusy(tenantId: number, refs: string[], fromMs: number, toMs: number): Promise<Map<string, BusyInterval[]>> {
    const out = new Map<string, BusyInterval[]>();
    if (refs.length === 0) return out;
    const rows = await db
      .select({ ref: meetingAttendees.memberRef, scheduledAt: meetings.scheduledAt, duration: meetings.durationMinutes })
      .from(meetingAttendees)
      .innerJoin(meetings, eq(meetings.id, meetingAttendees.meetingId))
      .where(and(
        eq(meetings.tenantId, tenantId),
        inArray(meetingAttendees.memberRef, refs),
        inArray(meetings.status, ['scheduled', 'live']),
        gte(meetings.scheduledAt, new Date(fromMs)),
        lte(meetings.scheduledAt, new Date(toMs)),
      ));
    for (const row of rows) {
      if (!row.scheduledAt) continue;
      const start = row.scheduledAt.getTime();
      const list = out.get(row.ref) ?? [];
      list.push({ start, end: start + (row.duration ?? 30) * 60_000 });
      out.set(row.ref, list);
    }
    return out;
  }

  // GET /availability/me — my declared windows + timezone.
  r.get('/availability/me', async (c) => {
    const { tenantId } = scope(c);
    const userId = (c.get('userId') as string) ?? '';
    const [row] = await db.select().from(userAvailability)
      .where(and(eq(userAvailability.tenantId, tenantId), eq(userAvailability.userId, userId)));
    return c.json({ timezone: row?.timezone ?? DEFAULT_TZ, windows: normalizeWindows(row?.windows) });
  });

  // PUT /availability/me — upsert my windows.
  r.put('/availability/me', async (c) => {
    const { tenantId } = scope(c);
    const userId = (c.get('userId') as string) ?? '';
    const body = await c.req.json<{ timezone?: string; windows?: unknown }>();
    const timezone = (body.timezone && body.timezone.length <= 64) ? body.timezone : DEFAULT_TZ;
    const windows = normalizeWindows(body.windows);
    await db.insert(userAvailability).values({ tenantId, userId, timezone, windows })
      .onConflictDoUpdate({
        target: [userAvailability.tenantId, userAvailability.userId],
        set: { timezone, windows, updatedAt: new Date() },
      });
    return c.json({ timezone, windows });
  });

  // GET /availability?refs=a,b,c — windows for multiple users (find-a-time inputs).
  r.get('/availability', async (c) => {
    const { tenantId } = scope(c);
    const refs = (c.req.query('refs') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50);
    return c.json({ availability: await loadAvailability(tenantId, refs) });
  });

  // GET /freebusy?refs=&from=&to= — declared windows + busy blocks per attendee.
  r.get('/freebusy', async (c) => {
    const { tenantId } = scope(c);
    const refs = (c.req.query('refs') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50);
    const fromMs = Date.parse(c.req.query('from') ?? '') || Date.now();
    const toMs = Date.parse(c.req.query('to') ?? '') || (fromMs + 14 * 86_400_000);
    const [availability, busy] = await Promise.all([
      loadAvailability(tenantId, refs),
      loadBusy(tenantId, refs, fromMs, toMs),
    ]);
    return c.json({
      availability,
      busy: refs.map((userId) => ({ userId, intervals: (busy.get(userId) ?? []).map((b) => ({ startISO: new Date(b.start).toISOString(), endISO: new Date(b.end).toISOString() })) })),
    });
  });

  // GET /suggest?refs=&durationMinutes=&from=&to=&count= — proposed slots for all.
  r.get('/suggest', async (c) => {
    const { tenantId } = scope(c);
    const refs = (c.req.query('refs') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50);
    if (refs.length === 0) return c.json({ slots: [] });
    const durationMinutes = Math.min(480, Math.max(5, Number(c.req.query('durationMinutes') ?? 30)));
    const fromMs = Date.parse(c.req.query('from') ?? '') || Date.now();
    const toMs = Date.parse(c.req.query('to') ?? '') || (fromMs + 14 * 86_400_000);
    const count = Math.min(20, Math.max(1, Number(c.req.query('count') ?? 6)));
    const [availability, busy] = await Promise.all([
      loadAvailability(tenantId, refs),
      loadBusy(tenantId, refs, fromMs, toMs),
    ]);
    const slots = suggestSlots(availability, busy, { fromMs, toMs, durationMinutes, count });
    return c.json({ slots });
  });

  return r;
}

function defaultTitle(kind: string): string {
  switch (kind) {
    case 'standup': return 'Daily Standup';
    case 'planning': return 'Planning Session';
    case 'retrospective': return 'Retrospective';
    case 'direct': return 'Direct Call';
    case 'interview': return 'Interview';
    case 'review': return 'Review';
    default: return 'Meeting';
  }
}

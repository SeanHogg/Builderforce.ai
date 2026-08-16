import { describe, expect, it, vi, beforeEach } from 'vitest';

// Superadmin gate → pass-through in tests (its real behaviour is covered by the
// middleware's own tests); we only assert the route logic here.
vi.mock('../middleware/superAdminMiddleware', () => ({
  superAdminMiddleware: async (c: any, next: any) => { c.set('userId', 'sa-1'); await next(); },
}));

// Same treatment for the web-session gate — the signed-in beta endpoints only
// need A user, and whose session it is has its own tests.
vi.mock('../middleware/webAuthMiddleware', () => ({
  webAuthMiddleware: async (c: any, next: any) => { c.set('userId', 'u-1'); await next(); },
}));

const svc = vi.hoisted(() => ({
  listPublishedReleaseNotes: vi.fn(),
  listAllReleaseNotes: vi.fn(),
  createReleaseNote: vi.fn(),
  updateReleaseNote: vi.fn(),
  deleteReleaseNote: vi.fn(),
}));
vi.mock('../../application/product/releaseNotes', async (orig) => ({
  ...(await orig<typeof import('../../application/product/releaseNotes')>()),
  ...svc,
}));

const betas = vi.hoisted(() => ({
  listBetaProgramsForUser: vi.fn(),
  setBetaEnrollment: vi.fn(),
  countBetaParticipants: vi.fn(),
}));
vi.mock('../../application/product/releaseNoteBetas', async (orig) => ({
  ...(await orig<typeof import('../../application/product/releaseNoteBetas')>()),
  ...betas,
}));

const digest = vi.hoisted(() => ({ runReleaseDigest: vi.fn() }));
vi.mock('../../application/email/releaseDigest', () => digest);

const seen = vi.hoisted(() => ({
  countUnreadReleaseNotes: vi.fn(async () => 0),
  markReleaseNotesSeen: vi.fn(async () => {}),
}));
vi.mock('../../application/product/releaseNoteSeen', () => seen);

import { createReleaseNoteRoutes } from './releaseNoteRoutes';

const db = {} as any;
const post = (b: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const put = (b: unknown) => ({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

const NOTE = {
  id: 'n1', version: '2026.7.93', title: 'Ship it', body: 'Body', category: 'new',
  stage: 'live', betaOptIn: false, betaTerms: null, stageEndsAt: null,
  publishedAt: '2026-07-24T00:00:00.000Z', emailedAt: null,
  createdAt: '2026-07-24T00:00:00.000Z', updatedAt: '2026-07-24T00:00:00.000Z',
};

/** A published, opt-in public beta — the only shape the join endpoint accepts. */
const BETA = {
  ...NOTE, id: 'b1', title: 'New look', stage: 'public_beta', betaOptIn: true,
  betaTerms: 'Beta terms text', myStatus: null, agreedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  betas.countBetaParticipants.mockResolvedValue({});
});

describe('releaseNoteRoutes', () => {
  it('GET / returns published notes WITHOUT the internal emailedAt flag', async () => {
    svc.listPublishedReleaseNotes.mockResolvedValue([{ ...NOTE, emailedAt: '2026-07-25T00:00:00.000Z' }]);
    const res = await createReleaseNoteRoutes(db).request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as { releaseNotes: any[] };
    expect(body.releaseNotes).toHaveLength(1);
    expect('emailedAt' in body.releaseNotes[0]).toBe(false);
    expect(body.releaseNotes[0].title).toBe('Ship it');
  });

  it('POST / rejects a note with no version or title', async () => {
    const res = await createReleaseNoteRoutes(db).request('/', post({ title: 'No version' }));
    expect(res.status).toBe(400);
    expect(svc.createReleaseNote).not.toHaveBeenCalled();
  });

  it('POST / rejects an unknown category', async () => {
    const res = await createReleaseNoteRoutes(db).request('/', post({ version: '1', title: 'x', category: 'bogus' }));
    expect(res.status).toBe(400);
  });

  it('POST / creates a published note', async () => {
    svc.createReleaseNote.mockResolvedValue(NOTE);
    const res = await createReleaseNoteRoutes(db).request('/', post({ version: '2026.7.93', title: 'Ship it', category: 'new', publish: true }));
    expect(res.status).toBe(201);
    expect(svc.createReleaseNote).toHaveBeenCalledTimes(1);
    expect(svc.createReleaseNote.mock.calls[0]![2]).toEqual(
      expect.objectContaining({ version: '2026.7.93', title: 'Ship it', publish: true, category: 'new' }),
    );
  });

  it('PUT /:id returns 404 when the note is missing', async () => {
    svc.updateReleaseNote.mockResolvedValue(null);
    const res = await createReleaseNoteRoutes(db).request('/nope', put({ title: 'x' }));
    expect(res.status).toBe(404);
  });

  it('DELETE /:id returns 404 when nothing was removed', async () => {
    svc.deleteReleaseNote.mockResolvedValue(false);
    const res = await createReleaseNoteRoutes(db).request('/nope', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('POST /send-digest runs the full digest and returns its result', async () => {
    digest.runReleaseDigest.mockResolvedValue({ notes: 2, recipients: 5, sent: 4, suppressed: 1, failed: 0 });
    const res = await createReleaseNoteRoutes(db).request('/send-digest', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: { notes: 2, recipients: 5, sent: 4, suppressed: 1, failed: 0 } });
    // No note-id restriction → the full unsent-published digest.
    expect(digest.runReleaseDigest).toHaveBeenCalledWith(undefined, db);
  });

  it('POST /:id/send emails just that note and scopes the run to its id', async () => {
    digest.runReleaseDigest.mockResolvedValue({ notes: 1, recipients: 5, sent: 5, suppressed: 0, failed: 0 });
    const res = await createReleaseNoteRoutes(db).request('/n1/send', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(digest.runReleaseDigest).toHaveBeenCalledWith(undefined, db, { noteIds: ['n1'] });
  });

  it('POST /:id/send 404s when the id is not a published note (0 sent)', async () => {
    digest.runReleaseDigest.mockResolvedValue({ notes: 0, recipients: 0, sent: 0, suppressed: 0, failed: 0 });
    const res = await createReleaseNoteRoutes(db).request('/draft-1/send', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('POST / rejects an unknown stage', async () => {
    const res = await createReleaseNoteRoutes(db).request('/', post({ version: '1', title: 'x', stage: 'nearly_done' }));
    expect(res.status).toBe(400);
    expect(svc.createReleaseNote).not.toHaveBeenCalled();
  });

  it('POST / carries the beta authoring fields through', async () => {
    svc.createReleaseNote.mockResolvedValue(BETA);
    const res = await createReleaseNoteRoutes(db).request('/', post({
      version: '1', title: 'New look', stage: 'public_beta', betaOptIn: true,
      betaTerms: 'Beta terms text', stageEndsAt: '2026-08-31T00:00:00.000Z', publish: true,
    }));
    expect(res.status).toBe(201);
    expect(svc.createReleaseNote.mock.calls[0]![2]).toEqual(expect.objectContaining({
      stage: 'public_beta', betaOptIn: true, betaTerms: 'Beta terms text',
      stageEndsAt: '2026-08-31T00:00:00.000Z',
    }));
  });

  it('GET /admin reports how many people are in each beta', async () => {
    svc.listAllReleaseNotes.mockResolvedValue([NOTE, BETA]);
    betas.countBetaParticipants.mockResolvedValue({ b1: 7 });
    const res = await createReleaseNoteRoutes(db).request('/admin');
    const body = await res.json() as { releaseNotes: { id: string; participants: number }[] };
    expect(body.releaseNotes.map((n) => [n.id, n.participants])).toEqual([['n1', 0], ['b1', 7]]);
    // Only opt-in notes can have participants, so only those are counted.
    expect(betas.countBetaParticipants).toHaveBeenCalledWith(db, ['b1']);
  });

  it('GET /betas returns the user\'s betas, which one earns the banner, and the unread count', async () => {
    betas.listBetaProgramsForUser.mockResolvedValue([BETA]);
    seen.countUnreadReleaseNotes.mockResolvedValue(3);
    const res = await createReleaseNoteRoutes(db).request('/betas');
    expect(res.status).toBe(200);
    // Both halves of "what does this person need told?" on ONE signed-in read —
    // the badge never costs a second request for a single integer.
    expect(await res.json()).toEqual({ betas: [BETA], bannerBetaId: 'b1', unreadCount: 3 });
  });

  it('POST /seen marks the changelog read for the session\'s own user', async () => {
    const res = await createReleaseNoteRoutes(db).request('/seen', { method: 'POST' });
    expect(res.status).toBe(200);
    // The user comes from the session and the clock is the server's: a
    // client-supplied timestamp would let a caller un-read their own badge.
    expect(seen.markReleaseNotesSeen).toHaveBeenCalledWith(db, 'u-1');
  });

  it('POST /:id/beta rejects an unknown action', async () => {
    const res = await createReleaseNoteRoutes(db).request('/b1/beta', post({ action: 'lurk' }));
    expect(res.status).toBe(400);
    expect(betas.setBetaEnrollment).not.toHaveBeenCalled();
  });

  it('POST /:id/beta refuses to enrol anyone who has not accepted the terms', async () => {
    const res = await createReleaseNoteRoutes(db).request('/b1/beta', post({ action: 'join' }));
    expect(res.status).toBe(400);
    expect(betas.setBetaEnrollment).not.toHaveBeenCalled();
  });

  it('POST /:id/beta 404s for an id that is not an open beta', async () => {
    betas.listBetaProgramsForUser.mockResolvedValue([BETA]);
    const res = await createReleaseNoteRoutes(db).request('/n1/beta', post({ action: 'join', agreed: true }));
    expect(res.status).toBe(404);
    expect(betas.setBetaEnrollment).not.toHaveBeenCalled();
  });

  it('POST /:id/beta joins an agreed user', async () => {
    betas.listBetaProgramsForUser.mockResolvedValue([BETA]);
    betas.setBetaEnrollment.mockResolvedValue({ status: 'joined', agreedAt: '2026-08-01T00:00:00.000Z' });
    const res = await createReleaseNoteRoutes(db).request('/b1/beta', post({ action: 'join', agreed: true }));
    expect(res.status).toBe(200);
    expect(betas.setBetaEnrollment).toHaveBeenCalledWith(db, expect.objectContaining({ userId: 'u-1', status: 'joined' }));
    expect(await res.json()).toEqual({
      enrollment: { releaseNoteId: 'b1', status: 'joined', agreedAt: '2026-08-01T00:00:00.000Z' },
    });
  });

  it('POST /:id/beta dismisses without any agreement', async () => {
    betas.listBetaProgramsForUser.mockResolvedValue([BETA]);
    betas.setBetaEnrollment.mockResolvedValue({ status: 'dismissed', agreedAt: null });
    const res = await createReleaseNoteRoutes(db).request('/b1/beta', post({ action: 'dismiss' }));
    expect(res.status).toBe(200);
    expect(betas.setBetaEnrollment).toHaveBeenCalledWith(db, expect.objectContaining({ status: 'dismissed' }));
  });
});

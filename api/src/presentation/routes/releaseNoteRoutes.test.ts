import { describe, expect, it, vi, beforeEach } from 'vitest';

// Superadmin gate → pass-through in tests (its real behaviour is covered by the
// middleware's own tests); we only assert the route logic here.
vi.mock('../middleware/superAdminMiddleware', () => ({
  superAdminMiddleware: async (c: any, next: any) => { c.set('userId', 'sa-1'); await next(); },
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

const digest = vi.hoisted(() => ({ runReleaseDigest: vi.fn() }));
vi.mock('../../application/email/releaseDigest', () => digest);

import { createReleaseNoteRoutes } from './releaseNoteRoutes';

const db = {} as any;
const post = (b: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const put = (b: unknown) => ({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

const NOTE = {
  id: 'n1', version: '2026.7.93', title: 'Ship it', body: 'Body', category: 'new',
  publishedAt: '2026-07-24T00:00:00.000Z', emailedAt: null,
  createdAt: '2026-07-24T00:00:00.000Z', updatedAt: '2026-07-24T00:00:00.000Z',
};

beforeEach(() => vi.clearAllMocks());

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
});

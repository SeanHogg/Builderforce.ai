import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The weekly digest inlines every note's full body, so the size of ONE email is
 * decided by how many notes are unsent — which is not bounded by how often we
 * publish. Migration 0474 published 23 notes in one batch; these tests pin that
 * the cron path drains a backlog over several digests, stamps only what it
 * actually mailed, and that a superadmin naming ids is still obeyed exactly.
 */

const notesSvc = vi.hoisted(() => ({
  listUnsentPublishedReleaseNotes: vi.fn(),
  listPublishedReleaseNotesByIds: vi.fn(),
  markReleaseNotesEmailed: vi.fn(async () => {}),
}));
vi.mock('../product/releaseNotes', async (orig) => ({
  ...(await orig<typeof import('../product/releaseNotes')>()),
  ...notesSvc,
}));

/** Consent/suppression have their own tests; here every recipient is mailable. */
vi.mock('./sendEmail', () => ({
  sendLifecycleEmail: vi.fn(async (_env, _db, _to, _category, factory) => {
    await factory({ unsubscribeUrl: 'https://example.test/u', locale: 'en' });
    return 'sent';
  }),
}));

const mail = vi.hoisted(() => ({ sendReleaseDigestEmail: vi.fn(async (..._args: unknown[]) => {}) }));
vi.mock('../../infrastructure/email/EmailService', () => mail);

vi.mock('../../env', async (orig) => ({
  ...(await orig<typeof import('../../env')>()),
  resolveAppBaseUrl: () => 'https://example.test',
}));

import { runReleaseDigest } from './releaseDigest';

const note = (n: number) => ({
  id: `n${n}`,
  version: '2026.8.23',
  title: `Note ${n}`,
  body: 'Body',
  category: 'new',
  stage: 'live',
  betaOptIn: false,
  betaTerms: null,
  stageEndsAt: null,
  publishedAt: `2026-08-15T00:00:${String(n).padStart(2, '0')}.000Z`,
  emailedAt: null,
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
});

/** One verified recipient — the audience read is a `select().from().where()`. */
const db = {
  select: () => ({
    from: () => ({
      where: async () => [{ email: 'a@example.test', displayName: 'A', username: 'a', locale: 'en' }],
    }),
  }),
} as any;

const env = {} as any;

/** The notes carried by the one email this run sent. */
function mailedItems(): Array<{ title: string }> {
  return mail.sendReleaseDigestEmail.mock.calls[0]![3] as Array<{ title: string }>;
}

beforeEach(() => {
  vi.clearAllMocks();
  notesSvc.markReleaseNotesEmailed.mockResolvedValue(undefined);
});

describe('runReleaseDigest', () => {
  it('carries at most eight notes and stamps only those, leaving the rest for next week', async () => {
    const backlog = Array.from({ length: 23 }, (_, i) => note(i + 1));
    notesSvc.listUnsentPublishedReleaseNotes.mockResolvedValue(backlog);

    const result = await runReleaseDigest(env, db);

    expect(result.notes).toBe(8);
    expect(mailedItems().map((i) => i.title)).toEqual([
      'Note 1', 'Note 2', 'Note 3', 'Note 4', 'Note 5', 'Note 6', 'Note 7', 'Note 8',
    ]);
    // The 15 it did not send stay unstamped, so the next run picks them up —
    // capping must never silently drop an announcement.
    expect(notesSvc.markReleaseNotesEmailed).toHaveBeenCalledWith(
      env, db, ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8'],
    );
  });

  it('sends everything when the backlog is under the cap', async () => {
    notesSvc.listUnsentPublishedReleaseNotes.mockResolvedValue([note(1), note(2)]);

    const result = await runReleaseDigest(env, db);

    expect(result.notes).toBe(2);
    expect(notesSvc.markReleaseNotesEmailed).toHaveBeenCalledWith(env, db, ['n1', 'n2']);
  });

  it('does not cap the per-note admin trigger — named ids are an instruction', async () => {
    const picked = Array.from({ length: 12 }, (_, i) => note(i + 1));
    notesSvc.listPublishedReleaseNotesByIds.mockResolvedValue(picked);

    const result = await runReleaseDigest(env, db, { noteIds: picked.map((n) => n.id) });

    expect(result.notes).toBe(12);
    expect(mailedItems()).toHaveLength(12);
    expect(notesSvc.listUnsentPublishedReleaseNotes).not.toHaveBeenCalled();
  });

  it('sends nothing at all in a quiet week', async () => {
    notesSvc.listUnsentPublishedReleaseNotes.mockResolvedValue([]);

    const result = await runReleaseDigest(env, db);

    expect(result).toEqual({ notes: 0, recipients: 0, sent: 0, suppressed: 0, failed: 0 });
    expect(mail.sendReleaseDigestEmail).not.toHaveBeenCalled();
    expect(notesSvc.markReleaseNotesEmailed).not.toHaveBeenCalled();
  });
});

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

/**
 * A fake Postgres just large enough for a KEYSET walk.
 *
 * The audience is paged now (`where(... id > cursor).orderBy(id).limit(n)`), and
 * progress is written to `release_digest_runs` between batches, so the mock has
 * to serve two different selects and remember the run row — a single canned
 * array would make the pagination assertions vacuous.
 */
type Recipient = { id: string; email: string; displayName: string; username: string; locale: string };

const recipient = (n: number): Recipient => ({
  id: `u${String(n).padStart(4, '0')}`,
  email: `u${n}@example.test`,
  displayName: `U${n}`,
  username: `u${n}`,
  locale: 'en',
});

interface FakeRun {
  id: string;
  noteKey: string;
  status: string;
  cursorUserId: string | null;
  recipients: number;
  sent: number;
  suppressed: number;
  failed: number;
}

class FakeDb {
  audience: Recipient[] = [recipient(1)];
  runs: FakeRun[] = [];
  /** Every keyset page this run asked for, as (cursor, size). */
  pages: Array<{ cursor: string | null; size: number }> = [];
  progressWrites = 0;

  select(columns?: Record<string, unknown>) {
    const wantsRun = !!columns && 'cursorUserId' in columns;
    return {
      from: () => {
        if (wantsRun) {
          const self = this;
          return {
            where: (_w: unknown) => ({
              limit: async () => self.runs.filter((r) => r.status === 'running').slice(0, 1),
            }),
          };
        }
        const self = this;
        let cursor: string | null = null;
        const builder: any = {
          where: (_w: unknown) => {
            // The runner appends `gt(users.id, cursor)` only when it has one;
            // read the cursor off the open run instead of parsing drizzle SQL.
            const open = self.runs.find((r) => r.status === 'running');
            cursor = open?.cursorUserId ?? null;
            return builder;
          },
          orderBy: () => builder,
          limit: async (n: number) => {
            const rows = self.audience.filter((r) => (cursor ? r.id > cursor : true)).slice(0, n);
            self.pages.push({ cursor, size: rows.length });
            return rows;
          },
        };
        return builder;
      },
    };
  }

  insert(_table: unknown) {
    const self = this;
    return {
      values: (row: { noteKey: string }) => ({
        returning: async () => {
          const created: FakeRun = {
            id: `run-${self.runs.length + 1}`, noteKey: row.noteKey, status: 'running',
            cursorUserId: null, recipients: 0, sent: 0, suppressed: 0, failed: 0,
          };
          self.runs.push(created);
          return [{ id: created.id }];
        },
      }),
    };
  }

  update(_table: unknown) {
    const self = this;
    return {
      set: (patch: Partial<FakeRun>) => ({
        where: async () => {
          const open = self.runs.find((r) => r.status === 'running');
          if (open) Object.assign(open, patch);
          if (patch.cursorUserId !== undefined) self.progressWrites += 1;
        },
      }),
    };
  }
}

let fake: FakeDb;
let db: any;

/** Run `fn` with the pacing sleeps collapsed by draining the fake timer queue. */
async function runPaced<T>(fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    const promise = fn();
    // Loop: each drained sleep schedules the next batch, which schedules the
    // next sleep, so one pass is not enough for a 25-batch walk.
    let settled = false;
    void promise.then(() => { settled = true; });
    while (!settled) {
      await vi.advanceTimersByTimeAsync(5_000);
    }
    return await promise;
  } finally {
    vi.useRealTimers();
  }
}

const env = {} as any;

/** The notes carried by the one email this run sent. */
function mailedItems(): Array<{ title: string }> {
  return mail.sendReleaseDigestEmail.mock.calls[0]![3] as Array<{ title: string }>;
}

beforeEach(() => {
  vi.clearAllMocks();
  notesSvc.markReleaseNotesEmailed.mockResolvedValue(undefined);
  fake = new FakeDb();
  db = fake as any;
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

  it('walks the audience by keyset and persists the cursor between batches', async () => {
    // 250 recipients: three keyset pages of 100/100/50, and 25 batches of 10 —
    // so 25 cursor writes. The old code read all 250 in ONE query and wrote no
    // progress at all, which is why an eviction re-sent the whole list.
    fake.audience = Array.from({ length: 250 }, (_, i) => recipient(i + 1));
    notesSvc.listUnsentPublishedReleaseNotes.mockResolvedValue([note(1)]);

    // Fake timers: the runner paces itself to hold Resend's rate window, and in
    // a test every send resolves instantly, so the pacing would otherwise be the
    // whole runtime of this file. Draining the timer queue asserts the pacing
    // exists without paying for it.
    const result = await runPaced(() => runReleaseDigest(env, db));

    expect(result.recipients).toBe(250);
    expect(result.sent).toBe(250);
    expect(result.complete).toBe(true);
    expect(fake.pages.map((p) => p.size)).toEqual([100, 100, 50]);
    expect(fake.pages[0]!.cursor).toBeNull();
    expect(fake.pages[1]!.cursor).toBe('u0100');
    expect(fake.pages[2]!.cursor).toBe('u0200');
    expect(fake.progressWrites).toBe(25);
    expect(notesSvc.markReleaseNotesEmailed).toHaveBeenCalledWith(env, db, ['n1']);
  });

  it('resumes an interrupted run at its cursor instead of re-mailing everyone', async () => {
    // Exactly the eviction case: a run that already mailed the first 60 of 100.
    fake.audience = Array.from({ length: 100 }, (_, i) => recipient(i + 1));
    fake.runs.push({
      id: 'run-prior', noteKey: 'n1', status: 'running', cursorUserId: 'u0060',
      recipients: 60, sent: 60, suppressed: 0, failed: 0,
    });
    notesSvc.listUnsentPublishedReleaseNotes.mockResolvedValue([note(1)]);

    const result = await runPaced(() => runReleaseDigest(env, db));

    // 40 NEW messages, and the totals carry the 60 the interrupted run already sent.
    expect(mail.sendReleaseDigestEmail).toHaveBeenCalledTimes(40);
    expect(result.recipients).toBe(100);
    expect(result.sent).toBe(100);
    expect(result.complete).toBe(true);
    // No second run row: the same note set is the same send.
    expect(fake.runs).toHaveLength(1);
    expect(fake.runs[0]!.status).toBe('completed');
  });

  it('sends nothing at all in a quiet week', async () => {
    notesSvc.listUnsentPublishedReleaseNotes.mockResolvedValue([]);

    const result = await runReleaseDigest(env, db);

    expect(result).toEqual({ notes: 0, recipients: 0, sent: 0, suppressed: 0, failed: 0, complete: true });
    expect(mail.sendReleaseDigestEmail).not.toHaveBeenCalled();
    expect(notesSvc.markReleaseNotesEmailed).not.toHaveBeenCalled();
  });
});

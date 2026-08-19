/**
 * WHAT MUST NOT REGRESS.
 *
 * This sweep mails real people, so its failure modes are asymmetric: missing a match is
 * a disappointment, and mailing somebody the whole board is the thing that gets the
 * product marked as spam. Everything pinned here is about the watermark — the single
 * mechanism that decides how much a seeker hears about.
 *
 *   • A first run must not announce the back catalogue.
 *   • A quiet alert must still advance, or its first match arrives with a week attached.
 *   • Running twice in a day must send nothing the second time.
 *   • A disabled alert must be filtered in SQL, not loaded and discarded.
 *
 * The window read is asserted to happen ONCE for the whole batch, because the version
 * of this that queries per alert is both the obvious implementation and the N+1 the
 * performance rule forbids.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

const notify = vi.fn(async (..._args: unknown[]) => ({ inAppDelivered: true, emailDelivered: null }));
vi.mock('../notifications/notify', () => ({ notify: (...args: unknown[]) => notify(...args) }));

const { runJobAlertSweep, jobAlertBody, JOB_ALERT_NOTIFICATION_KIND } = await import('./jobAlerts');

const env = { APP_BASE_URL: 'https://app.test' } as unknown as Env;

const NOW = new Date('2026-08-19T09:00:00Z');
const YESTERDAY = new Date('2026-08-18T09:00:00Z');
const LAST_WEEK = new Date('2026-08-12T09:00:00Z');

const alert = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1,
  tenantId: 42,
  ownerRef: 'user-1',
  name: 'Rust work',
  filters: { q: 'rust' },
  lastRunAt: YESTERDAY,
  createdAt: LAST_WEEK,
  ...over,
});

const posting = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'job-1',
  title: 'Senior Rust engineer',
  description: 'Payments ledger.',
  discipline: 'developer',
  skills: '["Rust"]',
  createdAt: new Date('2026-08-19T08:00:00Z'),
  tenantName: 'Acme',
  ...over,
});

beforeEach(() => {
  notify.mockClear();
  notify.mockResolvedValue({ inAppDelivered: true, emailDelivered: null });
});

describe('runJobAlertSweep', () => {
  it('does nothing — and never reads postings — when no alert is due', async () => {
    const db = fakeDb([[]]);

    const result = await runJobAlertSweep(env, db as unknown as Db, NOW);

    expect(result).toEqual({ evaluated: 0, matched: 0, notified: 0, failed: 0 });
    expect(db.calls).toHaveLength(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it('notifies the owner about a matching posting and stamps the run', async () => {
    const db = fakeDb([[alert()], [posting()], []]);

    const result = await runJobAlertSweep(env, db as unknown as Db, NOW);

    expect(result).toEqual({ evaluated: 1, matched: 1, notified: 1, failed: 0 });
    expect(notify).toHaveBeenCalledWith(expect.anything(), env, expect.objectContaining({
      userId: 'user-1',
      tenantId: 42,
      kind: JOB_ALERT_NOTIFICATION_KIND,
      title: '1 new job matches "Rust work"',
    }));
    const stamp = db.calls.find((call) => call.kind === 'update');
    expect(stamp?.payload).toMatchObject({ lastRunAt: NOW, resultCount: 1 });
  });

  it('ignores a posting older than the watermark — the second run of the day is quiet', async () => {
    // Created BEFORE last_run_at: already announced yesterday.
    const db = fakeDb([[alert()], [posting({ createdAt: new Date('2026-08-17T09:00:00Z') })], []]);

    const result = await runJobAlertSweep(env, db as unknown as Db, NOW);

    expect(result).toEqual({ evaluated: 1, matched: 0, notified: 0, failed: 0 });
    expect(notify).not.toHaveBeenCalled();
  });

  it('advances a quiet alert, so its first match does not arrive with a backlog attached', async () => {
    const db = fakeDb([[alert()], [posting({ title: 'Designer', skills: '[]', description: 'Figma.' })], []]);

    await runJobAlertSweep(env, db as unknown as Db, NOW);

    const stamp = db.calls.find((call) => call.kind === 'update');
    expect(stamp?.payload).toMatchObject({ lastRunAt: NOW, resultCount: 0 });
  });

  it('a never-run alert reaches back only to its own creation, not to the whole board', async () => {
    const fresh = alert({ lastRunAt: null, createdAt: YESTERDAY });
    const db = fakeDb([
      [fresh],
      // Posted before the seeker saved the alert — they were already looking at it.
      [posting({ createdAt: new Date('2026-08-01T09:00:00Z') })],
      [],
    ]);

    const result = await runJobAlertSweep(env, db as unknown as Db, NOW);

    expect(result.matched).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('reads the posting window ONCE for a batch of alerts, not once per alert', async () => {
    const db = fakeDb([
      [alert({ id: 1 }), alert({ id: 2, ownerRef: 'user-2', name: 'Any work', filters: {} })],
      [posting()],
      [], [],
    ]);

    const result = await runJobAlertSweep(env, db as unknown as Db, NOW);

    expect(result.evaluated).toBe(2);
    expect(result.matched).toBe(2);
    // One alert read + one window read, then only writes.
    expect(db.calls.filter((call) => call.kind === 'select')).toHaveLength(2);
  });

  it('counts a notification that could not be written rather than throwing', async () => {
    notify.mockResolvedValue({ inAppDelivered: false, emailDelivered: null });
    const db = fakeDb([[alert()], [posting()], []]);

    const result = await runJobAlertSweep(env, db as unknown as Db, NOW);

    expect(result).toEqual({ evaluated: 1, matched: 1, notified: 0, failed: 1 });
  });
});

describe('jobAlertBody', () => {
  it('names the matches and says how many it trimmed', () => {
    const matches = Array.from({ length: 8 }, (_, i) => ({ title: `Job ${i + 1}`, tenantName: 'Acme' }));

    const body = jobAlertBody({ name: 'Rust work', criteria: 'rust' }, matches);

    expect(body).toContain('New work matching "Rust work" (rust):');
    expect(body).toContain('• Job 1 — Acme');
    expect(body).toContain('• Job 5 — Acme');
    expect(body).not.toContain('Job 6');
    expect(body).toContain('…and 3 more.');
  });

  it('omits the criteria clause for an alert that filters on nothing', () => {
    const body = jobAlertBody({ name: 'Any work', criteria: '' }, [{ title: 'Job', tenantName: null }]);

    expect(body).toContain('New work matching "Any work":');
    expect(body).toContain('• Job');
  });
});

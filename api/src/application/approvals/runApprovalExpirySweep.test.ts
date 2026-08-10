import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runApprovalExpirySweep } from './runApprovalExpirySweep';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

vi.mock('../approval/approvalNotifier', () => ({
  sendSlackNotification: vi.fn().mockResolvedValue(undefined),
}));
import { sendSlackNotification } from '../approval/approvalNotifier';

const slack = vi.mocked(sendSlackNotification);

/** Minimal Drizzle chain stub: select→from→where resolves `rows`; update is recorded. */
function stubDb(rows: unknown[]) {
  const updates: unknown[] = [];
  const db = {
    select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }),
    update: () => ({ set: (v: unknown) => ({ where: () => { updates.push(v); return Promise.resolve(); } }) }),
  } as unknown as Db;
  return { db, updates };
}

const row = (id: string, tenantId: number, actionType = 'clarify.blocked') =>
  ({ id, tenantId, actionType, description: `q ${id}`, status: 'pending' });

describe('runApprovalExpirySweep', () => {
  beforeEach(() => slack.mockClear());

  it('is a no-op when nothing has expired — no update, no notification', async () => {
    const { db, updates } = stubDb([]);
    const res = await runApprovalExpirySweep({ SLACK_APPROVAL_WEBHOOK_URL: 'https://hook' } as Env, db);
    expect(res).toEqual({ escalated: 0, tenants: 0 });
    expect(updates).toHaveLength(0);
    expect(slack).not.toHaveBeenCalled();
  });

  it('expires overdue approvals and reports the count', async () => {
    const { db, updates } = stubDb([row('a', 1), row('b', 1)]);
    const res = await runApprovalExpirySweep({} as Env, db);
    expect(res.escalated).toBe(2);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ status: 'expired' });
  });

  /**
   * The fan-out groups by tenant so one workspace never sees another's approvals in
   * its Slack message — the sweep is deliberately cross-tenant in its QUERY only.
   */
  it('notifies once per tenant, never mixing tenants in one message', async () => {
    const { db } = stubDb([row('a', 1), row('b', 2), row('c', 1)]);
    const res = await runApprovalExpirySweep({ SLACK_APPROVAL_WEBHOOK_URL: 'https://hook' } as Env, db);
    expect(res).toEqual({ escalated: 3, tenants: 2 });
    expect(slack).toHaveBeenCalledTimes(2);
    const bodies = slack.mock.calls.map((c) => String(c[1]));
    // Tenant 1 got both of its rows; tenant 2's message mentions only its own.
    expect(bodies.some((b) => b.includes('q a') && b.includes('q c') && !b.includes('q b'))).toBe(true);
    expect(bodies.some((b) => b.includes('q b') && !b.includes('q a'))).toBe(true);
  });

  it('still reports the expiry when the Slack webhook fails', async () => {
    slack.mockRejectedValueOnce(new Error('webhook down'));
    const { db, updates } = stubDb([row('a', 1)]);
    // The status change is already committed, so a notification outage must not
    // throw out of the sweep and abort the rest of the cron tick.
    const res = await runApprovalExpirySweep({ SLACK_APPROVAL_WEBHOOK_URL: 'https://hook' } as Env, db);
    expect(res.escalated).toBe(1);
    expect(updates).toHaveLength(1);
  });

  it('expires without notifying when no webhook is configured', async () => {
    const { db, updates } = stubDb([row('a', 1)]);
    const res = await runApprovalExpirySweep({} as Env, db);
    expect(res.escalated).toBe(1);
    expect(updates).toHaveLength(1);
    expect(slack).not.toHaveBeenCalled();
  });
});

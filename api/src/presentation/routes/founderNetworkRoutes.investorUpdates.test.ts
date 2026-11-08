/**
 * The investor-update router is manager-and-above: a developer is refused on BOTH the
 * preview read and the send, and a manager gets the tenant-scoped pending milestones.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const caller = vi.hoisted(() => ({ role: 'developer' }));
vi.mock('../middleware/authMiddleware', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../middleware/authMiddleware')>()),
  authMiddleware: async (c: any, next: any) => {
    c.set('tenantId', 77);
    c.set('userId', 'user-1');
    c.set('role', caller.role);
    await next();
  },
}));

const pending = vi.hoisted(() => ({ pendingInvestorMilestones: vi.fn() }));
vi.mock('../../application/investor/investorMilestones', () => pending);
const send = vi.hoisted(() => ({ sendInvestorUpdate: vi.fn() }));
vi.mock('../../application/investor/investorUpdateDelivery', () => send);

import { errorHandler } from '../middleware/errorHandler';
import { createInvestorUpdateRoutes } from './founderNetworkRoutes';

/** The error handler reads `c.env` for CORS; an empty binding set is enough. */
const ENV = {} as never;

const app = () => {
  const root = new Hono();
  // The app's own handler maps ForbiddenError to 403; a DomainError carries no `status`.
  root.onError(errorHandler as never);
  root.route('/', createInvestorUpdateRoutes({} as never));
  return root;
};

beforeEach(() => {
  pending.pendingInvestorMilestones.mockReset().mockResolvedValue({ since: 's', until: 'u', milestones: [], moreCount: 0 });
  send.sendInvestorUpdate.mockReset().mockResolvedValue({ sent: 0, failed: [], transport: 'platform', fromLabel: 'x' });
});

describe('investor update routes authorization', () => {
  it('refuses a developer on the pending-milestones read and on send', async () => {
    caller.role = 'developer';
    expect((await app().request('/milestones/pending', {}, ENV)).status).toBe(403);
    const sent = await app().request('/send', { method: 'POST', body: JSON.stringify({ content: { title: 'T' } }), headers: { 'content-type': 'application/json' } }, ENV);
    expect(sent.status).toBe(403);
    expect(pending.pendingInvestorMilestones).not.toHaveBeenCalled();
    expect(send.sendInvestorUpdate).not.toHaveBeenCalled();
  });

  it('serves a manager the pending milestones for their own tenant', async () => {
    caller.role = 'manager';
    const res = await app().request('/milestones/pending', {}, ENV);
    expect(res.status).toBe(200);
    expect(pending.pendingInvestorMilestones).toHaveBeenCalledWith(expect.anything(), 77, expect.any(Date));
  });
});

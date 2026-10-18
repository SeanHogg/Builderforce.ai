/**
 * `requestApproval` is the one write path behind both `POST /api/approvals` and the
 * legacy agent-host `/:id/approval-request` door, so the guards the host door used
 * to skip are pinned here for every caller.
 */
import { describe, expect, it, vi } from 'vitest';
import { requestApproval } from './requestApproval';

function fakeDb(rules: unknown[] = []) {
  const inserted: Record<string, unknown>[] = [];
  const db = {
    select: () => ({ from: () => ({ where: () => Promise.resolve(rules) }) }),
    insert: () => ({ values: (v: Record<string, unknown>) => { inserted.push(v); return Promise.resolve(undefined); } }),
  };
  return { db: db as never, inserted };
}

const relayFetch = vi.fn(() => Promise.resolve(new Response('ok')));
const env = {
  AGENT_HOST_RELAY: { idFromName: (n: string) => n, get: () => ({ fetch: relayFetch }) },
} as never;

const machine = { tenantId: 7, agentHostId: 42, callerUserId: null } as const;

describe('requestApproval', () => {
  it('refuses a request without actionType/description', async () => {
    const { db, inserted } = fakeDb();
    const result = await requestApproval(db, env, { ...machine, actionType: 'deploy' });
    expect(result).toMatchObject({ ok: false, httpStatus: 400 });
    expect(inserted).toHaveLength(0);
  });

  it('refuses a forged task.execution gate from an agent host (the old host door accepted it)', async () => {
    const { db, inserted } = fakeDb();
    const result = await requestApproval(db, env, { ...machine, actionType: 'task.execution', description: 'run #1' });
    expect(result).toMatchObject({ ok: false, httpStatus: 400 });
    expect(inserted).toHaveLength(0);
  });

  it('refuses a self-owned approval raised by a machine key', async () => {
    const { db } = fakeDb();
    const result = await requestApproval(db, env, { ...machine, actionType: 'synapse.step', description: 'click' });
    expect(result).toMatchObject({ ok: false, httpStatus: 403 });
  });

  it('applies the auto-approval rules to a host-raised request', async () => {
    const { db, inserted } = fakeDb([{ actionType: 'deploy', maxEstimatedCost: null, maxFilesChanged: null }]);
    const result = await requestApproval(db, env, { ...machine, actionType: 'deploy', description: 'ship it' });
    expect(result).toMatchObject({ ok: true, status: 'approved' });
    expect(inserted[0]).toMatchObject({ status: 'approved', reviewedBy: 'auto-approval-rule', requestedBy: '42', agentHostId: 42 });
  });

  it('leaves a question pending even when a rule would match', async () => {
    const { db, inserted } = fakeDb([{ actionType: null, maxEstimatedCost: null, maxFilesChanged: null }]);
    const result = await requestApproval(db, env, { ...machine, kind: 'question', actionType: 'ask', description: 'which db?' });
    expect(result).toMatchObject({ ok: true, status: 'pending', kind: 'question' });
    expect(inserted[0]).toMatchObject({ status: 'pending' });
  });
});

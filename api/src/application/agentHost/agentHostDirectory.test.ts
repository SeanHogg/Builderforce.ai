import { describe, expect, it, vi } from 'vitest';
import { listAgentHostDirectory } from './agentHostDirectory';
import type { AgentHostService } from './AgentHostService';

/**
 * ONE host list behind `/api/agent-hosts`, `/api/tenants/:id/agentHosts` and
 * `/api/projects/:id/agentHosts`. Pins the filters each alias relies on and the
 * enriched row the tenant alias used to compute on its own.
 */

const recent = new Date();
const host = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  name: `host-${id}`,
  slug: `host-${id}`,
  status: 'active',
  connectedAt: recent,
  lastSeenAt: recent,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  capabilities: ['remote-dispatch'],
  declaredCapabilities: null,
  ...extra,
});

function fakes(hosts: ReturnType<typeof host>[], links: { agentHostId: number; projectId: number }[]) {
  const listAgentHostsForTenant = vi.fn(async () => hosts);
  const service = { listAgentHostsForTenant } as unknown as AgentHostService;
  const db = { select: () => ({ from: () => ({ where: async () => links }) }) } as never;
  return { service, db, listAgentHostsForTenant };
}

describe('listAgentHostDirectory', () => {
  it('passes a recognised status through and ignores anything else', async () => {
    const f = fakes([], []);
    await listAgentHostDirectory(f.db, { tenantId: 7, status: ' Offline ' }, f.service);
    await listAgentHostDirectory(f.db, { tenantId: 7, status: 'bogus' }, f.service);
    expect(f.listAgentHostsForTenant.mock.calls).toEqual([[7, 'offline'], [7, null]]);
  });

  it('joins project links and derives the capability summary', async () => {
    const f = fakes([host(1), host(2, { capabilities: null })], [
      { agentHostId: 1, projectId: 10 },
      { agentHostId: 1, projectId: 11 },
      { agentHostId: 2, projectId: 10 },
    ]);
    const [h1, h2] = await listAgentHostDirectory(f.db, { tenantId: 7 }, f.service);
    expect(h1).toMatchObject({ id: 1, projectIds: [10, 11], online: true, capabilitySummary: { distributed: true, remoteDispatch: true, projectCount: 2 } });
    expect(h2).toMatchObject({ id: 2, capabilities: [], declaredCapabilities: [], capabilitySummary: { distributed: false, remoteDispatch: false, projectCount: 1 } });
  });

  it('filters to one project for the project alias', async () => {
    const f = fakes([host(1), host(2)], [{ agentHostId: 2, projectId: 10 }]);
    const rows = await listAgentHostDirectory(f.db, { tenantId: 7, projectId: 10 }, f.service);
    expect(rows.map((r) => r.id)).toEqual([2]);
  });

  it('skips the link query when the tenant has no hosts', async () => {
    const f = fakes([], []);
    const select = vi.fn();
    expect(await listAgentHostDirectory({ select } as never, { tenantId: 7 }, f.service)).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });
});

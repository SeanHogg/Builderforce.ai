import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ agent: vi.fn(async (..._a: unknown[]) => ({ runtimeSupport: 'both' }) as unknown) }));
vi.mock('./cloudAgentEngine', () => ({
  resolveCloudAgent: h.agent,
  agentAllowsHostExecution: (rs: string | undefined) => rs !== 'cloud',
}));

import { isHostBoundRun, wouldRunOnHost } from './runHostBinding';

beforeEach(() => { h.agent.mockClear(); h.agent.mockResolvedValue({ runtimeSupport: 'both' }); });

describe('runHostBinding — the dispatcher\'s own routing rule', () => {
  it('a pinned host AND an agent that may run on one → host-bound', () => {
    expect(isHostBoundRun(5, 'both')).toBe(true);
    expect(isHostBoundRun(5, 'cloud')).toBe(false);
    expect(isHostBoundRun(null, 'both')).toBe(false);
  });

  it('a host-ASSIGNED ticket runs on the host even with no host on the request (the run-now case)', async () => {
    expect(await wouldRunOnHost({} as never, 7, { task: { assignedAgentHostId: 5, assignedAgentRef: 'agent-1' } })).toBe(true);
    expect(h.agent).toHaveBeenCalledWith({}, 7, 'agent-1');
  });

  it('a cloud-only agent stays in the cloud despite a pinned host', async () => {
    h.agent.mockResolvedValue({ runtimeSupport: 'cloud' });
    expect(await wouldRunOnHost({} as never, 7, { agentHostId: 5, task: { assignedAgentHostId: null, assignedAgentRef: 'agent-1' } })).toBe(false);
  });

  it('the payload\'s cloud agent is the one asked, like the dispatcher', async () => {
    await wouldRunOnHost({} as never, 7, { agentHostId: 5, task: { assignedAgentHostId: null, assignedAgentRef: 'a' }, payload: JSON.stringify({ cloudAgentRef: 'b' }) });
    expect(h.agent).toHaveBeenCalledWith({}, 7, 'b');
  });

  it('a pinned host with no named agent is host-bound (the default agent is not known yet — conservative)', async () => {
    expect(await wouldRunOnHost({} as never, 7, { task: { assignedAgentHostId: 5, assignedAgentRef: null } })).toBe(true);
    expect(h.agent).not.toHaveBeenCalled();
  });

  it('no pinned host → a cloud run', async () => {
    expect(await wouldRunOnHost({} as never, 7, { task: { assignedAgentHostId: null, assignedAgentRef: 'a' } })).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  agentHosts: { list: vi.fn().mockResolvedValue([{ id: 1 }]) },
  tasksApi: { list: vi.fn().mockResolvedValue([{ id: 2 }]) },
}));
vi.mock('./builderforceApi', () => api);

import { readAgentHosts, readTasks } from './dashboardReads';

describe('dashboard reads', () => {
  it('coalesces concurrent mounts onto one request per endpoint', async () => {
    const hosts = await Promise.all([readAgentHosts(), readAgentHosts(), readAgentHosts()]);
    const tasks = await Promise.all([readTasks(), readTasks()]);
    expect(api.agentHosts.list).toHaveBeenCalledTimes(1);
    expect(api.tasksApi.list).toHaveBeenCalledTimes(1);
    expect(hosts[2]).toEqual([{ id: 1 }]);
    expect(tasks[1]).toEqual([{ id: 2 }]);
  });
});

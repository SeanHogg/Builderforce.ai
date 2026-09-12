import { describe, it, expect } from 'vitest';
import { poolAgentsFrom, loadAgentPoolVia, AGENT_POOL_PATHS } from './agentPool';

describe('poolAgentsFrom', () => {
  it('dedupes owned + purchased by id and keeps only active registered agents', () => {
    const pool = poolAgentsFrom({
      owned: [{ id: 1, name: 'Builder', title: 'Engineer', base_model: 'openai/gpt-5' }],
      purchased: [{ id: 1, name: 'Builder', title: 'Engineer', base_model: 'openai/gpt-5' }, { id: 2, name: 'Scout', base_model: 'builderforce-default' }],
      registered: [{ id: 7, name: 'Laptop', type: 'host', isActive: true }, { id: 8, name: 'Old', type: 'host', isActive: false }],
    });
    expect(pool).toEqual([
      { kind: 'workforce', ref: '1', name: 'Builder', meta: 'Engineer', baseModel: 'openai/gpt-5' },
      { kind: 'workforce', ref: '2', name: 'Scout', meta: 'builderforce-default', baseModel: null },
      { kind: 'registered', ref: '7', name: 'Laptop', meta: 'host', baseModel: null },
    ]);
  });
});

describe('loadAgentPoolVia', () => {
  it('lets each source fail on its own', async () => {
    const request = async <T,>(path: string): Promise<T> => {
      if (path === AGENT_POOL_PATHS.owned) return [{ id: 1, name: 'Builder', base_model: null }] as T;
      throw new Error('down');
    };
    await expect(loadAgentPoolVia(request)).resolves.toEqual([
      { kind: 'workforce', ref: '1', name: 'Builder', meta: '', baseModel: null },
    ]);
  });
});

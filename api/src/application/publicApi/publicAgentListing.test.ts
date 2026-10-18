import { describe, expect, it } from 'vitest';
import { pagePublicAgents, toPublicApiAgent } from './publicAgentListing';

/**
 * `/api/v1/agents` is a view over the cached public marketplace listing. These pin
 * that it keeps the historical response keys, never ships internal columns, and
 * pages/filters without a second query.
 */

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Agent ${id}`,
  title: 'Writer',
  bio: 'Drafts release notes',
  skills: '["copywriting","seo"]',
  base_model: 'm',
  status: 'active',
  hire_count: 3,
  published: true,
  tenant_id: 99,
  role_keys: '["secret"]',
  psychometric: '{"x":1}',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  ...extra,
});

describe('toPublicApiAgent', () => {
  it('keeps the original endpoint keys beside the marketplace projection', () => {
    const a = toPublicApiAgent(row('a1'));
    expect(a).toMatchObject({ id: 'a1', name: 'Agent a1', type: 'workforce', isActive: true, createdAt: '2026-01-01T00:00:00.000Z' });
    expect(a.skills).toEqual(['copywriting', 'seo']);
  });

  it('never ships tenant or dispatch internals', () => {
    const a = toPublicApiAgent(row('a1'));
    expect(a).not.toHaveProperty('tenant_id');
    expect(a).not.toHaveProperty('role_keys');
    expect(a).not.toHaveProperty('psychometric');
  });
});

describe('pagePublicAgents', () => {
  const rows = Array.from({ length: 30 }, (_, i) => row(`a${i}`, i === 7 ? { skills: '["python"]', name: 'Py helper' } : {}));

  it('pages with the same clamps the endpoint always used', () => {
    const p = pagePublicAgents(rows, { page: '2', limit: '10' });
    expect(p).toMatchObject({ total: 30, page: 2, limit: 10 });
    expect(p.agents.map((a) => a.id)).toEqual(rows.slice(10, 20).map((r) => r.id));
    expect(pagePublicAgents(rows, { limit: '1000' }).limit).toBe(100);
    expect(pagePublicAgents(rows, { page: '-3' }).page).toBe(1);
  });

  it('filters by skill and keyword before paging', () => {
    expect(pagePublicAgents(rows, { skill: 'PYTHON' }).agents.map((a) => a.id)).toEqual(['a7']);
    const byQ = pagePublicAgents(rows, { q: 'py help' });
    expect(byQ.total).toBe(1);
    expect(byQ.agents[0]?.id).toBe('a7');
  });
});

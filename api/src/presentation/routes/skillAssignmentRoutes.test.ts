/**
 * Host-scope skill assignments answer at the canonical kebab `/agent-hosts/*` and at
 * the camelCase `/agentHosts/*` alias — the SAME handlers — with only the alias
 * carrying the deprecation signals.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('tenantId', 3);
    c.set('userId', 'user-1');
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));

const port = vi.hoisted(() => ({
  assignSkill: vi.fn(),
  listAssignedSkills: vi.fn(),
  marketplaceSkillExists: vi.fn(),
  unassignSkill: vi.fn(),
}));
vi.mock('../../application/skills/skillAssignmentPort', () => port);
vi.mock('../../application/agentHost/agentHostDirectory', () => ({ agentHostInTenant: vi.fn(async () => true) }));

import { createSkillAssignmentRoutes } from './skillAssignmentRoutes';

const app = () => createSkillAssignmentRoutes({} as any);

beforeEach(() => {
  port.listAssignedSkills.mockReset().mockResolvedValue([{ skillSlug: 'lint' }]);
  port.marketplaceSkillExists.mockReset().mockResolvedValue(true);
  port.assignSkill.mockReset().mockResolvedValue(undefined);
  port.unassignSkill.mockReset().mockResolvedValue(undefined);
});

describe('skill assignments — host scope', () => {
  it('serves the canonical kebab path without a deprecation notice', async () => {
    const res = await app().request('/agent-hosts/5');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ agentHostId: 5, assignments: [{ skillSlug: 'lint' }] });
    expect(res.headers.get('deprecation')).toBeNull();
    expect(port.listAssignedSkills).toHaveBeenCalledWith({}, 3, { scope: 'host', agentHostId: 5 });
  });

  it('keeps the camelCase alias on the same handler, naming the kebab successor', async () => {
    const res = await app().request('/agentHosts/5');
    expect(res.status).toBe(200);
    expect(res.headers.get('deprecation')).toBe('true');
    expect(res.headers.get('link')).toBe('</agent-hosts/5>; rel="successor-version"');
  });

  it('assigns and revokes through the kebab path', async () => {
    const post = await app().request('/agent-hosts/5', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skillSlug: 'lint' }),
    });
    expect(post.status).toBe(201);
    expect(port.assignSkill).toHaveBeenCalledWith(undefined, {}, 3, { scope: 'host', agentHostId: 5 }, { skillSlug: 'lint', assignedBy: 'user-1' });

    const del = await app().request('/agent-hosts/5/lint', { method: 'DELETE' });
    expect(del.status).toBe(204);
    expect(port.unassignSkill).toHaveBeenCalledWith(undefined, {}, 3, { scope: 'host', agentHostId: 5 }, 'lint');
  });

  it('the alias DELETE still works (deprecated)', async () => {
    const del = await app().request('/agentHosts/5/lint', { method: 'DELETE' });
    expect(del.status).toBe(204);
    expect(del.headers.get('deprecation')).toBe('true');
  });
});

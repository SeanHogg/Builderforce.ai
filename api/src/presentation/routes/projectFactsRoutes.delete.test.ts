/**
 * `DELETE /:projectId/facts/:key` (PRD 38 §8.3): the fact's author or a project admin may
 * delete it, another non-admin member is refused with 403, and a delete removes the fact's
 * relations too. Driven through the real `deleteKnowledgeFact` use case.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TenantRole } from '../../domain/shared/types';

const TENANT = 8;
const mocks = vi.hoisted(() => ({
  owned: vi.fn(),
  deleteFact: vi.fn(async () => true),
  superadmin: vi.fn(async () => false),
  actor: { userId: 'u1', role: 'developer' as string },
  store: {
    factAuthor: vi.fn(),
    deleteRelationsOf: vi.fn(async () => 2),
  },
}));

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('tenantId', TENANT); c.set('userId', mocks.actor.userId); c.set('role', mocks.actor.role);
    await next();
  },
}));
vi.mock('../../application/project/projectOwnership', () => ({ projectInTenantCached: mocks.owned }));
vi.mock('../../infrastructure/auth/superadminFlag', () => ({ resolveIsSuperadmin: mocks.superadmin }));
vi.mock('../../application/llm/projectFactsWrite', () => ({ upsertProjectFact: vi.fn(), deleteProjectFact: mocks.deleteFact }));
vi.mock('../../application/knowledge/knowledgeVersion', () => ({ bumpKnowledgeVersion: vi.fn(async () => undefined), knowledgeVersion: vi.fn() }));
vi.mock('../../application/knowledge/knowledgeWritePorts', () => ({
  knowledgeWritePortsFor: () => ({ store: mocks.store, extracted: {} }),
}));
vi.mock('../../application/llm/projectMemory', () => ({ cacheProjectAnswer: vi.fn(), resolveMemoryAnswer: vi.fn() }));
vi.mock('../../application/llm/evermindRuntime', () => ({}));

import { createProjectFactsRoutes } from './projectFactsRoutes';

const del = () => createProjectFactsRoutes({} as never).request('/42/facts/claim%3Ax', { method: 'DELETE' }, {});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.owned.mockResolvedValue(true);
  mocks.actor.userId = 'u1';
  mocks.actor.role = TenantRole.DEVELOPER;
  mocks.store.factAuthor.mockResolvedValue('u1');
  mocks.deleteFact.mockResolvedValue(true);
});

describe('DELETE /:projectId/facts/:key', () => {
  it('lets the author delete, removing the fact and its relations', async () => {
    const res = await del();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, removed: true, relationsRemoved: 2, key: 'claim:x' });
    expect(mocks.store.deleteRelationsOf).toHaveBeenCalledWith('fact:claim:x');
    expect(mocks.deleteFact).toHaveBeenCalledTimes(1);
  });

  it('refuses another non-admin member with 403, deleting nothing', async () => {
    mocks.store.factAuthor.mockResolvedValue('someone-else');
    const res = await del();
    expect(res.status).toBe(403);
    expect(mocks.store.deleteRelationsOf).not.toHaveBeenCalled();
    expect(mocks.deleteFact).not.toHaveBeenCalled();
  });

  it('lets a project admin delete another person’s fact, relations included', async () => {
    mocks.store.factAuthor.mockResolvedValue('someone-else');
    mocks.actor.role = TenantRole.MANAGER;
    const res = await del();
    expect(res.status).toBe(200);
    expect(mocks.store.deleteRelationsOf).toHaveBeenCalledWith('fact:claim:x');
    expect(mocks.deleteFact).toHaveBeenCalledTimes(1);
  });
});

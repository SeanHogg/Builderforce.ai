/**
 * Project facts is ONE router served through two front doors. The JWT door and the
 * agent-host door reach the same recall core; the host door refuses a missing key
 * and never gates other routers sharing `/api/agent/projects`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 8;
const mocks = vi.hoisted(() => ({ hostAuth: vi.fn(), recall: vi.fn(), owned: vi.fn() }));

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => { c.set('tenantId', TENANT); c.set('userId', 'u1'); await next(); },
}));
vi.mock('../../infrastructure/auth/agentHostAuth', () => ({ resolveHostAuth: mocks.hostAuth }));
vi.mock('../../infrastructure/auth/segmentResolver', () => ({ resolveSegment: async () => 'seg-1' }));
vi.mock('../../application/project/projectOwnership', () => ({ projectInTenantCached: mocks.owned }));
vi.mock('../../application/llm/projectFacts', () => ({
  recallProjectFacts: mocks.recall, upsertProjectFact: vi.fn(), deleteProjectFact: vi.fn(),
}));
vi.mock('../../application/llm/projectMemory', () => ({}));
vi.mock('../../application/llm/memoryAnswerSavings', () => ({}));
vi.mock('../../application/llm/savingsLedger', () => ({}));
vi.mock('../../application/llm/evermindRuntime', () => ({}));

const { createProjectFactsRoutes } = await import('./projectFactsRoutes');
const { agentHostDoor } = await import('../middleware/frontDoor');

const db = {} as never;
const facts = [{ key: 'k', content: 'c' }];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.owned.mockResolvedValue(true);
  mocks.recall.mockResolvedValue(facts);
  mocks.hostAuth.mockResolvedValue({ id: 3, tenantId: TENANT });
});

describe('project facts front doors', () => {
  it('JWT door recalls through the shared core', async () => {
    const res = await createProjectFactsRoutes(db).request('/42/facts', {}, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ facts });
    expect(mocks.recall.mock.calls[0]![2]).toBe(TENANT);
  });

  it('agent-host door recalls through the same core with the host tenant', async () => {
    const res = await createProjectFactsRoutes(db, agentHostDoor(db)).request('/42/facts', {}, {});
    expect(res.status).toBe(200);
    expect(mocks.recall.mock.calls[0]![2]).toBe(TENANT);
  });

  it('agent-host door refuses a request without a host key', async () => {
    mocks.hostAuth.mockResolvedValue(null);
    const res = await createProjectFactsRoutes(db, agentHostDoor(db)).request('/42/facts', {}, {});
    expect(res.status).toBe(401);
    expect(mocks.recall).not.toHaveBeenCalled();
  });

  it('agent-host door leaves other paths on the shared mount ungated', async () => {
    mocks.hostAuth.mockResolvedValue(null);
    const res = await createProjectFactsRoutes(db, agentHostDoor(db)).request('/42/run-context', {}, {});
    expect(res.status).toBe(404);
  });
});

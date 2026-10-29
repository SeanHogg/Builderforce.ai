import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `POST …/evermind/learning/candidates/:candidateId/transfer` at the HTTP edge: the pipeline's
 * answer is passed through, and above all a 409 refusal because a PERSON authored the fact
 * carries `code: 'fact_owned_by_person'` — the manager UI branches on that code, not the text.
 */

const TENANT = 5;
const mocks = vi.hoisted(() => ({
  transfer: vi.fn(),
  owned: vi.fn(),
}));

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => { c.set('tenantId', TENANT); await next(); },
  requireRole: () => async (_c: any, next: any) => next(),
}));
vi.mock('../middleware/featureGate', () => ({ requireFrontierAccess: vi.fn(async () => null) }));
vi.mock('../../application/project/projectOwnership', () => ({ projectInTenantCached: mocks.owned }));
vi.mock('../../application/llm/evermindLearningPipeline', () => ({ transferLearningCandidate: mocks.transfer }));
vi.mock('../../application/llm/evermindRecipes', () => ({}));
vi.mock('../../application/llm/evermindRuntime', () => ({}));
vi.mock('../../application/llm/evermindAnalyzer', () => ({}));
vi.mock('../../application/llm/projectFactsAnswerCache', () => ({}));

const { createProjectEvermindRoutes } = await import('./projectEvermindRoutes');

const db = {} as never;
const transfer = (candidateId: string | number = 9) =>
  createProjectEvermindRoutes(db).request(`/42/evermind/learning/candidates/${candidateId}/transfer`, { method: 'POST' }, {});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.owned.mockResolvedValue(true);
});

describe('POST /:projectId/evermind/learning/candidates/:candidateId/transfer', () => {
  it('answers 409 with code fact_owned_by_person when a person authored the fact', async () => {
    mocks.transfer.mockResolvedValue({
      ok: false, status: 409, code: 'fact_owned_by_person',
      error: "the fact 'k' was written by a person and is not overwritten by a learning",
    });
    const res = await transfer();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "the fact 'k' was written by a person and is not overwritten by a learning",
      code: 'fact_owned_by_person',
    });
    expect(mocks.transfer.mock.calls[0]![2]).toBe(TENANT);
    expect(mocks.transfer.mock.calls[0]![3]).toBe(42);
    expect(mocks.transfer.mock.calls[0]![4]).toBe(9);
  });

  it('carries no code on a refusal that has none (a store outage is not an ownership conflict)', async () => {
    mocks.transfer.mockResolvedValue({ ok: false, status: 503, error: 'project facts store refused the learning' });
    const res = await transfer();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'project facts store refused the learning' });
  });

  it('returns the transferred candidate on success', async () => {
    mocks.transfer.mockResolvedValue({ ok: true, id: 9 });
    const res = await transfer();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: 9 });
  });

  it('rejects a bad candidate id before the pipeline runs', async () => {
    const res = await transfer('abc');
    expect(res.status).toBe(400);
    expect(mocks.transfer).not.toHaveBeenCalled();
  });
});

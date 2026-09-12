import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `POST /:projectId/evermind/coding-eval` — the write path from builderforce-memory's
 * EvalHarness into the Evermind coding-quality gate (operator decision 2026-09-12:
 * Evermind serves IDE coding turns only at ≥ 90% of the frontier baseline). Pins that
 * only a matched pair of reports is recorded, and that an eval of a head the project
 * has since moved past is refused rather than stored.
 */

const TENANT = 5;
const mocks = vi.hoisted(() => ({ record: vi.fn(), effectiveId: vi.fn(), owned: vi.fn() }));

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => { c.set('tenantId', TENANT); await next(); },
  requireRole: () => async (_c: any, next: any) => next(),
}));
vi.mock('../middleware/featureGate', () => ({ requireFrontierAccess: vi.fn(async () => null) }));
vi.mock('../../infrastructure/auth/agentHostAuth', () => ({ resolveHostAuth: vi.fn() }));
vi.mock('../../application/project/projectOwnership', () => ({ loadProjectInTenant: mocks.owned }));
vi.mock('../../application/llm/evermindCodingEvalStore', () => ({ recordProjectEvermindCodingEval: mocks.record }));
vi.mock('../../application/llm/projectEvermind', () => ({ resolveEffectiveEvermindProjectId: mocks.effectiveId }));
vi.mock('../../application/llm/evermindRecipes', () => ({}));
vi.mock('../../application/llm/evermindRuntime', () => ({}));
vi.mock('../../application/llm/evermindAnalyzer', () => ({}));
vi.mock('../../application/llm/projectFacts', () => ({}));

const { createProjectEvermindRoutes } = await import('./projectEvermindRoutes');

const db = {} as never;
const post = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const report = (meanScore: number, dataset = 'coding-v1', cases = 40) => ({ dataset, meanScore, cases: Array.from({ length: cases }, () => ({})) });
const BODY = { version: 12, evermind: report(0.72), baseline: report(0.8), baselineModel: 'claude-opus-5' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.owned.mockResolvedValue({ id: 42 });
  mocks.effectiveId.mockImplementation(async (_e: unknown, _d: unknown, _t: number, projectId: number) => projectId);
  mocks.record.mockResolvedValue({ ok: true, gate: { qualified: true, reason: 'qualified', bar: 0.9, ratio: 0.9, headVersion: 12, evaluatedVersion: 12 } });
});

describe('POST /:projectId/evermind/coding-eval', () => {
  it('records a matched pair of EvalHarness reports and returns the gate verdict', async () => {
    const res = await createProjectEvermindRoutes(db).request('/42/evermind/coding-eval', post(BODY), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, codingGate: { qualified: true, bar: 0.9 } });
    const [, , tenantId, projectId, ev] = mocks.record.mock.calls[0]!;
    expect({ tenantId, projectId }).toEqual({ tenantId: TENANT, projectId: 42 });
    expect(ev).toMatchObject({ version: 12, score: 0.72, baselineScore: 0.8, dataset: 'coding-v1', baselineModel: 'claude-opus-5' });
  });

  it('rejects reports from two different evals without recording anything', async () => {
    const res = await createProjectEvermindRoutes(db).request('/42/evermind/coding-eval', post({ ...BODY, baseline: report(0.8, 'other-set') }), {});
    expect(res.status).toBe(400);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('answers 409 + headVersion when a merge moved the head past the evaluated version', async () => {
    mocks.record.mockResolvedValue({ ok: false, status: 409, headVersion: 13, error: 'stale' });
    const res = await createProjectEvermindRoutes(db).request('/42/evermind/coding-eval', post(BODY), {});
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ headVersion: 13 });
  });

  it('refuses a build that only inherits its container’s Evermind', async () => {
    mocks.effectiveId.mockResolvedValue(7);
    const res = await createProjectEvermindRoutes(db).request('/42/evermind/coding-eval', post(BODY), {});
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'evermind_inherited_read_only' });
    expect(mocks.record).not.toHaveBeenCalled();
  });
});

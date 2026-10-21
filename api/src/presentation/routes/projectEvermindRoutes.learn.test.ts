import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The gateway half of the pre-diffed weight-delta door (`POST …/evermind/learn`).
 *
 * The door was retired on 2026-08-23 for having no caller, and restored on 2026-09-12
 * when the on-prem runner (agent-runtime `project-evermind-delta.ts`) became that
 * caller. These pin what the producer depends on at the HTTP edge: the agent-host
 * front door exists and authenticates, a bad/oversized body never reaches the
 * coordinator, an inheriting build is refused terminally, and the coordinator's own
 * answer — above all 409 + `headVersion` — is passed through verbatim.
 */

const TENANT = 5;
const mocks = vi.hoisted(() => ({
  hostAuth: vi.fn(),
  dispatch: vi.fn(),
  effectiveId: vi.fn(),
  owned: vi.fn(),
  headDispatch: vi.fn(),
  headRead: vi.fn(),
}));

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => { c.set('tenantId', TENANT); await next(); },
  requireRole: () => async (_c: any, next: any) => next(),
}));
vi.mock('../middleware/featureGate', () => ({ requireFrontierAccess: vi.fn(async () => null) }));
vi.mock('../../infrastructure/auth/agentHostAuth', () => ({ resolveHostAuth: mocks.hostAuth }));
vi.mock('../../infrastructure/auth/segmentResolver', () => ({ resolveSegment: async () => 'seg-1' }));
vi.mock('../../application/project/projectOwnership', () => ({ projectInTenantCached: mocks.owned }));
vi.mock('../../application/llm/evermindDeltaDispatch', () => ({ dispatchProjectEvermindLearn: mocks.dispatch }));
vi.mock('../../application/llm/evermindMlHeadDispatch', () => ({
  dispatchProjectEvermindHeadLearn: mocks.headDispatch,
  readProjectEvermindMlHead: mocks.headRead,
}));
vi.mock('../../application/llm/projectEvermind', () => ({
  resolveEffectiveEvermindProjectId: mocks.effectiveId,
}));
vi.mock('../../application/llm/evermindRecipes', () => ({}));
vi.mock('../../application/llm/evermindRuntime', () => ({}));
vi.mock('../../application/llm/evermindAnalyzer', () => ({}));
vi.mock('../../application/llm/projectFactsAnswerCache', () => ({}));

const { createProjectEvermindRoutes } = await import('./projectEvermindRoutes');
const { agentHostDoor } = await import('../middleware/frontDoor');

const db = {} as never;
/** The agent-host door: the SAME router factory, built with the host-key door. */
const createProjectEvermindAgentRoutes = (d: never) => createProjectEvermindRoutes(d, agentHostDoor(d));
const post = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const DELTA = { diff: 'AAAA', baseVersion: 7, weight: 0.7, label: 'ticket 12' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hostAuth.mockResolvedValue({ tenantId: TENANT });
  mocks.owned.mockResolvedValue(true);
  mocks.effectiveId.mockImplementation(async (_env: unknown, _db: unknown, _t: number, projectId: number) => projectId);
  mocks.dispatch.mockResolvedValue({ ok: true, status: 200, body: { ok: true, queued: 1, contributionId: 11, baseVersion: 7 } });
  mocks.headDispatch.mockResolvedValue({ ok: true, status: 200, body: { ok: true, target: 'ml:run.local-success', queued: 1, baseVersion: 0 } });
  mocks.headRead.mockResolvedValue({ ok: true, status: 200, body: { target: 'ml:run.local-success', version: 2, params: [0], evalLoss: 0.3 } });
});

describe('agent-host front door — POST /:projectId/evermind/learn', () => {
  it('dispatches the validated delta to the project coordinator, single-target', async () => {
    const res = await createProjectEvermindAgentRoutes(db).request('/42/evermind/learn', post(DELTA), {});

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, contributionId: 11 });
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    const [, tenantId, projectId, request] = mocks.dispatch.mock.calls[0]!;
    expect({ tenantId, projectId }).toEqual({ tenantId: TENANT, projectId: 42 });
    expect(request).toEqual({ diff: 'AAAA', baseVersion: 7, weight: 0.7, label: 'ticket 12' });
  });

  it('passes the stale-base refusal through verbatim — the producer rebases on headVersion', async () => {
    mocks.dispatch.mockResolvedValue({ ok: false, status: 409, body: { ok: false, error: 'stale base — rebase against current head', headVersion: 8 } });
    const res = await createProjectEvermindAgentRoutes(db).request('/42/evermind/learn', post(DELTA), {});
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ headVersion: 8 });
  });

  it('refuses an unauthenticated host before touching anything', async () => {
    mocks.hostAuth.mockResolvedValue(null);
    const res = await createProjectEvermindAgentRoutes(db).request('/42/evermind/learn', post(DELTA), {});
    expect(res.status).toBe(401);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('rejects a malformed body at the edge, never reaching the coordinator', async () => {
    const res = await createProjectEvermindAgentRoutes(db).request('/42/evermind/learn', post({ diff: 'AAAA' }), {});
    expect(res.status).toBe(400);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('refuses an oversized push from its declared length, before parsing it', async () => {
    const init = { ...post(DELTA), headers: { 'content-type': 'application/json', 'content-length': String(64 * 1024 * 1024) } };
    const res = await createProjectEvermindAgentRoutes(db).request('/42/evermind/learn', init, {});
    expect(res.status).toBe(413);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('refuses a build that inherits another project’s Evermind, with the terminal code the producer stops on', async () => {
    mocks.effectiveId.mockResolvedValue(7);
    const res = await createProjectEvermindAgentRoutes(db).request('/42/evermind/learn', post(DELTA), {});
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'evermind_inherited_read_only', inheritedFromProjectId: 7 });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('does not let /learn shadow /learn-text', async () => {
    // A path-prefix mistake in either router would send text contributions to the
    // delta parser, which would 400 every run's contribution.
    const res = await createProjectEvermindAgentRoutes(db).request('/42/evermind/learn-text', post({ text: '' }), {});
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'text is required' });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});

describe('JWT front door — POST /:projectId/evermind/learn', () => {
  it('routes to the same core', async () => {
    const res = await createProjectEvermindRoutes(db).request('/42/evermind/learn', post(DELTA), {});
    expect(res.status).toBe(200);
    expect(mocks.dispatch.mock.calls[0]![1]).toBe(TENANT);
  });
});

describe('agent-host door scope', () => {
  it('serves only the replica-sync + learn subset — manager writes stay JWT-only', async () => {
    const res = await createProjectEvermindAgentRoutes(db).request('/42/evermind/seed', post({}), {});
    expect(res.status).toBe(404);
  });

  it('does not gate paths outside evermind that share the /api/agent/projects mount', async () => {
    mocks.hostAuth.mockResolvedValue(null);
    const res = await createProjectEvermindAgentRoutes(db).request('/42/run-context', {}, {});
    expect(res.status).toBe(404);
  });
});

describe('federated ML heads — the head branch of POST /learn and GET /ml-head', () => {
  const row = { x: [0.1, 0.2, 0.05, 0, 0, 0, 0, 0.5, 0], y: 1 };
  const HEAD_DELTA = { diff: 'AAAA', baseVersion: 0, weight: 24, target: 'ml:run.local-success', holdout: [row] };

  it('sends a run.local-success head delta to the head door — never the LM merge, never the inheritance refusal', async () => {
    mocks.effectiveId.mockResolvedValue(7);
    const res = await createProjectEvermindRoutes(db).request('/42/evermind/learn', post(HEAD_DELTA), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, target: 'ml:run.local-success' });
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.headDispatch).toHaveBeenCalledTimes(1);
    const [, tenantId, projectId, body] = mocks.headDispatch.mock.calls[0]!;
    expect({ tenantId, projectId }).toEqual({ tenantId: TENANT, projectId: 42 });
    expect(body).toMatchObject(HEAD_DELTA);
  });

  it('refuses a head delta the merge gate could not score (no held-out rows) at the edge', async () => {
    const res = await createProjectEvermindRoutes(db).request('/42/evermind/learn', post({ ...HEAD_DELTA, holdout: [] }), {});
    expect(res.status).toBe(400);
    expect(mocks.headDispatch).not.toHaveBeenCalled();
  });

  it('a delta for an ML target with no head door still never reaches the LM merge (target mismatch)', async () => {
    const res = await createProjectEvermindRoutes(db).request('/42/evermind/learn', post({ ...HEAD_DELTA, target: 'ml:experience.quality' }), {});
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false });
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.headDispatch).not.toHaveBeenCalled();
  });

  it('serves the merged head for a registered target, and refuses any other', async () => {
    const ok = await createProjectEvermindRoutes(db).request('/42/evermind/ml-head?target=ml%3Arun.local-success', {}, {});
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ version: 2, evalLoss: 0.3 });
    expect(mocks.headRead.mock.calls[0]!.slice(1)).toEqual([TENANT, 42, 'ml:run.local-success']);

    const bad = await createProjectEvermindRoutes(db).request('/42/evermind/ml-head?target=ml%3Aexperience.quality', {}, {});
    expect(bad.status).toBe(400);
    expect(mocks.headRead).toHaveBeenCalledTimes(1);
  });
});

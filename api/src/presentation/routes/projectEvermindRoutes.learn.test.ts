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
}));

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => { c.set('tenantId', TENANT); await next(); },
  requireRole: () => async (_c: any, next: any) => next(),
}));
vi.mock('../middleware/featureGate', () => ({ requireFrontierAccess: vi.fn(async () => null) }));
vi.mock('../../infrastructure/auth/agentHostAuth', () => ({ resolveHostAuth: mocks.hostAuth }));
vi.mock('../../application/project/projectOwnership', () => ({ loadProjectInTenant: mocks.owned }));
vi.mock('../../application/llm/evermindDeltaDispatch', () => ({ dispatchProjectEvermindLearn: mocks.dispatch }));
vi.mock('../../application/llm/projectEvermind', () => ({
  resolveEffectiveEvermindProjectId: mocks.effectiveId,
}));
vi.mock('../../application/llm/evermindRecipes', () => ({}));
vi.mock('../../application/llm/evermindRuntime', () => ({}));
vi.mock('../../application/llm/evermindAnalyzer', () => ({}));
vi.mock('../../application/llm/projectFacts', () => ({}));

const { createProjectEvermindAgentRoutes, createProjectEvermindRoutes } = await import('./projectEvermindRoutes');

const db = {} as never;
const post = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const DELTA = { diff: 'AAAA', baseVersion: 7, weight: 0.7, label: 'ticket 12' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hostAuth.mockResolvedValue({ tenantId: TENANT });
  mocks.owned.mockResolvedValue({ id: 42 });
  mocks.effectiveId.mockImplementation(async (_env: unknown, _db: unknown, _t: number, projectId: number) => projectId);
  mocks.dispatch.mockResolvedValue({ ok: true, status: 200, body: { ok: true, queued: 1, contributionId: 11, baseVersion: 7 } });
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

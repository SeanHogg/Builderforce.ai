/**
 * The HTTP edge of the `governance_audit` tool's three endpoints, mounted through governanceRoutes
 * (so the sub-router is proven to win over the trackers). Scope comes off the request context —
 * never the body; the writes are developer+ (the REAL `requireRole` answers the 403); bodies are
 * validated and bounded before the port runs; the port's 404/409 outcomes pass through. The port
 * itself is covered in application/governance/governanceRuleAudits.test.ts, so it is mocked here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 55;
const SEGMENT = '22222222-2222-4222-8222-222222222222';
const ctx = vi.hoisted(() => ({ role: 'developer' }));
vi.mock('../middleware/authMiddleware', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../middleware/authMiddleware')>()),
  authMiddleware: async (c: any, next: any) => {
    c.set('tenantId', TENANT);
    c.set('segmentId', SEGMENT);
    c.set('role', ctx.role);
    await next();
  },
}));

const port = vi.hoisted(() => ({
  resolveGovernanceRuleset: vi.fn(),
  startGovernanceAudit: vi.fn(),
  finalizeGovernanceAudit: vi.fn(),
}));
vi.mock('../../application/governance/governanceRuleAudits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/governance/governanceRuleAudits')>()),
  ...port,
}));
const audit = vi.hoisted(() => ({ auditGovernanceMutation: vi.fn() }));
vi.mock('./governanceAudit', () => audit);

import { createGovernanceRoutes } from './governanceRoutes';
import { errorHandler } from '../middleware/errorHandler';

const RUN = '11111111-1111-4111-8111-111111111111';
const RULE = '33333333-3333-4333-8333-333333333333';
const SCOPE = { tenantId: TENANT, segmentId: SEGMENT };
const json = (method: string, b: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const app = () => {
  const router = createGovernanceRoutes({} as any);
  router.onError(errorHandler as never);
  return router;
};
const send = (path: string, init?: unknown) => app().request(
  path, init as never, {} as never, { waitUntil: () => {}, passThroughOnException: () => {} } as never,
);

const finding = (over: Record<string, unknown> = {}) => ({
  ruleId: RULE, ruleRef: 'SEC.SECRET.NO_HARDCODED', severity: 'blocker', title: 'Secret', detail: 'matched a.ts:3',
  filePath: 'a.ts', line: 3, evidence: 'key = "…"', source: 'prefilter', confidence: 'high', ...over,
});
/** Exactly what the tool posts (agent-runtime governance-audit-tool.ts step 4). */
const toolFinalize = (over: Record<string, unknown> = {}) => ({
  findings: [finding()],
  summary: { blocker: 1, critical: 0, high: 0, medium: 0, low: 0, info: 0, passed: 3 },
  gateResult: 'blocked',
  rulesetHash: 'a'.repeat(64),
  ...over,
});

beforeEach(() => {
  ctx.role = 'developer';
  for (const fn of [...Object.values(port), audit.auditGovernanceMutation]) fn.mockReset();
});

describe('GET /rules/resolve', () => {
  it('resolves under the request scope with the string projectId the tool sends', async () => {
    const value = { rulesetHash: 'h', packsApplied: [], rules: [] };
    port.resolveGovernanceRuleset.mockResolvedValue({ ok: true, value });
    const res = await send('/rules/resolve?projectId=12&repoRef=org%2Frepo');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(value);
    expect(port.resolveGovernanceRuleset.mock.calls[0]!.slice(1)).toEqual([SCOPE, 12]);
  });

  it('is member-level: a viewer may read the posture it runs under', async () => {
    ctx.role = 'viewer';
    port.resolveGovernanceRuleset.mockResolvedValue({ ok: true, value: { rulesetHash: 'h', packsApplied: [], rules: [] } });
    expect((await send('/rules/resolve')).status).toBe(200);
    expect(port.resolveGovernanceRuleset.mock.calls[0]![2]).toBeNull();
  });

  it('400s a non-integer projectId; 404s a project of another tenant', async () => {
    expect((await send('/rules/resolve?projectId=abc')).status).toBe(400);
    expect(port.resolveGovernanceRuleset).not.toHaveBeenCalled();
    port.resolveGovernanceRuleset.mockResolvedValue({ ok: false, status: 404, error: 'project not found' });
    expect((await send('/rules/resolve?projectId=99')).status).toBe(404);
  });
});

describe('POST /audits', () => {
  it('opens a run under the request scope (never a body-supplied tenant) and records the mutation', async () => {
    port.startGovernanceAudit.mockResolvedValue({ ok: true, value: { runId: RUN } });
    const res = await send('/audits', json('POST', { projectId: '12', repoRef: 'org/repo', ref: 'main', trigger: 'manual', tenantId: 1 }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ runId: RUN });
    expect(port.startGovernanceAudit.mock.calls[0]!.slice(1)).toEqual([SCOPE, {
      projectId: 12, repoRef: 'org/repo', ref: 'main', trigger: 'manual', agentRunId: null,
    }]);
    expect(audit.auditGovernanceMutation).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'governance-audits', RUN, 'run', null, expect.anything());
  });

  it('403s below developer', async () => {
    ctx.role = 'viewer';
    expect((await send('/audits', json('POST', { trigger: 'manual' }))).status).toBe(403);
    expect(port.startGovernanceAudit).not.toHaveBeenCalled();
  });

  it('400s an unknown trigger or an oversize ref', async () => {
    expect((await send('/audits', json('POST', { trigger: 'cron' }))).status).toBe(400);
    expect((await send('/audits', json('POST', { trigger: 'manual', ref: 'x'.repeat(201) }))).status).toBe(400);
    expect((await send('/audits', json('POST', { trigger: 'manual', projectId: 'abc' }))).status).toBe(400);
    expect(port.startGovernanceAudit).not.toHaveBeenCalled();
  });

  it('404s a project of another tenant and records nothing', async () => {
    port.startGovernanceAudit.mockResolvedValue({ ok: false, status: 404, error: 'project not found' });
    expect((await send('/audits', json('POST', { trigger: 'manual', projectId: 99 }))).status).toBe(404);
    expect(audit.auditGovernanceMutation).not.toHaveBeenCalled();
  });
});

describe('POST /audits/:id/findings', () => {
  it('accepts exactly the tool payload and finalizes under the request scope', async () => {
    port.finalizeGovernanceAudit.mockResolvedValue({ ok: true, value: { runId: RUN, findings: 1 } });
    const res = await send(`/audits/${RUN}/findings`, json('POST', toolFinalize()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runId: RUN, findings: 1 });
    const [, scope, runId, input] = port.finalizeGovernanceAudit.mock.calls[0]!;
    expect([scope, runId]).toEqual([SCOPE, RUN]);
    expect(input).toMatchObject({ gateResult: 'blocked', rulesetHash: 'a'.repeat(64), packsApplied: null });
    expect(input.findings[0]).toMatchObject({ ruleId: RULE, ruleRef: 'SEC.SECRET.NO_HARDCODED' });
    expect(audit.auditGovernanceMutation).toHaveBeenCalledTimes(1);
  });

  it('passes packsApplied through when the caller echoes the resolve', async () => {
    port.finalizeGovernanceAudit.mockResolvedValue({ ok: true, value: { runId: RUN, findings: 1 } });
    const packsApplied = [{ packId: 'p1', name: 'Org baseline', source: 'db' }];
    await send(`/audits/${RUN}/findings`, json('POST', toolFinalize({ packsApplied })));
    expect(port.finalizeGovernanceAudit.mock.calls[0]![3].packsApplied).toEqual(packsApplied);
  });

  it('drops a non-uuid ruleId (an in-repo override rule) instead of refusing the audit', async () => {
    port.finalizeGovernanceAudit.mockResolvedValue({ ok: true, value: { runId: RUN, findings: 1 } });
    const res = await send(`/audits/${RUN}/findings`, json('POST', toolFinalize({ findings: [finding({ ruleId: 'repo:SEC.1' })] })));
    expect(res.status).toBe(200);
    expect(port.finalizeGovernanceAudit.mock.calls[0]![3].findings[0].ruleId).toBeNull();
  });

  it('403s below developer', async () => {
    ctx.role = 'viewer';
    expect((await send(`/audits/${RUN}/findings`, json('POST', toolFinalize()))).status).toBe(403);
    expect(port.finalizeGovernanceAudit).not.toHaveBeenCalled();
  });

  it('404s a malformed run id before parsing the body', async () => {
    expect((await send('/audits/not-a-uuid/findings', json('POST', toolFinalize()))).status).toBe(404);
    expect(port.finalizeGovernanceAudit).not.toHaveBeenCalled();
  });

  it('400s invalid or unbounded bodies before touching the port', async () => {
    const bad = [
      toolFinalize({ findings: [finding({ source: 'human' })] }),
      toolFinalize({ findings: [finding({ ruleRef: 'x'.repeat(81) })] }),
      toolFinalize({ findings: [finding({ detail: 'x'.repeat(10_001) })] }),
      toolFinalize({ findings: [finding({ line: 3_000_000_000 })] }),
      toolFinalize({ findings: [finding({ line: -1 })] }),
      toolFinalize({ gateResult: 'maybe' }),
      toolFinalize({ summary: { blocker: -1 } }),
      toolFinalize({ summary: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, 0])) }),
      toolFinalize({ findings: Array.from({ length: 5001 }, () => finding()) }),
      { summary: {} },
    ];
    for (const body of bad) expect((await send(`/audits/${RUN}/findings`, json('POST', body))).status).toBe(400);
    expect(port.finalizeGovernanceAudit).not.toHaveBeenCalled();
  });

  it('regression: a retried finalize answers 409 and records no second mutation', async () => {
    port.finalizeGovernanceAudit
      .mockResolvedValueOnce({ ok: true, value: { runId: RUN, findings: 1 } })
      .mockResolvedValueOnce({ ok: false, status: 409, error: 'audit run is already finalized' });
    expect((await send(`/audits/${RUN}/findings`, json('POST', toolFinalize()))).status).toBe(200);
    const retry = await send(`/audits/${RUN}/findings`, json('POST', toolFinalize()));
    expect(retry.status).toBe(409);
    expect(await retry.json()).toEqual({ error: 'audit run is already finalized' });
    expect(audit.auditGovernanceMutation).toHaveBeenCalledTimes(1);
  });

  it('404s a run outside the scope', async () => {
    port.finalizeGovernanceAudit.mockResolvedValue({ ok: false, status: 404, error: 'audit run not found' });
    expect((await send(`/audits/${RUN}/findings`, json('POST', toolFinalize()))).status).toBe(404);
  });
});

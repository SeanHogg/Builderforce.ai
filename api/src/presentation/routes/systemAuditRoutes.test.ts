import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: () => Promise<void>) => { c.set('tenantId', 7); c.set('userId', 'u1'); await next(); },
  requireRole: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));
vi.mock('../../application/integrations/integrationCredentialSecret', () => ({ integrationCredentialSecret: () => 'secret' }));
vi.mock('../../application/project/projectOwnership', () => ({ loadProjectInTenant: vi.fn(async () => ({ id: 42 })) }));
vi.mock('../../application/runtime/dispatchCloudRun', () => ({ dispatchCloudRunForTask: vi.fn(), dispatchError: (e: unknown) => ({ executionId: null, refusal: { message: String(e) } }) }));
import { createToolRoutes } from './toolRoutes';
import { dispatchCloudRunForTask } from '../../application/runtime/dispatchCloudRun';

const runId = '7568a9b0-2cb0-4a1a-8e42-97c26bf63e19';
const runner = {
  runAudit: vi.fn(), setRunStatus: vi.fn(), getRun: vi.fn(), reportFindings: vi.fn(), bindExecution: vi.fn(),
};
function request(path: string, body?: unknown) {
  const app = new Hono().route('/api/tools', createToolRoutes({} as never, runner as never, {} as never, {} as never));
  return app.fetch(new Request(`https://test/api/tools${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), {}, { waitUntil: () => undefined, passThroughOnException: () => undefined } as never);
}

describe('shared audit routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runner.getRun.mockResolvedValue(null);
    runner.runAudit.mockResolvedValue({ started: true, runId, auditId: 'quality-audit', executor: 'cloud', agentTask: { taskId: 123 } });
    vi.mocked(dispatchCloudRunForTask).mockResolvedValue({ executionId: 456 });
  });
  it('starts cloud execution directly instead of relying on lane autorun', async () => {
    const response = await request('/audits/quality-audit/run', { projectId: 42 });
    expect(response.status).toBe(201);
    expect(dispatchCloudRunForTask).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.objectContaining({ tenantId: 7, taskId: 123, submittedBy: 'u1' }));
    expect(runner.bindExecution).toHaveBeenCalledWith(7, runId, 456);
  });
  it('does not launch cloud work for a local audit', async () => {
    runner.runAudit.mockResolvedValue({ started: true, runId, executor: 'local' });
    expect((await request('/audits/quality-audit/run', { projectId: 42, executor: 'local' })).status).toBe(201);
    expect(dispatchCloudRunForTask).not.toHaveBeenCalled();
  });
  it('returns a visible blocked status and refusal reason', async () => {
    vi.mocked(dispatchCloudRunForTask).mockResolvedValue({ executionId: null, refusal: { reason: 'execution_disabled', message: 'Execution disabled' } });
    const response = await request('/audits/quality-audit/run', { projectId: 42 });
    expect((await response.json() as any).dispatch.refusal.message).toBe('Execution disabled');
    expect(runner.setRunStatus).toHaveBeenCalledWith(7, runId, 'blocked', 'Execution disabled');
  });
  it('does not duplicate a close request accepted before shutdown', async () => {
    runner.getRun.mockResolvedValue({ id: runId, auditId: 'quality-audit', executor: 'cloud', status: 'running' });
    expect((await request('/audits/quality-audit/run', { projectId: 42, requestId: runId })).status).toBe(200);
    expect(runner.runAudit).not.toHaveBeenCalled();
    expect(dispatchCloudRunForTask).not.toHaveBeenCalled();
  });
  it('scopes report reads to the authenticated tenant and project', async () => {
    expect((await request(`/audits/quality-audit/runs/${runId}?projectId=42`)).status).toBe(404);
    expect(runner.getRun).toHaveBeenCalledWith(7, 42, runId);
    expect((await request('/audits/quality-audit/runs/not-a-uuid?projectId=42')).status).toBe(400);
  });
  it('binds submitted findings to the explicit run', async () => {
    runner.reportFindings.mockResolvedValue({ completed: true, ticketIds: [123] });
    const response = await request('/audits/quality-audit/findings', { projectId: 42, runId, findings: [] });
    expect(response.status).toBe(200);
    expect(runner.reportFindings).toHaveBeenCalledWith(expect.anything(), { tenantId: 7, userId: 'u1', projectId: 42, runId, auditId: 'quality-audit', findings: [] });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./auditRemediation', () => ({ ensureRemediationTickets: vi.fn() }));
vi.mock('./auditDeepPass', () => ({ applyAuditFindings: vi.fn() }));
vi.mock('../notifications/notify', () => ({ notify: vi.fn(async () => undefined) }));
import { AuditRunner } from './AuditRunner';
import { ensureRemediationTickets } from './auditRemediation';
import { applyAuditFindings } from './auditDeepPass';

const args = { tenantId: 7, projectId: 42, auditId: 'quality-audit', runId: 'run', userId: 'u1', findings: [{ title: 'Broken query', severity: 'high' as const }] };
const baseline = { score: 4, headline: 'Preview', metrics: [], recommendations: [{ title: 'Unverified heuristic', detail: 'Preview only' }] };

function setup(status = 'running', claims = true, previous: unknown[] = []) {
  const session = { id: 'run', tenantId: 7, projectId: 42, auditId: 'quality-audit', status,
    baseline, findings: null, ticketIds: [], createdBy: 'u1', createdAt: new Date('2026-10-18T12:00:00Z') };
  const updates: Array<Record<string, unknown>> = [];
  const db = { select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => previous }) }) }) }), update: () => ({ set: (values: Record<string, unknown>) => {
    updates.push(values);
    return { where: () => Object.assign(Promise.resolve(), {
      returning: async () => claims ? [{ ...session, ...values }] : [],
    }) };
  } }) };
  const runner = new AuditRunner(db as never, {} as never, {} as never);
  vi.spyOn(runner, 'getRun').mockResolvedValue(session as never);
  return { runner, updates };
}

describe('audit completion lifecycle', () => {
  beforeEach(() => {
    vi.mocked(ensureRemediationTickets).mockReset().mockResolvedValue([123]);
    vi.mocked(applyAuditFindings).mockReset().mockResolvedValue({ id: 'report', result: { headline: 'Reviewed' } } as never);
  });
  it('persists findings before creating tickets and completes only after both tickets and report exist', async () => {
    const { runner, updates } = setup();
    const result = await runner.reportFindings({} as never, args);
    expect(updates[0]).toMatchObject({ findings: args.findings, status: 'reporting' });
    expect(result).toMatchObject({ completed: true, ticketIds: [123] });
    expect(updates.at(-1)).toMatchObject({ status: 'completed', reportId: 'report', ticketIds: [123] });
    expect(applyAuditFindings).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), expect.objectContaining({ baseline: { ...baseline, recommendations: [] } }));
  });
  it('retains a visible retryable state when ticket creation fails', async () => {
    vi.mocked(ensureRemediationTickets).mockRejectedValueOnce(new Error('Board unavailable'));
    const { runner, updates } = setup();
    await expect(runner.reportFindings({} as never, args)).rejects.toThrow('Board unavailable');
    expect(updates.at(-1)).toMatchObject({ status: 'remediation_pending', error: 'Error: Board unavailable' });
    expect(applyAuditFindings).not.toHaveBeenCalled();
  });
  it('does not repeat completed reports or allow simultaneous completion writers', async () => {
    const completed = setup('completed');
    expect(await completed.runner.reportFindings({} as never, args)).toMatchObject({ completed: true });
    expect(ensureRemediationTickets).not.toHaveBeenCalled();
    const busy = setup('running', false);
    await expect(busy.runner.reportFindings({} as never, args)).rejects.toThrow('Another report');
    expect(ensureRemediationTickets).not.toHaveBeenCalled();
  });
  it('rejects findings for an audit that does not own the selected run', async () => {
    const { runner } = setup();
    expect(await runner.reportFindings({} as never, { ...args, auditId: 'soc2-audit' })).toBeNull();
    expect(ensureRemediationTickets).not.toHaveBeenCalled();
  });
  it('persists analyzer evidence and compares the matching previous snapshot', async () => {
    const current = { version: 1 as const, id: 'scan', capturedAt: '2026-10-18T12:00:00Z', source: { branch: 'main', commit: 'abc', dirty: false },
      tools: [], nodes: ['src/a.ts'], edges: [], issues: [{ id: 'candidate', kind: 'unused-file' as const, locations: [{ path: 'src/a.ts', startLine: 1, endLine: 1 }] }] };
    const previous = { ...current, id: 'before' };
    const { runner, updates } = setup('running', true, [{ result: { codeAnalysis: { current: previous } } }]);
    await runner.reportFindings({} as never, { ...args, analysis: current });
    expect(updates[0]).toMatchObject({ analysis: current, status: 'reporting' });
    expect(ensureRemediationTickets).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ findings: expect.arrayContaining([expect.objectContaining({ title: 'unused-file: src/a.ts' })]) }));
    expect(applyAuditFindings).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), expect.objectContaining({ codeAnalysis: { current, baseline: previous } }));
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ config: {} as Record<string, unknown>, stored: new Map<string, unknown>(), trusted: true }));
vi.mock('vscode', () => ({
  workspace: {
    get isTrusted() { return state.trusted; }, workspaceFolders: [{ uri: { fsPath: '/repo' } }],
    getConfiguration: () => ({ get: (key: string, fallback: unknown) => state.config[key] ?? fallback }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
  },
  window: { showErrorMessage: vi.fn(), showInformationMessage: vi.fn(async () => undefined) },
  commands: { executeCommand: vi.fn(async () => undefined) },
  l10n: { t: (s: string) => s },
}));
vi.mock('./systemAuditApi', () => ({
  createBrainChat: vi.fn(async () => 42),
  startSystemAudit: vi.fn(async () => ({ runId: 'run', briefing: 'Inspect source' })),
  getSystemAuditRun: vi.fn(async () => ({ status: 'completed', ticketIds: [] })),
}));
vi.mock('./bfApi', () => ({ appendBrainMessages: vi.fn(async () => null), listSystemAudits: vi.fn(async () => []) }));
vi.mock('./auditResultsPanel', () => ({ AuditResultsPanel: { open: vi.fn() } }));
vi.mock('./builderforcePanel', () => ({ BuilderForcePanel: { open: vi.fn() } }));
vi.mock('./projectState', () => ({ getSelectedProject: () => ({ id: 7 }), onProjectChange: () => ({ dispose() {} }) }));
import { AuditExecution } from './auditExecution';
import { createBrainChat, startSystemAudit } from './systemAuditApi';

const ctx = { secrets: {}, workspaceState: {
  get: (key: string, fallback: unknown) => state.stored.get(key) ?? fallback,
  update: async (key: string, value: unknown) => { state.stored.set(key, value); },
} };
const closeKey = 'builderforce.audits.pendingClose';
const host = () => ({ start: vi.fn(async (_payload: unknown) => undefined), attach: vi.fn(() => () => undefined) });

describe('audit lifecycle triggers', () => {
  beforeEach(() => {
    state.config = {}; state.stored.clear(); state.trusted = true;
    vi.mocked(startSystemAudit).mockClear().mockResolvedValue({ runId: 'run', briefing: 'Inspect source' });
    vi.mocked(createBrainChat).mockClear();
  });
  it('keeps startup and close opt-in', async () => {
    const execution = new AuditExecution(ctx as never, host() as never);
    await vi.waitFor(() => expect(state.stored.get(closeKey)).toEqual([]));
    expect(startSystemAudit).not.toHaveBeenCalled();
    execution.dispose();
  });
  it('durably arms close work and submits the same request id during shutdown', async () => {
    state.config = { atClose: true, selected: ['quality-audit'] };
    const execution = new AuditExecution(ctx as never, host() as never);
    await vi.waitFor(() => expect(state.stored.get(closeKey)).toHaveLength(1));
    const intent = (state.stored.get(closeKey) as Array<{ requestId: string }>)[0]!;
    expect(startSystemAudit).not.toHaveBeenCalled();
    await execution.flushClose();
    expect(startSystemAudit).toHaveBeenCalledWith(ctx.secrets, 'quality-audit', 7, 'cloud', 'close', intent.requestId);
    expect(state.stored.get(closeKey)).toEqual([]);
    execution.dispose();
  });
  it('retains interrupted close work for a later retry', async () => {
    const intent = { projectId: 7, auditId: 'quality-audit', requestId: 'request' };
    state.stored.set(closeKey, [intent]);
    vi.mocked(startSystemAudit).mockRejectedValueOnce(new Error('offline'));
    const execution = new AuditExecution(ctx as never, host() as never);
    await vi.waitFor(() => expect(startSystemAudit).toHaveBeenCalledOnce());
    expect(state.stored.get(closeKey)).toEqual([intent]);
    await execution.flushClose();
    expect(state.stored.get(closeKey)).toEqual([]);
    expect(vi.mocked(startSystemAudit).mock.calls[1]?.[5]).toBe('request');
    execution.dispose();
  });
  it('does not arm automatic work in an untrusted workspace', async () => {
    state.trusted = false; state.config = { atClose: true, atStartup: true };
    const execution = new AuditExecution(ctx as never, host() as never);
    await vi.waitFor(() => expect(state.stored.get(closeKey)).toEqual([]));
    expect(startSystemAudit).not.toHaveBeenCalled();
    execution.dispose();
  });
  it('runs startup audits through the local background host', async () => {
    state.config = { atStartup: true, selected: ['quality-audit'] };
    const runHost = host();
    const execution = new AuditExecution(ctx as never, runHost as never);
    await vi.waitFor(() => expect(runHost.start).toHaveBeenCalledOnce());
    expect(startSystemAudit).toHaveBeenCalledWith(ctx.secrets, 'quality-audit', 7, 'local', 'startup');
    expect(runHost.start.mock.calls[0]?.[0]).toMatchObject({ chatId: 42, projectId: 7, autoApprove: false, audit: { auditId: 'quality-audit', runId: 'run' } });
    execution.dispose();
  });
});

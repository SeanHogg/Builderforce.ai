import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { createMemoryLocalFirstStore, type LocalFirstStore } from '@builderforce/local-first';
const state = vi.hoisted(() => ({ config: {} as Record<string, unknown>, stored: new Map<string, unknown>(), trusted: true }));
const local = vi.hoisted(() => ({
  allowCloud: true,
  allows: null as ((capability: string) => boolean) | null,
  chats: 1000,
  sent: [] as Array<{ chatId: number; messages: unknown }>,
  store: null as LocalFirstStore | null,
}));
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
vi.mock('./openWorkspace', () => ({ openWorkspace: vi.fn() }));
vi.mock('./projectState', () => ({ getSelectedProject: () => ({ id: 7 }), onProjectChange: () => ({ dispose() {} }) }));
vi.mock('./platformPolicy', () => ({
  platformPolicy: () => ({
    allows: (capability: string) => local.allows
      ? local.allows(capability)
      : local.allowCloud && (capability === 'synchronize' || capability === 'connected-feature'),
    assert() { if (!local.allowCloud) throw new Error('denied'); },
  }),
}));
vi.mock('./localFirstStore', () => ({
  localBrainApplication: () => {
    if (!local.store) throw new Error('local store not installed');
    return {
      store: local.store,
      persistence: {
        createChat: async () => ({ id: ++local.chats }),
        sendMessages: async (chatId: number, messages: unknown) => { local.sent.push({ chatId, messages }); },
      },
    };
  },
}));
import { AuditExecution } from './auditExecution';
import { auditToolCatalog } from './auditToolCatalog';
import { ensureLocalAuditDefinitions, getLocalAuditRun, listLocalAuditFindings, saveLocalAuditFindings, startLocalAuditRun } from './localAuditStore';
import { createBrainChat, startSystemAudit } from './systemAuditApi';

const memento = {
  get: (key: string, fallback: unknown) => state.stored.get(key) ?? fallback,
  update: async (key: string, value: unknown) => { state.stored.set(key, value); },
};
const ctx = { secrets: {}, workspaceState: memento, globalState: memento };
const closeKey = 'builderforce.audits.pendingClose';
const host = () => ({ start: vi.fn(async (_payload: unknown) => undefined), attach: vi.fn(() => () => undefined) });

describe('audit lifecycle triggers', () => {
  beforeEach(() => {
    state.config = {}; state.stored.clear(); state.trusted = true;
    local.allowCloud = true; local.allows = null; local.chats = 1000; local.sent = [];
    local.store = createMemoryLocalFirstStore();
    state.stored.set('builderforce.localDeviceId', 'device-1');
    vi.mocked(startSystemAudit).mockClear().mockResolvedValue({ runId: 'run', briefing: 'Inspect source' });
    vi.mocked(createBrainChat).mockClear();
  });
  it('keeps startup and close opt-in', async () => {
    const execution = new AuditExecution(ctx as never, host() as never);
    await vi.waitFor(() => expect(state.stored.get(closeKey)).toEqual([]));
    expect(startSystemAudit).not.toHaveBeenCalled();
    execution.dispose();
  });
  it('durably arms close work and marks the same request id closed locally', async () => {
    state.config = { atClose: true, selected: ['quality-audit'] };
    const execution = new AuditExecution(ctx as never, host() as never);
    await vi.waitFor(() => expect(state.stored.get(closeKey)).toHaveLength(1));
    const intent = (state.stored.get(closeKey) as Array<{ requestId: string }>)[0]!;
    expect(startSystemAudit).not.toHaveBeenCalled();
    await execution.flushClose();
    expect(startSystemAudit).not.toHaveBeenCalled();
    expect(createBrainChat).not.toHaveBeenCalled();
    expect((await getLocalAuditRun(local.store!, intent.requestId))?.record.payload).toMatchObject({
      closedLocally: true, trigger: 'close', status: 'completed',
    });
    expect(state.stored.get(closeKey)).toEqual([]);
    execution.dispose();
  });
  it('retains a close that failed to persist and retries the same request locally', async () => {
    const intent = { projectId: 7, auditId: 'quality-audit', requestId: 'request' };
    state.stored.set(closeKey, [intent]);
    const store = local.store!;
    const transact = store.transact.bind(store);
    let failures = 0;
    store.transact = (async (fn: Parameters<typeof store.transact>[0]) => {
      if (failures === 0) {
        failures += 1;
        throw new Error('offline');
      }
      return transact(fn);
    }) as typeof store.transact;
    vi.mocked(vscode.window.showErrorMessage).mockClear();
    const execution = new AuditExecution(ctx as never, host() as never);
    await vi.waitFor(() => expect(failures).toBe(1));
    await vi.waitFor(() => expect(vscode.window.showErrorMessage).toHaveBeenCalled());
    expect(state.stored.get(closeKey)).toEqual([intent]);
    expect(startSystemAudit).not.toHaveBeenCalled();
    await execution.flushClose();
    expect(startSystemAudit).not.toHaveBeenCalled();
    expect(createBrainChat).not.toHaveBeenCalled();
    expect(state.stored.get(closeKey)).toEqual([]);
    expect((await getLocalAuditRun(store, 'request'))?.record.payload).toMatchObject({
      closedLocally: true, trigger: 'close', status: 'completed',
    });
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
    expect(startSystemAudit).not.toHaveBeenCalled();
    expect(createBrainChat).not.toHaveBeenCalled();
    const started = runHost.start.mock.calls[0]?.[0] as { systemPrompt: string; audit: { runId: string } };
    expect(started).toMatchObject({ projectId: 7, autoApprove: false, audit: { auditId: 'quality-audit' } });
    expect(started.systemPrompt).toContain('Quality Audit');
    expect(started.systemPrompt).not.toContain('Inspect source');
    expect(await getLocalAuditRun(local.store!, started.audit.runId)).toBeTruthy();
    execution.dispose();
  });
  it('loads a supported audit from the local store instead of starting a cloud session', async () => {
    local.allowCloud = true;
    const store = local.store!;
    await ensureLocalAuditDefinitions(store, { deviceId: 'device-1' });
    const seeded = await store.read((tx) => tx.get<{ name: string }>('audit-definition', 'quality-audit'));
    expect(seeded?.payload.name).toBe('Quality Audit');
    await store.transact(async (tx) => {
      const row = await tx.get<{ name: string }>('audit-definition', 'quality-audit');
      if (!row) throw new Error('definition missing');
      await tx.put({
        ...row,
        version: row.version + 1,
        updatedAt: new Date().toISOString(),
        payload: { ...row.payload, name: 'Stored Quality Audit' },
      }, row.version);
    });
    const runHost = host();
    runHost.start.mockImplementation(async (payload: unknown) => {
      const audit = (payload as { audit: { auditId: string; runId: string } }).audit;
      const save = auditToolCatalog({} as never, [], 7, audit).find((tool) => tool.name === 'save_audit_findings');
      await save?.execute({ findings: [{ title: 'Store finding', severity: 'low', location: 'src/b.ts' }] }, '/repo');
    });
    const execution = new AuditExecution(ctx as never, runHost as never);
    await vi.waitFor(() => expect(state.stored.get(closeKey)).toEqual([]));
    await execution.run('quality-audit', 7);
    expect(createBrainChat).not.toHaveBeenCalled();
    expect(startSystemAudit).not.toHaveBeenCalled();
    expect(runHost.start).toHaveBeenCalledOnce();
    const started = runHost.start.mock.calls[0]?.[0] as { systemPrompt: string; audit: { runId: string } };
    expect(started.systemPrompt).toContain('Stored Quality Audit');
    expect(started.systemPrompt).not.toContain('Inspect source');
    const saved = await getLocalAuditRun(store, started.audit.runId);
    expect(saved?.record.payload.status).toBe('completed');
    expect(saved?.record.payload.auditName).toBe('Stored Quality Audit');
    expect(await listLocalAuditFindings(store, started.audit.runId)).toHaveLength(1);
    execution.dispose();
  });
  it('runs a denied-cloud audit from the packaged definition without a server session', async () => {
    local.allowCloud = false;
    const store = local.store!;
    const runHost = host();
    runHost.start.mockImplementation(async (payload: unknown) => {
      const audit = (payload as { audit: { auditId: string; runId: string } }).audit;
      const save = auditToolCatalog({} as never, [], 7, audit).find((tool) => tool.name === 'save_audit_findings');
      const report = { findings: [{ title: 'Missing test', severity: 'high', detail: 'no coverage', location: 'src/a.ts' }] };
      await save?.execute(report, '/repo');
      await save?.execute(report, '/repo');
    });
    const execution = new AuditExecution(ctx as never, runHost as never);
    await vi.waitFor(() => expect(state.stored.get(closeKey)).toEqual([]));
    await execution.run('quality-audit', 7);
    expect(createBrainChat).not.toHaveBeenCalled();
    expect(startSystemAudit).not.toHaveBeenCalled();
    expect(runHost.start).toHaveBeenCalledOnce();
    const started = runHost.start.mock.calls[0]?.[0] as { chatId: number; systemPrompt: string; audit: { runId: string } };
    expect(started.chatId).toBe(1001);
    expect(started.systemPrompt).toContain('Quality Audit');
    expect(started.systemPrompt).toContain('definition v1');
    expect(started.systemPrompt).not.toContain('Inspect source');
    expect(local.sent[0]?.messages).toEqual([{ role: 'user', content: expect.stringContaining('Quality Audit') }]);
    const saved = await getLocalAuditRun(store, started.audit.runId);
    expect(saved?.record.payload.status).toBe('completed');
    expect(saved?.record.provenance?.deviceId).toBe('device-1');
    expect(saved?.record.payload.source).toMatchObject({ surface: 'vsix', trigger: 'manual' });
    const findings = await listLocalAuditFindings(store, started.audit.runId);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence).toMatchObject({ title: 'Missing test', location: 'src/a.ts' });
    expect(await store.read((tx) => tx.list('remediation'))).toHaveLength(1);
    execution.dispose();
  });
  it('does not rerun an imported completed audit', async () => {
    local.allowCloud = false;
    const store = local.store!;
    await startLocalAuditRun(store, { deviceId: 'device-1' }, { auditId: 'quality-audit', projectId: 7, trigger: 'manual', runId: 'imported' });
    await saveLocalAuditFindings(store, { deviceId: 'device-1' }, { runId: 'imported', findings: [{ title: 'Imported gap', severity: 'low' }] });
    const before = await listLocalAuditFindings(store, 'imported');
    const runHost = host();
    const execution = new AuditExecution(ctx as never, runHost as never);
    await vi.waitFor(() => expect(state.stored.get(closeKey)).toEqual([]));
    await execution.run('quality-audit', 7, 'manual', 'imported');
    expect(runHost.start).not.toHaveBeenCalled();
    expect(createBrainChat).not.toHaveBeenCalled();
    expect(startSystemAudit).not.toHaveBeenCalled();
    expect(await listLocalAuditFindings(store, 'imported')).toEqual(before);
    execution.dispose();
  });
  it('marks a crashed local audit interrupted and does not resume it', async () => {
    local.allowCloud = false;
    const store = local.store!;
    await startLocalAuditRun(store, { deviceId: 'device-1' }, { auditId: 'quality-audit', projectId: 7, trigger: 'startup', runId: 'crashed' });
    const runHost = host();
    const execution = new AuditExecution(ctx as never, runHost as never);
    await vi.waitFor(async () => {
      expect((await getLocalAuditRun(store, 'crashed'))?.record.payload).toMatchObject({ status: 'interrupted', checkpoint: { safeToResume: false } });
    });
    expect(runHost.start).not.toHaveBeenCalled();
    expect(startSystemAudit).not.toHaveBeenCalled();
    execution.dispose();
  });
  it('queues a close audit locally when cloud audit is denied', async () => {
    local.allowCloud = false;
    state.config = { atClose: true, selected: ['quality-audit'] };
    const store = local.store!;
    const runHost = host();
    const execution = new AuditExecution(ctx as never, runHost as never);
    await vi.waitFor(() => expect(state.stored.get(closeKey)).toHaveLength(1));
    const intent = (state.stored.get(closeKey) as Array<{ requestId: string }>)[0]!;
    await execution.flushClose();
    expect(startSystemAudit).not.toHaveBeenCalled();
    expect(createBrainChat).not.toHaveBeenCalled();
    expect(runHost.start).not.toHaveBeenCalled();
    expect((await getLocalAuditRun(store, intent.requestId))?.record.payload).toMatchObject({
      status: 'completed', trigger: 'close', closedLocally: true,
    });
    expect(state.stored.get(closeKey)).toEqual([]);
    execution.dispose();
  });
  it('marks a close audit closed locally and does not launch a cloud audit', async () => {
    local.allowCloud = true;
    state.config = { atClose: true, selected: ['quality-audit'] };
    const store = local.store!;
    const runHost = host();
    const execution = new AuditExecution(ctx as never, runHost as never);
    await vi.waitFor(() => expect(state.stored.get(closeKey)).toHaveLength(1));
    const intent = (state.stored.get(closeKey) as Array<{ requestId: string }>)[0]!;
    await execution.flushClose();
    expect(startSystemAudit).not.toHaveBeenCalled();
    expect(createBrainChat).not.toHaveBeenCalled();
    expect(runHost.start).not.toHaveBeenCalled();
    const saved = await getLocalAuditRun(store, intent.requestId);
    expect(saved?.record.payload).toMatchObject({
      status: 'completed', trigger: 'close', closedLocally: true, auditId: 'quality-audit', projectId: 7,
    });
    expect(saved?.record.payload.checkpoint).toMatchObject({ safeToResume: false });
    expect(state.stored.get(closeKey)).toEqual([]);
    await execution.flushClose();
    expect(startSystemAudit).not.toHaveBeenCalled();
    expect(runHost.start).not.toHaveBeenCalled();
    execution.dispose();
  });
  it('does not launch a close audit that was already imported', async () => {
    local.allowCloud = false;
    const store = local.store!;
    await startLocalAuditRun(store, { deviceId: 'device-1' }, { auditId: 'quality-audit', projectId: 7, trigger: 'close', runId: 'close-imported', status: 'queued' });
    await saveLocalAuditFindings(store, { deviceId: 'device-1' }, { runId: 'close-imported', findings: [{ title: 'Already filed', severity: 'info' }] });
    state.stored.set(closeKey, [{ projectId: 7, auditId: 'quality-audit', requestId: 'close-imported' }]);
    const runHost = host();
    const execution = new AuditExecution(ctx as never, runHost as never);
    await vi.waitFor(() => expect(state.stored.get(closeKey)).toEqual([]));
    expect(startSystemAudit).not.toHaveBeenCalled();
    expect(createBrainChat).not.toHaveBeenCalled();
    expect(runHost.start).not.toHaveBeenCalled();
    expect((await getLocalAuditRun(store, 'close-imported'))?.record.payload.status).toBe('completed');
    execution.dispose();
  });
  it('fails a local audit that never saved findings instead of leaving it running', async () => {
    local.allowCloud = false;
    const store = local.store!;
    const runHost = host();
    const execution = new AuditExecution(ctx as never, runHost as never);
    await vi.waitFor(() => expect(state.stored.get(closeKey)).toEqual([]));
    await expect(execution.run('quality-audit', 7)).rejects.toThrow('The audit has not saved its findings');
    expect(createBrainChat).not.toHaveBeenCalled();
    expect(startSystemAudit).not.toHaveBeenCalled();
    const started = runHost.start.mock.calls[0]?.[0] as { audit: { runId: string } };
    expect((await getLocalAuditRun(store, started.audit.runId))?.record.payload.status).toBe('failed');
    execution.dispose();
  });
  it('stays local when only the synchronize write is denied', async () => {
    local.allows = (capability) => capability !== 'synchronize';
    const runHost = host();
    const execution = new AuditExecution(ctx as never, runHost as never);
    await vi.waitFor(() => expect(state.stored.get(closeKey)).toEqual([]));
    await expect(execution.run('quality-audit', 7)).rejects.toThrow('The audit has not saved its findings');
    expect(createBrainChat).not.toHaveBeenCalled();
    expect(startSystemAudit).not.toHaveBeenCalled();
    expect(runHost.start).toHaveBeenCalledOnce();
    execution.dispose();
  });
});

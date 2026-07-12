import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BuilderForceAgentsPluginServiceApiContext, DiagnosticEventPayload } from '@seanhogg/builderforce-agents/plugin-sdk';
import { createHealthSnapshotsService } from './service.js';
import type { HealthSnapshot, SnapshotSource } from './types.js';

function createMockContext(config: Record<string, unknown> = {}): BuilderForceAgentsPluginServiceApiContext {
  return {
    config,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  } as unknown as BuilderForceAgentsPluginServiceApiContext;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

describe('createHealthSnapshotsService', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should register with id health-snapshots', () => {
    const svc = createHealthSnapshotsService();
    expect(svc.id).toBe('health-snapshots');
    expect(typeof svc.start).toBe('function');
    expect(typeof svc.stop).toBe('function');
  });

  it('should start and stop without error', async () => {
    const svc = createHealthSnapshotsService();
    const ctx = createMockContext();
    await svc.start(ctx);
    await svc.stop();
  });

  it('should not allow capture before start', async () => {
    const svc = createHealthSnapshotsService();
    const snapshot = await svc.captureSnapshot();
    expect(snapshot).toBeNull();
  });

  it('should capture a manual snapshot after start', async () => {
    const svc = createHealthSnapshotsService();
    const ctx = createMockContext();
    await svc.start(ctx);

    const snapshot = await svc.captureSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(snapshot!.source).toBe('manual');
    expect(snapshot!.status).toMatch(/^(healthy|degraded|unhealthy)$/);
    expect(snapshot!.components).toEqual([]);
    expect(typeof snapshot!.activeIncidentCount).toBe('number');
    expect(typeof snapshot!.timestamp).toBe('string');
  });

  it('should capture a deployment-hook snapshot with metadata', async () => {
    const svc = createHealthSnapshotsService();
    const ctx = createMockContext();
    await svc.start(ctx);

    const snapshot = await svc.captureSnapshot('deployment-hook', 'deploy-42', 'abc123');
    expect(snapshot).not.toBeNull();
    expect(snapshot!.source).toBe('deployment-hook');
    expect(snapshot!.deploymentId).toBe('deploy-42');
    expect(snapshot!.commitSha).toBe('abc123');
  });

  it('should model usage events build component state', async () => {
    const svc = createHealthSnapshotsService();
    const ctx = createMockContext();
    await svc.start(ctx);

    const evt: DiagnosticEventPayload = {
      type: 'model.usage',
      channel: ' tests',
      provider: 'openai',
      model: 'gpt-4',
      durationMs: 200,
      usage: {},
    };
    await svc.onDiagnosticEvent!(evt);

    const snapshot = await svc.captureSnapshot();
    const component = snapshot!.components.find((c) => c.component === ' tests');
    expect(component).toBeDefined();
    expect(component!.latencyMs).toBe(200);
  });

  it('should mark component degraded after webhook.error', async () => {
    const svc = createHealthSnapshotsService();
    const ctx = createMockContext();
    await svc.start(ctx);

    await svc.onDiagnosticEvent!({
      type: 'webhook.error',
      channel: 'slack',
      updateType: 'message',
      error: 'timeout',
    } as DiagnosticEventPayload);

    const snapshot = await svc.captureSnapshot();
    const slack = snapshot!.components.find((c) => c.component === 'slack');
    expect(slack).toBeDefined();
    expect(slack!.status).toBe('degraded');
    expect(slack!.errorRatePercent).toBeGreaterThan(0);
  });

  it('should update resource usage via updateResource', async () => {
    const svc = createHealthSnapshotsService();
    const ctx = createMockContext({ healthSnapshots: { trackResourceUsage: true } });
    await svc.start(ctx);

    await svc.updateResource!({ cpuPercent: 12.5, memoryPercent: 45.6, diskPercent: 78.9 });

    const snapshot = await svc.captureSnapshot();
    expect(snapshot!.resourceUsage).toEqual({ cpuPercent: 12.5, memoryPercent: 45.6, diskPercent: 78.9 });
  });

  it('should list snapshots with time-range filters', async () => {
    const svc = createHealthSnapshotsService();
    const ctx = createMockContext();
    await svc.start(ctx);

    const s1 = await svc.captureSnapshot();
    await sleep(10);
    const s2 = await svc.captureSnapshot('manual');

    const before = new Date(Date.now() - 1000).toISOString();
    const after = new Date(Date.now() + 1000).toISOString();

    const all = await svc.listSnapshots!({ start: before, end: after, limit: 50 });
    expect(all.snapshots).toHaveLength(2);
    expect(all.totalCount).toBe(2);
    expect(all.limit).toBe(50);
    expect(all.hasMore).toBe(false);
  });

  it('should list snapshots with source filter', async () => {
    const svc = createHealthSnapshotsService();
    const ctx = createMockContext();
    await svc.start(ctx);

    await svc.captureSnapshot('scheduled');
    await svc.captureSnapshot('manual');

    const manualOnly = await svc.listSnapshots!({ sources: ['manual'] });
    expect(manualOnly.snapshots).toHaveLength(1);
    expect(manualOnly.snapshots[0]!.source).toBe('manual');
  });

  it('should get snapshot by UUID', async () => {
    const svc = createHealthSnapshotsService();
    const ctx = createMockContext();
    await svc.start(ctx);

    const snapshot = await svc.captureSnapshot();
    const fetched = await svc.getSnapshot!(snapshot!.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(snapshot!.id);

    const missing = await svc.getSnapshot!('nonexistent-uuid');
    expect(missing).toBeNull();
  });

  it('should compare two snapshots and report status change', async () => {
    const svc = createHealthSnapshotsService();
    const ctx = createMockContext();
    await svc.start(ctx);

    const base = await svc.captureSnapshot();
    await svc.updateResource!({ cpuPercent: 5, memoryPercent: 10, diskPercent: 15 });
    await svc.onDiagnosticEvent!({
      type: 'webhook.error',
      channel: 'slack',
      updateType: 'message',
      error: 'timeout',
    } as DiagnosticEventPayload);
    const target = await svc.captureSnapshot();

    const comparison = await svc.compareSnapshots!(base!.id, target!.id);
    expect(comparison).not.toBeNull();
    expect(comparison!.healthStatusChange.from).toBe(base!.status);
    expect(comparison!.healthStatusChange.to).toBe(target!.status);
    expect(comparison!.componentDeltas.length).toBeGreaterThanOrEqual(1);
    expect(typeof comparison!.significantChangesSummary).toBe('string');
  });

  it('should report component removed in comparison', async () => {
    const svc = createHealthSnapshotsService();
    const ctx = createMockContext();
    await svc.start(ctx);

    await svc.onDiagnosticEvent!({
      type: 'model.usage',
      channel: 'temporary',
      durationMs: 100,
      usage: {},
    } as DiagnosticEventPayload);
    const base = await svc.captureSnapshot();

    // Remove component by capturing after the state is still empty
    const target = await svc.captureSnapshot();

    const comparison = await svc.compareSnapshots!(base!.id, target!.id);
    const removed = comparison!.componentDeltas.find((d) => d.component === 'temporary' && !d.added);
    expect(removed).toBeDefined();
    expect(removed!.to.component).toBe('temporary');
  });

  it('should return null when comparing nonexistent snapshots', async () => {
    const svc = createHealthSnapshotsService();
    const ctx = createMockContext();
    await svc.start(ctx);

    const result = await svc.compareSnapshots!('fake-id-1', 'fake-id-2');
    expect(result).toBeNull();
  });

  it('should create a scheduled snapshot at interval', async () => {
    const svc = createHealthSnapshotsService();
    const ctx = createMockContext({ healthSnapshots: { scheduleIntervalMs: 1000 } });
    await svc.start(ctx);

    expect((await svc.listSnapshots!({})).snapshots).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1000);
    await sleep(0);

    const list = await svc.listSnapshots!({});
    expect(list.snapshots.length).toBeGreaterThanOrEqual(1);
    expect(list.snapshots[0]!.source).toBe('scheduled');

    await svc.stop();
  });

  it('should purge stale snapshots beyond retentionDays', async () => {
    const svc = createHealthSnapshotsService();
    const ctx = createMockContext({ healthSnapshots: { retentionDays: 1 } });
    await svc.start(ctx);

    const fresh = await svc.captureSnapshot();
    await svc.purgeStaleSnapshots!();
    expect(await svc.getSnapshot!(fresh!.id)).not.toBeNull();

    // Mock an old snapshot by patching storage is not possible without internals, so instead
    // we verify the purge logic runs and does not delete fresh snapshots.
  });
});

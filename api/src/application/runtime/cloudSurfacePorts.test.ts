/**
 * regression: the cloud hands the agent PORTS (not hooks) — finish, guards, compaction and the publish gate; the guards read the run model from its state.
 */
import { describe, expect, it } from 'vitest';
import type { ShipPolicy } from '@builderforce/run-guards';
import { cloudSurfacePorts, type CloudHookDeps } from './cloudAdapterHooks';

const deps = (over: Partial<CloudHookDeps> = {}): CloudHookDeps => ({
  env: {} as never,
  db: {} as never,
  run: { tenantId: 1, projectId: 1, taskId: 1, executionId: 1 } as never,
  runRole: 'code',
  repoCtx: null,
  delegated: false,
  ladder: [] as never,
  features: () => ({ actionType: 'other' }) as never,
  resolvedModel: () => undefined,
  ...over,
});

describe('cloudSurfacePorts', () => {
  it('binds finish, guards and compaction as ports', () => {
    const ports = cloudSurfacePorts(deps());
    expect(ports.finish).toBeDefined();
    expect(ports.guards).toBeDefined();
    expect(ports.compaction).toBeDefined();
    expect(ports.publishGate).toBeUndefined();
  });

  it('carries the ship policy to the publish gate', () => {
    const ship = { mode: 'pull_request' } as unknown as ShipPolicy;
    expect(cloudSurfacePorts(deps({ ship })).publishGate).toBeDefined();
  });

  it('regression: binds no model port or live-state side channel — the guards default to the run state', () => {
    const ports = cloudSurfacePorts(deps());
    expect((ports.guards as { model?: unknown }).model).toBeUndefined();
    expect('onState' in ports).toBe(false);
  });
});

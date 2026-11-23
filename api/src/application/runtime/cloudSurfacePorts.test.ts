/**
 * regression: the cloud hands the agent PORTS (not hooks) — finish, guards, compaction and the publish gate — and its production
 * callers reach the agent only through `openRun`, each with its entry point named.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunState } from '@builderforce/agent-run';
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
  live: {},
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

  it('the guard ports read and replace the run model through the live state', () => {
    const live: { state?: RunState } = {};
    const guards = cloudSurfacePorts(deps({ live })).guards as { model: { get(): unknown; set(next: unknown): void } };
    expect(() => guards.model.get()).toThrow();
    live.state = { model: { model: 'a' }, messages: [] } as unknown as RunState;
    guards.model.set({ model: 'b' });
    expect((guards.model.get() as { model: string }).model).toBe('b');
  });
});

describe('production callers reach the agent through openRun', () => {
  const root = resolve(__dirname, '..', '..', '..');
  const source = (rel: string): string => readFileSync(resolve(root, rel), 'utf8');
  it.each([
    ['src/application/runtime/cloudAdapter.ts', "entryPoint: 'cloud'"],
    ['src/application/brain/agentReplyRun.ts', "entryPoint: 'cloud'"],
  ])('%s', (file, entry) => {
    const text = source(file);
    expect(text).toMatch(/\bopenRun\(/);
    expect(text).not.toMatch(/\brunAgent\(/);
    expect(text).not.toMatch(/\bmodules:/);
    expect(text).toContain(entry);
  });
});

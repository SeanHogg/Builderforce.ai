/**
 * Capacity classification: only "the container pool is full" earns a wait; every other open
 * failure keeps the no-shell fallback.
 */
import { describe, expect, it } from 'vitest';
import { isSandboxCapacityFailure } from './sandboxCapacity';
import { openRunSandbox } from './runSandbox';
import type { SandboxOpenSpec } from './sandboxOpenSpec';

const SPEC = { executionId: 9 } as unknown as SandboxOpenSpec;
const LIB_503 = 'There is no Container instance available at this time.\nThis is likely because you have reached your max concurrent instance count';

describe('isSandboxCapacityFailure', () => {
  it('recognises the library 503 body and the thrown no-instance error', () => {
    expect(isSandboxCapacityFailure({ status: 503, text: LIB_503 })).toBe(true);
    expect(isSandboxCapacityFailure({ message: 'There is no container instance that can be provided to this durable object' })).toBe(true);
  });
  it('does not treat other failures as capacity', () => {
    expect(isSandboxCapacityFailure({ status: 503, text: 'upstream unavailable' })).toBe(false);
    expect(isSandboxCapacityFailure({ status: 500, text: LIB_503 })).toBe(false);
    expect(isSandboxCapacityFailure({ status: 502, text: '{"ok":false,"error":"clone failed: auth"}' })).toBe(false);
    expect(isSandboxCapacityFailure({ message: 'network connection lost' })).toBe(false);
    expect(isSandboxCapacityFailure({})).toBe(false);
  });
});

describe('openRunSandbox capacity verdict', () => {
  it('flags a full pool', async () => {
    const r = await openRunSandbox({ fetch: async () => new Response(LIB_503, { status: 503 }) }, SPEC);
    expect(r).toMatchObject({ ok: false, capacity: true });
  });
  it('flags a thrown no-instance error', async () => {
    const r = await openRunSandbox({ fetch: async () => { throw new Error('there is no container instance that can be provided to this durable object'); } }, SPEC);
    expect(r.capacity).toBe(true);
  });
  it('leaves a clone failure unflagged', async () => {
    const r = await openRunSandbox({ fetch: async () => new Response(JSON.stringify({ ok: false, error: 'clone failed' }), { status: 502 }) }, SPEC);
    expect(r).toEqual({ ok: false, error: 'clone failed' });
  });
});

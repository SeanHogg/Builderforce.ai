import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GATE_BYPASSED, PLATFORM_GATE_FUNCTION, assertSingleGate, gate } from './platformGate.js';

function thrown(run: () => void): { message?: string; code?: string } | undefined {
  try {
    run();
  } catch (error) {
    return error as { message?: string; code?: string };
  }
  return undefined;
}

describe('platform gate', () => {
  it('proceeds only when the decision action is platform', () => {
    const result = gate({ action: 'platform' });
    expect(result).toEqual({ proceed: true });
    expect(result.proceed).toBe(true);
    expect('reason' in result).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('stays local when the decision action is local', () => {
    expect(gate({ action: 'local' })).toEqual({ proceed: false, reason: 'local_only' });
    expect(gate({ action: 'local' }).proceed).toBe(false);
  });

  it('denies a denied action', () => {
    expect(gate({ action: 'denied' })).toEqual({ proceed: false, reason: 'denied' });
  });

  it('denies a missing decision', () => {
    expect(gate(undefined)).toEqual({ proceed: false, reason: 'denied' });
    expect(gate(null)).toEqual({ proceed: false, reason: 'denied' });
    expect(gate({})).toEqual({ proceed: false, reason: 'denied' });
    expect(gate({ action: undefined })).toEqual({ proceed: false, reason: 'denied' });
    expect(gate({ action: null })).toEqual({ proceed: false, reason: 'denied' });
  });

  it('denies any other action string', () => {
    for (const action of ['allow', 'PLATFORM', 'Local', 'connected', 'synchronize', '']) {
      expect(gate({ action })).toEqual({ proceed: false, reason: 'denied' });
    }
  });

  it('accepts call sites that name gate and no other function', () => {
    expect(PLATFORM_GATE_FUNCTION).toBe('gate');
    expect(() => assertSingleGate([{ functionName: 'gate' }, { name: 'gate' }, gate, 'gate'])).not.toThrow();
    expect(assertSingleGate([])).toBeUndefined();
  });

  it('throws gate_bypassed when a call site names another function', () => {
    const error = thrown(() => assertSingleGate([{ functionName: 'webPlatformFetch' }]));
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe(GATE_BYPASSED);
    expect(error?.code).toBe(GATE_BYPASSED);
    expect(thrown(() => assertSingleGate([{ functionName: 'gate' }, { name: 'bindPlatformPolicy' }]))?.code).toBe(
      GATE_BYPASSED,
    );
    expect(thrown(() => assertSingleGate([function otherGate() {}]))?.code).toBe(GATE_BYPASSED);
    expect(thrown(() => assertSingleGate(['decide']))?.code).toBe(GATE_BYPASSED);
  });

  it('throws gate_bypassed when a call site has no function name', () => {
    expect(thrown(() => assertSingleGate([{}]))?.code).toBe(GATE_BYPASSED);
    expect(thrown(() => assertSingleGate([{ functionName: '' }]))?.code).toBe(GATE_BYPASSED);
    expect(thrown(() => assertSingleGate([{ functionName: null }]))?.code).toBe(GATE_BYPASSED);
    expect(thrown(() => assertSingleGate([{ name: '' }]))?.code).toBe(GATE_BYPASSED);
    expect(thrown(() => assertSingleGate([() => undefined]))?.code).toBe(GATE_BYPASSED);
    expect(thrown(() => assertSingleGate(['']))?.code).toBe(GATE_BYPASSED);
    expect(thrown(() => assertSingleGate([null as unknown as string]))?.code).toBe(GATE_BYPASSED);
    expect(thrown(() => assertSingleGate([undefined as unknown as string]))?.code).toBe(GATE_BYPASSED);
  });

  it('does not import a network client and exports only gate as a decision function', () => {
    const source = readFileSync(new URL('./platformGate.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/import\s+[^;]*\bfetch\b/);
    expect(source).not.toMatch(/from\s+['"]node:(https?|http|net)['"]/);
    const exported = [...source.matchAll(/export function (\w+)/g)].map((match) => match[1]);
    expect(exported.filter((name) => name !== 'assertSingleGate')).toEqual(['gate']);
  });
});

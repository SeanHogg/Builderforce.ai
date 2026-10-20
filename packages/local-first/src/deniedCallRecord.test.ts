import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { recordIfDenied, type DeniedCallRecord } from './deniedCallRecord.js';

describe('denied call record', () => {
  it('records a replayable entry and leaves a denied policy unchanged', () => {
    const policy = Object.freeze({ synchronize: false });
    const before = { ...policy };
    const sink: DeniedCallRecord[] = [];

    const result = recordIfDenied(policy, 'synchronize', sink);

    expect(result).toEqual({ recorded: true });
    expect(result.recorded).toBe(true);
    expect(sink).toEqual([{ capability: 'synchronize', replayable: true }]);
    expect(sink).toHaveLength(1);
    expect(policy).toEqual(before);
    expect(policy).toEqual({ synchronize: false });
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it('pushes nothing and leaves an allowed policy unchanged', () => {
    const policy = Object.freeze({ synchronize: true, authenticate: false });
    const before = { ...policy };
    const sink: DeniedCallRecord[] = [];

    const result = recordIfDenied(policy, 'synchronize', sink);

    expect(result).toEqual({ recorded: false });
    expect(result.recorded).toBe(false);
    expect(sink).toEqual([]);
    expect(policy).toEqual(before);
    expect(policy).toEqual({ synchronize: true, authenticate: false });
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it('does not call fetch and decides through decide', () => {
    const source = readFileSync(new URL('./deniedCallRecord.ts', import.meta.url), 'utf8');
    const forbidden = [
      ['fe', 'tch('].join(''),
      ['globalThis', 'fetch'].join('.'),
      ['Web', 'Socket'].join(''),
      ['node:', 'http'].join(''),
      ['node:', 'net'].join(''),
    ];
    for (const needle of forbidden) {
      expect(source.includes(needle)).toBe(false);
    }
    expect(source).toContain("from './enforcePlatform.js'");
    expect(source).toContain('decide(policy, capability)');
    expect(source).toMatch(/export function recordIfDenied/);
    expect(source).not.toMatch(/\bpolicy\s*\[/);
    expect(source).not.toMatch(/\bpolicy\.\w+\s*=/);
  });
});

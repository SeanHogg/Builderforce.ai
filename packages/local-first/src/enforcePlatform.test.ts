import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decide } from './enforcePlatform.js';

describe('enforce platform capability', () => {
  it('allows only when the policy capability is exactly true', () => {
    const result = decide({ synchronize: true }, 'synchronize');
    expect(result).toEqual({ proceed: true, action: 'allowed' });
    expect(result.proceed).toBe(true);
    expect(result.action).toBe('allowed');
    expect(Object.isFrozen(result)).toBe(true);
    expect(decide({ synchronize: false, 'gateway-inference': true }, 'gateway-inference')).toEqual({
      proceed: true,
      action: 'allowed',
    });
  });

  it('denies when the policy capability is false', () => {
    const result = decide({ synchronize: false }, 'synchronize');
    expect(result).toEqual({ proceed: false, action: 'denied' });
    expect(result.proceed).toBe(false);
    expect(result.action).toBe('denied');
    expect(Object.isFrozen(result)).toBe(true);
    expect(decide({ synchronize: true, authenticate: false }, 'authenticate').proceed).toBe(false);
  });

  it('denies when the capability is undefined', () => {
    expect(decide({ synchronize: undefined }, 'synchronize')).toEqual({ proceed: false, action: 'denied' });
    expect(decide({}, 'synchronize')).toEqual({ proceed: false, action: 'denied' });
    expect(decide({ synchronize: true }, undefined)).toEqual({ proceed: false, action: 'denied' });
    expect(decide({ synchronize: true }, null)).toEqual({ proceed: false, action: 'denied' });
    expect(decide({ synchronize: true })).toEqual({ proceed: false, action: 'denied' });
  });

  it('denies a missing policy', () => {
    expect(decide(undefined, 'synchronize')).toEqual({ proceed: false, action: 'denied' });
    expect(decide(null, 'synchronize')).toEqual({ proceed: false, action: 'denied' });
    expect(decide(undefined, undefined)).toEqual({ proceed: false, action: 'denied' });
  });

  it('denies a non-boolean policy value', () => {
    for (const value of [1, 'true', 'false', {}, [], 'synchronize']) {
      expect(decide({ synchronize: value }, 'synchronize')).toEqual({ proceed: false, action: 'denied' });
    }
  });

  it('does not fetch, open a socket, or read a host setting', () => {
    const source = readFileSync(new URL('./enforcePlatform.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/import\s+[^;]*\bfetch\b/);
    expect(source).not.toMatch(/from\s+['"]node:(https?|http|net|fs|os)['"]/);
    expect(source).not.toMatch(/\bWebSocket\b/);
    expect(source).not.toMatch(/\bprocess\.env\b/);
    expect(source).not.toMatch(/\blocalStorage\b/);
    const exported = [...source.matchAll(/export function (\w+)/g)].map((match) => match[1]);
    expect(exported).toEqual(['decide']);
  });
});

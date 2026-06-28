import { describe, it, expect } from 'vitest';
import { computeFingerprint, normalizeLevel, eventTitle, type NormalizedErrorEvent } from './errorSpec';

function ev(p: Partial<NormalizedErrorEvent>): NormalizedErrorEvent {
  return { type: 'Error', message: 'm', level: 'error', timestamp: '2026-01-01T00:00:00Z', source: 'native', ...p };
}

describe('normalizeLevel', () => {
  it('maps aliases to the four canonical levels', () => {
    expect(normalizeLevel('critical')).toBe('fatal');
    expect(normalizeLevel('ERR')).toBe('error');
    expect(normalizeLevel('warn')).toBe('warning');
    expect(normalizeLevel('debug')).toBe('info');
    expect(normalizeLevel(undefined)).toBe('error');
    expect(normalizeLevel('nonsense')).toBe('error');
  });
});

describe('computeFingerprint', () => {
  it('honors an explicit fingerprint', async () => {
    expect(await computeFingerprint(ev({ fingerprint: 'abc-123' }))).toBe('abc-123');
  });

  it('groups two events that differ only in volatile numbers/ids/quotes', async () => {
    const a = await computeFingerprint(ev({ type: 'TypeError', message: "Cannot read 'x' of undefined at id 12345", stack: [{ function: 'f', file: 'a.js', line: 10 }] }));
    const b = await computeFingerprint(ev({ type: 'TypeError', message: 'Cannot read "x" of undefined at id 98765', stack: [{ function: 'f', file: 'a.js', line: 10 }] }));
    expect(a).toBe(b);
  });

  it('separates genuinely different errors', async () => {
    const a = await computeFingerprint(ev({ type: 'TypeError', message: 'boom' }));
    const b = await computeFingerprint(ev({ type: 'RangeError', message: 'boom' }));
    expect(a).not.toBe(b);
  });
});

describe('eventTitle', () => {
  it('prefixes the type when not already present', () => {
    expect(eventTitle(ev({ type: 'TypeError', message: 'x is undefined' }))).toBe('TypeError: x is undefined');
  });
  it('does not double-prefix', () => {
    expect(eventTitle(ev({ type: 'Error', message: 'Error: already prefixed' }))).toBe('Error: already prefixed');
  });
});

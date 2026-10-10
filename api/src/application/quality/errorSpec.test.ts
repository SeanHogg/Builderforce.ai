import { describe, it, expect } from 'vitest';
import { computeFingerprint, normalizeLevel, eventTitle, stableFrameFile, type NormalizedErrorEvent } from './errorSpec';

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

  it('spans deploys: the same error at shifted bundle positions and a different release is ONE group', async () => {
    // Production shape (2026-10): the identical Cerebras 404 thrown from the Worker
    // bundle at index.js:40196 / :40262 across releases opened a group per deploy.
    const msg = '[cerebras/llama3.1-8b] 404: {"message":"Model does not exist"}';
    const a = await computeFingerprint(ev({
      type: 'VendorRetryableError', message: msg, release: '2026.10.17',
      stack: [{ function: null, file: 'index.js', line: 40196, column: 13 }, { function: 'throwWithUpstreamDiagnostic', file: 'index.js', line: 40053, column: 5 }],
    }));
    const b = await computeFingerprint(ev({
      type: 'VendorRetryableError', message: msg, release: '2026.10.18',
      stack: [{ function: null, file: 'index.js', line: 40262, column: 15 }, { function: 'throwWithUpstreamDiagnostic', file: 'index.js', line: 40099, column: 5 }],
    }));
    expect(a).toBe(b);
  });

  it('ignores content-hashed chunk names and positions in a raw string stack', async () => {
    const a = await computeFingerprint(ev({ type: 'TypeError', message: 'boom', stack: 'TypeError: boom\n    at renderCard (https://app.example/_next/static/chunks/app/page-3f2a9c1b7d4e5f60.js:1:2345)' }));
    const b = await computeFingerprint(ev({ type: 'TypeError', message: 'boom', stack: 'TypeError: boom\n    at renderCard (https://app.example/_next/static/chunks/app/page-9a8b7c6d5e4f3a21.js:1:9876)' }));
    expect(a).toBe(b);
  });

  it('still separates the same message thrown from different named functions', async () => {
    const a = await computeFingerprint(ev({ message: 'boom', stack: [{ function: 'loadBoard', file: 'index.js', line: 1 }] }));
    const b = await computeFingerprint(ev({ message: 'boom', stack: [{ function: 'saveBoard', file: 'index.js', line: 1 }] }));
    expect(a).not.toBe(b);
  });
});

describe('stableFrameFile', () => {
  it('reduces a frame file to its hash-free basename', () => {
    expect(stableFrameFile('https://x/_next/static/chunks/app/page-3f2a9c1b7d4e5f60.js?v=1')).toBe('page.js');
    expect(stableFrameFile('index.js')).toBe('index.js');
    expect(stableFrameFile('/src/my-component.js')).toBe('my-component.js');
    expect(stableFrameFile(null)).toBe('');
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

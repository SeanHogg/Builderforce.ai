import { describe, expect, it, vi } from 'vitest';
import { errorFingerprint, errorMark, firstFrame, watchErrors } from './errors';

const V8_STACK = [
  "TypeError: Cannot read properties of undefined (reading 'x')",
  '    at render (https://shop.example/app.3f9a1c2b.js?v=7:10:20)',
  '    at main (https://shop.example/app.3f9a1c2b.js:30:5)',
].join('\n');

describe('firstFrame', () => {
  it('reads the first V8 frame without its query string', () => {
    expect(firstFrame(V8_STACK)).toBe('at render (https://shop.example/app.3f9a1c2b.js:10:20)');
  });

  it('reads a Firefox / Safari frame', () => {
    expect(firstFrame('render@https://shop.example/app.js:10:20\nmain@https://shop.example/app.js:30:5')).toBe(
      'render@https://shop.example/app.js:10:20',
    );
  });

  it('is empty without a stack', () => {
    expect(firstFrame(undefined)).toBe('');
  });
});

describe('errorFingerprint', () => {
  it('ignores digits in the message', () => {
    expect(errorFingerprint('Row 17 is missing', V8_STACK)).toBe(errorFingerprint('Row 18 is missing', V8_STACK));
  });

  it('differs by frame and by message text', () => {
    const base = errorFingerprint('Boom', V8_STACK);
    expect(errorFingerprint('Bang', V8_STACK)).not.toBe(base);
    expect(errorFingerprint('Boom', 'at other (https://x/y.js:1:1)')).not.toBe(base);
  });
});

describe('errorMark', () => {
  it('caps the message at 120 chars and keys by fingerprint', () => {
    const message = 'x'.repeat(300);
    const mark = errorMark(message, V8_STACK, 42);
    expect(mark).toMatchObject({ kind: 'error', atMs: 42, key: errorFingerprint(message, V8_STACK) });
    expect(mark.label).toHaveLength(120);
    expect(mark.key).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('watchErrors', () => {
  it('reports window errors and unhandled rejections', () => {
    const onError = vi.fn();
    const stop = watchErrors(onError);
    const err = new Error('kaput');
    window.dispatchEvent(new ErrorEvent('error', { message: 'kaput', error: err }));
    const rejection = new Event('unhandledrejection') as Event & { reason?: unknown };
    rejection.reason = new Error('rejected');
    window.dispatchEvent(rejection);
    stop();
    window.dispatchEvent(new ErrorEvent('error', { message: 'after stop' }));
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenNthCalledWith(1, 'kaput', err.stack);
    expect(onError.mock.calls[1]![0]).toBe('rejected');
  });
});

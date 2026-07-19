import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isChunkLoadError,
  chunkRecoveryAlreadyAttempted,
  recoverFromChunkError,
} from './chunkErrorRecovery';

describe('isChunkLoadError', () => {
  it('matches the ChunkLoadError name', () => {
    const err = Object.assign(new Error('boom'), { name: 'ChunkLoadError' });
    expect(isChunkLoadError(err)).toBe(true);
  });

  it('matches the reported stale-runtime signature (NN.undefined.js)', () => {
    // The exact production symptom from the support ticket.
    const err = new Error(
      'Loading chunk 466 failed.\n(missing: https://builderforce.ai/_next/static/chunks/466.undefined.js)',
    );
    expect(isChunkLoadError(err)).toBe(true);
  });

  it('matches the dynamic-import failure message', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module'))).toBe(true);
  });

  it('matches a CSS chunk failure', () => {
    expect(isChunkLoadError(new Error('Loading CSS chunk 12 failed'))).toBe(true);
  });

  it('does NOT match unrelated errors', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError(new TypeError('x is not a function'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe('chunk reload loop guard', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('reports no attempt when nothing is stored', () => {
    expect(chunkRecoveryAlreadyAttempted()).toBe(false);
  });

  it('reports an attempt within the 30s window', () => {
    sessionStorage.setItem('bf-chunk-reload-at', String(Date.now()));
    expect(chunkRecoveryAlreadyAttempted()).toBe(true);
  });

  it('lapses after the window so a fresh incident can heal again', () => {
    sessionStorage.setItem('bf-chunk-reload-at', String(Date.now() - 60_000));
    expect(chunkRecoveryAlreadyAttempted()).toBe(false);
  });

  it('does not reload again inside the window (loop guard)', async () => {
    const reload = vi.fn();
    // jsdom's location.reload throws "not implemented"; stub it.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });
    sessionStorage.setItem('bf-chunk-reload-at', String(Date.now()));
    await recoverFromChunkError(); // not forced
    expect(reload).not.toHaveBeenCalled();
  });
});

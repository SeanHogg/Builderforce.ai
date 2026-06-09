import { describe, it, expect } from 'vitest';
import { resolveCloudSurface } from './cloudDispatch';

describe('resolveCloudSurface', () => {
  it('an explicitly-pinned self-hosted host is always a long-lived node', () => {
    expect(resolveCloudSurface('durable', true)).toBe('node');
    expect(resolveCloudSurface(undefined, true)).toBe('node');
  });

  it('honors the agent\'s chosen surface when no host is pinned', () => {
    expect(resolveCloudSurface('node', false)).toBe('node');
    expect(resolveCloudSurface('durable', false)).toBe('durable');
  });

  it('defaults to durable for an unset/unknown surface (runs with no infra)', () => {
    expect(resolveCloudSurface(undefined, false)).toBe('durable');
    expect(resolveCloudSurface(null, false)).toBe('durable');
    expect(resolveCloudSurface('something-else', false)).toBe('durable');
  });
});

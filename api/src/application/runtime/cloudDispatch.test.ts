import { describe, it, expect } from 'vitest';
import { resolveCloudSurface } from './cloudDispatch';

describe('resolveCloudSurface', () => {
  it('an explicitly-pinned host is a long-lived (container/relay) runtime', () => {
    expect(resolveCloudSurface('durable', true)).toBe('container');
    expect(resolveCloudSurface(undefined, true)).toBe('container');
  });

  it('honors the agent\'s chosen surface when no host is pinned', () => {
    expect(resolveCloudSurface('container', false)).toBe('container');
    expect(resolveCloudSurface('durable', false)).toBe('durable');
  });

  it('defaults to durable for an unset/unknown surface (on-demand, no always-on infra)', () => {
    expect(resolveCloudSurface(undefined, false)).toBe('durable');
    expect(resolveCloudSurface(null, false)).toBe('durable');
    expect(resolveCloudSurface('something-else', false)).toBe('durable');
  });
});

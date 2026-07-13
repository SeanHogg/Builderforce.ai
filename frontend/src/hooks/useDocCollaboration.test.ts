import { describe, it, expect } from 'vitest';
import { shouldSeed } from './useDocCollaboration';

describe('shouldSeed', () => {
  it('a lone first editor with content seeds', () => {
    expect(shouldSeed('user-a', [], true, true)).toBe(true);
  });

  it('never seeds when the shared text is already non-empty', () => {
    expect(shouldSeed('user-a', [], false, true)).toBe(false);
  });

  it('never seeds without initial content', () => {
    expect(shouldSeed('user-a', [], true, false)).toBe(false);
  });

  it('only the smallest userId seeds when several open a fresh doc at once', () => {
    expect(shouldSeed('user-a', ['user-b', 'user-c'], true, true)).toBe(true);
    expect(shouldSeed('user-b', ['user-a', 'user-c'], true, true)).toBe(false);
    expect(shouldSeed('user-c', ['user-a', 'user-b'], true, true)).toBe(false);
  });

  it('exactly one of a concurrent pair seeds (deterministic, order-independent)', () => {
    const seeders = [
      shouldSeed('z', ['a'], true, true),
      shouldSeed('a', ['z'], true, true),
    ].filter(Boolean);
    expect(seeders).toHaveLength(1);
  });
});

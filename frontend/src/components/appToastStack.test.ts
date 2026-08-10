import { describe, it, expect } from 'vitest';
import { computeSlot, type AppToastId } from './appToastStack';

describe('computeSlot', () => {
  it('puts a lone toast in slot 0 (normal bottom position)', () => {
    expect(computeSlot(['update'], 'update')).toBe(0);
    expect(computeSlot(['install'], 'install')).toBe(0);
  });

  it('stacks the update banner below the install prompt when both are live', () => {
    const live: AppToastId[] = ['install', 'update'];
    // update has the lower priority → bottom-most row (slot 0); install sits above.
    expect(computeSlot(live, 'update')).toBe(0);
    expect(computeSlot(live, 'install')).toBe(1);
  });

  it('order is independent of insertion order', () => {
    expect(computeSlot(['update', 'install'], 'install')).toBe(1);
    expect(computeSlot(['install', 'update'], 'install')).toBe(1);
  });

  it('returns -1 for an id that is not live', () => {
    expect(computeSlot(['update'], 'install')).toBe(-1);
  });
});

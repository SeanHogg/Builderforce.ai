import { describe, expect, it } from 'vitest';
import { EventRing } from './buffer';

describe('EventRing', () => {
  it('keeps the last two checkout segments, each starting at a snapshot', () => {
    const ring = new EventRing();
    ring.push('meta-1', true);
    ring.push('full-1', true);
    ring.push('inc-1', false);
    ring.push('meta-2', true);
    ring.push('full-2', true);
    ring.push('inc-2', false);
    ring.push('meta-3', true);
    ring.push('full-3', true);
    ring.push('inc-3', false);
    expect(ring.size).toBe(6);
    expect(ring.drain()).toEqual(['meta-2', 'full-2', 'inc-2', 'meta-3', 'full-3', 'inc-3']);
    expect(ring.size).toBe(0);
    expect(ring.drain()).toEqual([]);
  });

  it('holds everything before the first rotation', () => {
    const ring = new EventRing();
    ring.push('meta-1', true);
    ring.push('full-1', true);
    ring.push('inc-1', false);
    expect(ring.drain()).toEqual(['meta-1', 'full-1', 'inc-1']);
  });
});

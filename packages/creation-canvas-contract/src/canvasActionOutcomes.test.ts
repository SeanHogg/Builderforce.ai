import { describe, expect, it } from 'vitest';
import {
  CANVAS_ACTION_OUTCOMES,
  canvasActionOutcomes,
  canvasOutcomeReachable,
} from './canvasActionOutcomes';

describe('canvasActionOutcomes', () => {
  it('maps the cheap idea path onto the proof lifecycle', () => {
    expect(canvasActionOutcomes('idea', 'explore')).toEqual([
      { action: 'idea.read', successPhase: 'succeeded' },
    ]);
    expect(canvasActionOutcomes('idea', 'test')).toEqual([
      { action: 'proof.choose', successPhase: 'succeeded', targetKey: 'smoke-test' },
    ]);
    expect(canvasActionOutcomes('idea', 'reveal')).toEqual([
      { action: 'proof.grade', successPhase: 'validated' },
    ]);
  });

  it('treats publishing a form as both a deliverable and a reachable proof', () => {
    expect(canvasActionOutcomes('form', 'publish')).toEqual([
      { action: 'artifact.publish', successPhase: 'succeeded', reachableField: 'joinUrl' },
      { action: 'proof.build', successPhase: 'succeeded', reachableField: 'joinUrl', targetKey: 'smoke-test' },
    ]);
  });

  it('treats publishing a poll the same way, from its join URL', () => {
    expect(canvasActionOutcomes('poll', 'publish')).toEqual([
      { action: 'artifact.publish', successPhase: 'succeeded', reachableField: 'joinUrl' },
      { action: 'proof.build', successPhase: 'succeeded', reachableField: 'joinUrl' },
    ]);
  });

  it('falls back to kind.action so an unmapped connected act still correlates', () => {
    expect(canvasActionOutcomes('invoice', 'issue')).toEqual([
      { action: 'invoice.issue', successPhase: 'succeeded' },
    ]);
    expect(canvasActionOutcomes('poll', 'open')).toEqual([
      { action: 'poll.open', successPhase: 'succeeded' },
    ]);
  });

  it('every special-case row names a real action and a terminal phase', () => {
    for (const [key, specs] of Object.entries(CANVAS_ACTION_OUTCOMES)) {
      expect(specs.length, key).toBeGreaterThan(0);
      for (const spec of specs) {
        expect(spec.action, key).toBeTruthy();
        expect(['succeeded', 'validated', 'reused']).toContain(spec.successPhase);
      }
    }
  });
});

describe('canvasOutcomeReachable', () => {
  it('accepts an absolute http(s) address and a same-origin path', () => {
    expect(canvasOutcomeReachable('https://example.com/f/abc')).toBe(true);
    expect(canvasOutcomeReachable('/f/abc')).toBe(true);
    expect(canvasOutcomeReachable('/p/xyz')).toBe(true);
  });

  it('refuses empty, relative-without-slash, and non-strings', () => {
    expect(canvasOutcomeReachable('')).toBe(false);
    expect(canvasOutcomeReachable('   ')).toBe(false);
    expect(canvasOutcomeReachable('/')).toBe(false);
    expect(canvasOutcomeReachable('f/abc')).toBe(false);
    expect(canvasOutcomeReachable(null)).toBe(false);
    expect(canvasOutcomeReachable(42)).toBe(false);
  });
});

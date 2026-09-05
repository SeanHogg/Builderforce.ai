import { describe, it, expect } from 'vitest';
import { phaseLine, formatElapsed, DEFAULT_LIVE_ACTIVITY_LABELS, SLOW_AFTER_MS } from './LiveActivity';
import type { BrainRunActivity } from '@seanhogg/builderforce-brain-embedded';

const L = DEFAULT_LIVE_ACTIVITY_LABELS;
const at = (over: Partial<BrainRunActivity>): BrainRunActivity =>
  ({ phase: 'thinking', startedAt: 0, step: 1, ...over });

describe('formatElapsed', () => {
  it('counts seconds under a minute', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(59_400)).toBe('59s');
  });

  it('pads the seconds past a minute so the counter does not jitter in width', () => {
    expect(formatElapsed(60_000)).toBe('1m 00s');
    expect(formatElapsed(67_000)).toBe('1m 07s');
    expect(formatElapsed(125_000)).toBe('2m 05s');
  });

  it('never renders a negative clock from a skewed timestamp', () => {
    expect(formatElapsed(-5_000)).toBe('0s');
  });
});

describe('phaseLine', () => {
  it('names the tool AND what it is working on', () => {
    const line = phaseLine(at({ phase: 'tool', label: 'read_file', detail: 'LandingCanvasHero.module.css' }), L);
    expect(line).toBe('Running read_file on LandingCanvasHero.module.css');
  });

  it('names the tool alone when the call has no subject', () => {
    expect(phaseLine(at({ phase: 'tool', label: 'list_files' }), L)).toBe('Running list_files');
  });

  it('makes an awaiting turn read as the USER\'s move, not as work in progress', () => {
    const line = phaseLine(at({ phase: 'awaiting', label: 'edit_file' }), L);
    expect(line).toContain('Waiting for you');
    expect(line).toContain('edit_file');
  });

  it('has a distinct line for every phase', () => {
    const phases: BrainRunActivity['phase'][] = ['starting', 'thinking', 'writing', 'tool', 'awaiting', 'finishing'];
    const lines = phases.map((phase) => phaseLine(at({ phase, label: 'x' }), L));
    expect(new Set(lines).size).toBe(phases.length);
  });

  it('substitutes from the caller\'s bundle, never from the English defaults', () => {
    const de = { ...L, tool: '{tool} wird ausgeführt', on: ' an {target}' };
    expect(phaseLine(at({ phase: 'tool', label: 'read_file', detail: 'a.css' }), de))
      .toBe('read_file wird ausgeführt an a.css');
  });
});

describe('the slow threshold', () => {
  it('sits below the point a user starts assuming a hang', () => {
    // The capture that motivated this had a 67-second tool call showing a static
    // label. Whatever the exact number, the reassurance has to arrive well inside it.
    expect(SLOW_AFTER_MS).toBeLessThan(67_000);
    expect(SLOW_AFTER_MS).toBeGreaterThan(5_000);
  });
});

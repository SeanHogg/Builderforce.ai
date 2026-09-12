import { describe, expect, it } from 'vitest';
import {
  STATUS_TONES,
  statusColor,
  statusPillStyle,
  statusTone,
  toneColor,
  tonePillStyle,
  type StatusTone,
  type StatusToneMap,
} from './statusTone';

type Milestone = 'draft' | 'funded' | 'approved' | 'disputed';
const MILESTONE_TONE: StatusToneMap<Milestone> = {
  draft: 'neutral',
  funded: 'info',
  approved: 'success',
  disputed: 'danger',
};

describe('statusTone', () => {
  it('resolves a known status through its map', () => {
    expect(statusTone(MILESTONE_TONE, 'approved')).toBe('success');
    expect(statusTone(MILESTONE_TONE, 'disputed')).toBe('danger');
  });

  it('falls back for an unknown, null or undefined status instead of returning undefined', () => {
    expect(statusTone(MILESTONE_TONE, 'shipped_after_ui')).toBe('neutral');
    expect(statusTone(MILESTONE_TONE, null)).toBe('neutral');
    expect(statusTone(MILESTONE_TONE, undefined)).toBe('neutral');
    expect(statusTone(MILESTONE_TONE, 'nope', 'warning')).toBe('warning');
  });

  it('renders every tone in every rendering as a theme token, never a literal', () => {
    for (const tone of STATUS_TONES) {
      for (const rendering of ['text', 'solid', 'bg', 'border'] as const) {
        expect(toneColor(tone, rendering)).toMatch(/^var\(--[a-z-]+\)$/);
      }
    }
  });

  it('uses the AA text token for labels and the solid token for marks', () => {
    expect(toneColor('success')).toBe('var(--success-text)');
    expect(toneColor('success', 'solid')).toBe('var(--success)');
    expect(toneColor('danger')).toBe('var(--error-text)');
    expect(toneColor('danger', 'solid')).toBe('var(--error)');
    expect(statusColor(MILESTONE_TONE, 'funded', 'solid')).toBe('var(--info)');
  });

  it('builds a pill from ONE tone so foreground, fill and outline cannot disagree', () => {
    expect(tonePillStyle('warning')).toEqual({
      color: 'var(--warning-text)',
      background: 'var(--warning-bg)',
      borderColor: 'var(--warning-border)',
    });
    expect(statusPillStyle(MILESTONE_TONE, 'unknown')).toEqual(tonePillStyle('neutral'));
  });

  it('keeps the tone vocabulary identical to the Badge tones', () => {
    const badgeTones: StatusTone[] = ['neutral', 'accent', 'info', 'success', 'warning', 'danger'];
    expect([...STATUS_TONES].sort()).toEqual([...badgeTones].sort());
  });
});

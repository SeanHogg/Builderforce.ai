import { describe, expect, it } from 'vitest';
import {
  canTransition, dueStatuses, editableStatuses, isArmed, isDone, isInFlight, mayEdit, mayStart,
  phaseOf, restingStatus, statusesIn, type CampaignKind, type CampaignPhase,
} from './campaignLifecycle';

// Every stored status of each channel, with what each predicate must say.
const CASES: Array<[CampaignKind, string, { phase: CampaignPhase; edit: boolean; start: boolean }]> = [
  ['email', 'draft', { phase: 'draft', edit: true, start: true }],
  ['email', 'sending', { phase: 'in_flight', edit: false, start: false }],
  ['email', 'sent', { phase: 'done', edit: false, start: false }],
  ['email', 'failed', { phase: 'failed', edit: false, start: false }],
  ['social', 'draft', { phase: 'draft', edit: true, start: true }],
  ['social', 'scheduled', { phase: 'armed', edit: true, start: true }],
  ['social', 'publishing', { phase: 'in_flight', edit: false, start: false }],
  ['social', 'published', { phase: 'done', edit: false, start: false }],
  ['social', 'failed', { phase: 'failed', edit: true, start: true }],
];

describe('campaign lifecycle — every status through every predicate', () => {
  it.each(CASES)('%s %s', (kind, status, want) => {
    expect(phaseOf(kind, status)).toBe(want.phase);
    expect(mayEdit(kind, status)).toBe(want.edit);
    expect(mayStart(kind, status)).toBe(want.start);
    expect(isInFlight(kind, status)).toBe(want.phase === 'in_flight');
    expect(isArmed(kind, status)).toBe(want.phase === 'armed');
    expect(isDone(kind, status)).toBe(want.phase === 'done');
  });

  it('knows nothing about a status the channel never writes', () => {
    for (const kind of ['email', 'social'] as const) {
      expect(phaseOf(kind, 'bogus')).toBeUndefined();
      expect([mayEdit(kind, 'bogus'), mayStart(kind, 'bogus'), isInFlight(kind, 'bogus'), isDone(kind, 'bogus')]).toEqual([false, false, false, false]);
    }
    // 'scheduled' is a social status; an email waits as a draft.
    expect(phaseOf('email', 'scheduled')).toBeUndefined();
  });
});

describe('campaign lifecycle — stored strings behind the SQL predicates', () => {
  it('derives the exact statuses the sweeps and edit guard used to spell out', () => {
    expect(statusesIn('email', 'in_flight')).toEqual(['sending']);
    expect(dueStatuses('email')).toEqual(['draft']);
    expect(editableStatuses('email')).toEqual(['draft']);
    expect(statusesIn('social', 'in_flight')).toEqual(['publishing']);
    expect(dueStatuses('social')).toEqual(['scheduled']);
    expect(editableStatuses('social')).toEqual(['draft', 'scheduled', 'failed']);
  });
});

describe('campaign lifecycle — transitions', () => {
  it('lets an email move draft → sending → sent | failed and nowhere after', () => {
    expect(canTransition('email', 'draft', 'sending')).toBe(true);
    expect(canTransition('email', 'sending', 'sent')).toBe(true);
    expect(canTransition('email', 'sending', 'failed')).toBe(true);
    expect(canTransition('email', 'sent', 'sending')).toBe(false);
    expect(canTransition('email', 'failed', 'sending')).toBe(false);
    expect(canTransition('email', 'draft', 'sent')).toBe(false);
  });

  it('lets a social campaign be armed, disarmed, run, settled and re-run after failing', () => {
    expect(canTransition('social', 'draft', 'scheduled')).toBe(true);
    expect(canTransition('social', 'scheduled', 'draft')).toBe(true);
    expect(canTransition('social', 'scheduled', 'publishing')).toBe(true);
    expect(canTransition('social', 'publishing', 'published')).toBe(true);
    expect(canTransition('social', 'publishing', 'failed')).toBe(true);
    expect(canTransition('social', 'failed', 'publishing')).toBe(true);
    expect(canTransition('social', 'published', 'publishing')).toBe(false);
    expect(canTransition('social', 'publishing', 'draft')).toBe(false);
  });

  it('never treats staying put or an unknown status as a transition', () => {
    expect(canTransition('email', 'draft', 'draft')).toBe(false);
    expect(canTransition('social', 'bogus', 'draft')).toBe(false);
  });

  it('only moves to statuses the channel knows', () => {
    for (const [kind, status] of CASES.map(([k, s]) => [k, s] as const)) {
      for (const to of ['draft', 'scheduled', 'sending', 'sent', 'publishing', 'published', 'failed']) {
        if (canTransition(kind, status, to)) expect(phaseOf(kind, to)).toBeDefined();
      }
    }
  });
});

describe('campaign lifecycle — resting status', () => {
  it('is armed only where a channel has an armed phase', () => {
    expect(restingStatus('social', true)).toBe('scheduled');
    expect(restingStatus('social', false)).toBe('draft');
    expect(restingStatus('email', true)).toBe('draft');
    expect(restingStatus('email', false)).toBe('draft');
  });
});

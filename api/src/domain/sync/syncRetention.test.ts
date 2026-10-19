import { describe, expect, it } from 'vitest';
import {
  RETENTION_NOTE,
  SYNC_CHANGE_RETENTION_DAYS,
  SYNC_EVENT_RETENTION_DAYS,
  shouldSweep,
  uniquenessSurvivesRetention,
} from './syncRetention.js';

describe('sync retention', () => {
  it('publishes the two retention windows the epic requires', () => {
    expect(SYNC_EVENT_RETENTION_DAYS).toBe(90);
    expect(SYNC_CHANGE_RETENTION_DAYS).toBe(30);
  });

  it('sweeps sync_events at 90 days and not before', () => {
    expect(shouldSweep('sync_events', 89)).toBe(false);
    expect(shouldSweep('sync_events', 89.999)).toBe(false);
    expect(shouldSweep('sync_events', 90)).toBe(true);
    expect(shouldSweep('sync_events', 91)).toBe(true);
    expect(shouldSweep('sync_events', 0)).toBe(false);
  });

  it('sweeps sync_changes at 30 days and not before', () => {
    expect(shouldSweep('sync_changes', 29)).toBe(false);
    expect(shouldSweep('sync_changes', 29.999)).toBe(false);
    expect(shouldSweep('sync_changes', 30)).toBe(true);
    expect(shouldSweep('sync_changes', 31)).toBe(true);
  });

  it('never sweeps a table it does not own, at any age', () => {
    for (const table of ['tasks', 'sync_receipts', 'journal_events', 'sync_cursors', '']) {
      expect(shouldSweep(table, 0)).toBe(false);
      expect(shouldSweep(table, 30)).toBe(false);
      expect(shouldSweep(table, 90)).toBe(false);
      expect(shouldSweep(table, 10_000)).toBe(false);
    }
  });

  it('refuses a non-finite age rather than sweeping on it', () => {
    expect(shouldSweep('sync_events', Number.NaN)).toBe(false);
    expect(shouldSweep('sync_events', Number.POSITIVE_INFINITY)).toBe(false);
    expect(shouldSweep('sync_changes', Number.NEGATIVE_INFINITY)).toBe(false);
    expect(shouldSweep('sync_events', -1)).toBe(false);
  });

  it('keeps event-id uniqueness only inside the event retention window', () => {
    expect(uniquenessSurvivesRetention(0)).toBe(true);
    expect(uniquenessSurvivesRetention(89)).toBe(true);
    expect(uniquenessSurvivesRetention(89.999)).toBe(true);
    expect(uniquenessSurvivesRetention(90)).toBe(false);
    expect(uniquenessSurvivesRetention(91)).toBe(false);
    expect(uniquenessSurvivesRetention(Number.NaN)).toBe(false);
  });

  it('states in words that uniqueness does not survive retention and a late replay is a new accept', () => {
    expect(RETENTION_NOTE).toMatch(/uniqueness does not survive retention/i);
    expect(RETENTION_NOTE).toContain('90');
    expect(RETENTION_NOTE).toContain('30');
    expect(RETENTION_NOTE).toMatch(/new accept/i);
    expect(RETENTION_NOTE).toMatch(/rather than a duplicate/i);
  });
});
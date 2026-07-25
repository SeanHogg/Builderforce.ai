import { describe, it, expect } from 'vitest';
import { composeDispatcherLabel, MAX_SUBMITTED_BY_CHARS } from './dispatcherLabel';

/**
 * The bug this composer exists to prevent: `executions.submitted_by` was varchar(36)
 * and `laneRequirementGate` built `${base}:lane-approver:${roleKey}` by raw template.
 * With a base of `system:coordinator` that leaves THREE characters for the role key,
 * so every board configured with a real role name threw a Postgres 22001 and lost the
 * reviewer dispatch — a dispatch failing for a reason unrelated to the work.
 */
describe('composeDispatcherLabel', () => {
  it('composes the label the ledger attributes runs by', () => {
    expect(composeDispatcherLabel('system:coordinator', 'lane-approver', 'qa'))
      .toBe('system:coordinator:lane-approver:qa');
  });

  it('fits the role keys that used to overflow varchar(36)', () => {
    // 'architect' (9) and 'product-manager' (15) both blew the old column.
    for (const role of ['architect', 'product-manager', 'engineering-manager']) {
      const label = composeDispatcherLabel('system:coordinator', 'lane-approver', role);
      expect(label).toBe(`system:coordinator:lane-approver:${role}`);
      expect(label.length).toBeLessThanOrEqual(MAX_SUBMITTED_BY_CHARS);
    }
  });

  it('NEVER exceeds the column width, whatever it is handed', () => {
    const label = composeDispatcherLabel('x'.repeat(400), 'lane-approver', 'y'.repeat(40));
    expect(label.length).toBeLessThanOrEqual(MAX_SUBMITTED_BY_CHARS);
  });

  it('sacrifices the BASE, not the detail — the suffix is what identifies the dispatch', () => {
    // Which role was asked to approve is the diagnostic payload; the base is context.
    const label = composeDispatcherLabel('a'.repeat(200), 'lane-approver', 'product-manager');
    expect(label.endsWith(':lane-approver:product-manager')).toBe(true);
  });

  it('clips a pathological suffix rather than emitting an over-long value', () => {
    const label = composeDispatcherLabel('base', 'k'.repeat(90), 'd'.repeat(90));
    expect(label.length).toBe(MAX_SUBMITTED_BY_CHARS);
  });

  it('omits an absent detail instead of leaving a dangling separator', () => {
    expect(composeDispatcherLabel('system:manager', 'signoff-request')).toBe('system:manager:signoff-request');
    expect(composeDispatcherLabel('system:manager', 'signoff-request', '')).toBe('system:manager:signoff-request');
    expect(composeDispatcherLabel('system:manager', 'signoff-request', null)).toBe('system:manager:signoff-request');
  });

  it('falls back to a usable base rather than writing an empty attribution', () => {
    // `submitted_by` is NOT NULL and is read as evidence — a blank would be a hole.
    expect(composeDispatcherLabel('   ', 'reviewer', 'qa')).toBe('system:reviewer:qa');
  });
});

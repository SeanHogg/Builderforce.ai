import { describe, it, expect } from 'vitest';
import { ignoredEventReason, IGNORED_ERROR_PATTERNS } from './ingestIgnoreList';

describe('ignoredEventReason', () => {
  it('drops the ResizeObserver "undelivered notifications" notice', () => {
    expect(ignoredEventReason({ type: 'Error', message: 'ResizeObserver loop completed with undelivered notifications.' }))
      .toBe('resize-observer-loop');
  });

  it('drops the legacy "loop limit exceeded" variant, including an Uncaught prefix', () => {
    expect(ignoredEventReason({ type: 'Error', message: 'Uncaught ResizeObserver loop limit exceeded' }))
      .toBe('resize-observer-loop');
  });

  it('matches when the notice is carried in the type-qualified form', () => {
    expect(ignoredEventReason({ type: 'ResizeObserver loop limit exceeded', message: '' })).toBe('resize-observer-loop');
  });

  it('keeps real errors, including ones that merely mention ResizeObserver', () => {
    expect(ignoredEventReason({ type: 'TypeError', message: 'x is not a function' })).toBeNull();
    expect(ignoredEventReason({ type: 'TypeError', message: 'ResizeObserver is not defined' })).toBeNull();
  });

  it('every declared entry carries an id and a reason', () => {
    for (const p of IGNORED_ERROR_PATTERNS) {
      expect(p.id).toMatch(/^[a-z0-9-]+$/);
      expect(p.reason.length).toBeGreaterThan(10);
    }
  });
});

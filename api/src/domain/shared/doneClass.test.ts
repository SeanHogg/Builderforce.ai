import { describe, it, expect } from 'vitest';
import { DONE_CLASS_STATUSES, isDoneStatus, isNotDoneStatus } from './doneClass';

describe('DONE_CLASS_STATUSES', () => {
  it('covers the terminal lane keys imported boards actually use', () => {
    // The whole point of the set: a board renamed by a user or imported from
    // Jira/Linear/ADO spells "finished" differently. Excluding only 'done'
    // silently leaks completed work into the unassigned-high-priority feed.
    for (const key of ['done', 'completed', 'complete', 'closed', 'resolved', 'shipped']) {
      expect(DONE_CLASS_STATUSES).toContain(key);
    }
  });

  it('is stored lowercase so the case-insensitive match is exact', () => {
    for (const key of DONE_CLASS_STATUSES) {
      expect(key).toBe(key.toLowerCase());
    }
  });
});

describe('isDoneStatus', () => {
  it('matches every done-class key', () => {
    for (const key of DONE_CLASS_STATUSES) {
      expect(isDoneStatus(key)).toBe(true);
    }
  });

  it('does not match in-flight lanes', () => {
    for (const key of ['backlog', 'ready', 'in_progress', 'in_review', 'blocked', 'todo']) {
      expect(isDoneStatus(key)).toBe(false);
    }
  });

  // Edge cases first: these are exactly the shapes imported boards produce.
  it('is case-insensitive', () => {
    expect(isDoneStatus('Done')).toBe(true);
    expect(isDoneStatus('DONE')).toBe(true);
    expect(isDoneStatus('ReSoLvEd')).toBe(true);
  });

  it('trims surrounding whitespace', () => {
    expect(isDoneStatus('  done')).toBe(true);
    expect(isDoneStatus('closed ')).toBe(true);
    expect(isDoneStatus('\tshipped\n')).toBe(true);
  });

  it('treats null / undefined / empty as NOT done', () => {
    // A task with no status must never be filtered out as "finished".
    expect(isDoneStatus(null)).toBe(false);
    expect(isDoneStatus(undefined)).toBe(false);
    expect(isDoneStatus('')).toBe(false);
    expect(isDoneStatus('   ')).toBe(false);
  });

  it('does not match on substrings or near-misses', () => {
    expect(isDoneStatus('not_done')).toBe(false);
    expect(isDoneStatus('done_ish')).toBe(false);
    expect(isDoneStatus('undone')).toBe(false);
    expect(isDoneStatus('closing')).toBe(false);
  });
});

describe('isNotDoneStatus', () => {
  it('is the exact inverse of isDoneStatus', () => {
    const samples = [
      'done', 'Done', ' closed ', 'resolved', 'shipped', 'complete', 'completed',
      'backlog', 'in_progress', '', '   ', 'undone', null, undefined,
    ];
    for (const s of samples) {
      expect(isNotDoneStatus(s)).toBe(!isDoneStatus(s));
    }
  });
});

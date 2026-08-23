import { describe, it, expect } from 'vitest';
import { normalizeLaneKey, validateLaneKeyChange, LANE_KEY_MAX_LENGTH } from './renameLaneKey';

describe('normalizeLaneKey', () => {
  it('folds a human column name into a lane key', () => {
    expect(normalizeLaneKey('QA Pass')).toBe('qa_pass');
    expect(normalizeLaneKey('  Ready for Review!  ')).toBe('ready_for_review');
    expect(normalizeLaneKey('Design → Build')).toBe('design_build');
  });

  it('leaves an already-canonical key untouched', () => {
    expect(normalizeLaneKey('in_progress')).toBe('in_progress');
  });

  it('rejects input that normalises to nothing', () => {
    expect(normalizeLaneKey('')).toBeNull();
    expect(normalizeLaneKey('   ')).toBeNull();
    expect(normalizeLaneKey('!!!')).toBeNull();
    expect(normalizeLaneKey('___')).toBeNull();
  });

  it('caps at the width of the column that has to CARRY it (tasks.status)', () => {
    // A key longer than varchar(64) would rename the lane and then fail on the
    // first ticket write — the rename must not be able to outgrow its own cascade.
    const long = normalizeLaneKey('a'.repeat(200));
    expect(long).not.toBeNull();
    expect(long!.length).toBeLessThanOrEqual(LANE_KEY_MAX_LENGTH);
  });

  it('never leaves a trailing underscore after truncation', () => {
    // Truncating mid-separator is exactly how `foo_` gets produced.
    const key = normalizeLaneKey(`${'a'.repeat(LANE_KEY_MAX_LENGTH - 1)} tail`);
    expect(key).not.toBeNull();
    expect(key!.endsWith('_')).toBe(false);
  });
});

describe('validateLaneKeyChange', () => {
  const siblings = ['backlog', 'todo', 'done'];

  it('accepts a fresh key and reports it as a change', () => {
    expect(validateLaneKeyChange({ requested: 'QA Pass', currentKey: 'qa', siblingKeys: siblings }))
      .toEqual({ ok: true, key: 'qa_pass', changed: true });
  });

  it('treats a no-op rename as legal but NOT a change', () => {
    // A client that PATCHes every field on every edit must not pay for a cascade
    // it did not ask for.
    expect(validateLaneKeyChange({ requested: 'qa', currentKey: 'qa', siblingKeys: siblings }))
      .toEqual({ ok: true, key: 'qa', changed: false });
  });

  it('treats a rename that only differs in FORM as a no-op', () => {
    expect(validateLaneKeyChange({ requested: 'In Progress', currentKey: 'in_progress', siblingKeys: siblings }))
      .toEqual({ ok: true, key: 'in_progress', changed: false });
  });

  it('refuses a key another lane already holds', () => {
    // UNIQUE(board_id, key) restated where it can produce a 400 instead of a 500.
    expect(validateLaneKeyChange({ requested: 'Todo', currentKey: 'qa', siblingKeys: siblings }))
      .toEqual({ ok: false, error: 'duplicate_key' });
  });

  it('refuses input that normalises to nothing', () => {
    expect(validateLaneKeyChange({ requested: '***', currentKey: 'qa', siblingKeys: siblings }))
      .toEqual({ ok: false, error: 'invalid_key' });
  });

  it('does not consider the lane its own duplicate', () => {
    // `siblingKeys` excludes the lane being renamed; if a caller passed the lane's
    // own key in anyway the current-key check has to win first.
    expect(validateLaneKeyChange({ requested: 'qa', currentKey: 'qa', siblingKeys: ['qa', ...siblings] }))
      .toEqual({ ok: true, key: 'qa', changed: false });
  });
});

import { describe, expect, it } from 'vitest';
import {
  decodeActionRef,
  EMPTY_REFS,
  encodeActionRef,
  nextActions,
  prescriptionMatchesFilter,
  verdictFor,
} from './prescriptionState';

describe('action refs', () => {
  it('round-trips what an action created, within the column', () => {
    const refs = { taskId: 42, testId: 7, previewRelease: 'v20261013a', liveRelease: 'v20261001b', sequenceObjectId: null };
    const encoded = encodeActionRef(refs)!;
    expect(encoded).toBe('t=42;x=7;p=v20261013a;l=v20261001b');
    expect(encoded.length).toBeLessThanOrEqual(120);
    expect(decodeActionRef(encoded)).toEqual(refs);
    expect(encodeActionRef(EMPTY_REFS)).toBeNull();
    expect(decodeActionRef('t=abc;p=bad value;junk')).toEqual(EMPTY_REFS);
  });
});

describe('verdictFor', () => {
  it('judges in the acceptance direction, relative to the baseline', () => {
    expect(verdictFor(0.01, 0.05, 'up')).toBe('worked');
    expect(verdictFor(-0.01, 0.05, 'up')).toBe('worse');
    expect(verdictFor(0.001, 0.05, 'up')).toBe('no_effect');
    expect(verdictFor(-0.02, 0.1, 'down')).toBe('worked');
    expect(verdictFor(0.02, 0.1, 'down')).toBe('worse');
  });
});

describe('nextActions — the human gates', () => {
  const rule = ['fix', 'test', 'ticket'] as const;
  it('offers the rule\'s actions on a proposal, but never Test it before a preview exists', () => {
    expect(nextActions({ status: 'proposed', actionKind: null, refs: EMPTY_REFS, ruleActions: rule })).toEqual(['fix', 'ticket', 'dismiss']);
  });
  it('opens publish and test only once the fix built a preview; start only for a drafted test', () => {
    expect(nextActions({ status: 'applied', actionKind: 'fix', refs: { ...EMPTY_REFS, taskId: 1 }, ruleActions: rule })).toEqual(['dismiss']);
    expect(nextActions({ status: 'applied', actionKind: 'fix', refs: { ...EMPTY_REFS, taskId: 1, previewRelease: 'p1' }, ruleActions: rule }))
      .toEqual(['publish-preview', 'test', 'dismiss']);
    expect(nextActions({ status: 'applied', actionKind: 'test', refs: { ...EMPTY_REFS, testId: 3, previewRelease: 'p1' }, ruleActions: rule }))
      .toEqual(['start-test', 'dismiss']);
  });
  it('offers Revert only on worse after a published preview', () => {
    const published = { ...EMPTY_REFS, previewRelease: 'p1', liveRelease: 'l1' };
    expect(nextActions({ status: 'worse', actionKind: 'fix', refs: published, ruleActions: rule })).toEqual(['revert']);
    expect(nextActions({ status: 'no_effect', actionKind: 'fix', refs: published, ruleActions: rule })).toEqual([]);
    expect(nextActions({ status: 'worse', actionKind: 'fix', refs: { ...published, liveRelease: null }, ruleActions: rule })).toEqual([]);
  });
});

describe('prescriptionMatchesFilter', () => {
  it('narrows by page and issue clauses and ignores visit-only clauses', () => {
    const item = { pagePath: '/pricing', fingerprint: 'fp1' };
    expect(prescriptionMatchesFilter(item, { all: [{ field: 'visitedPath', op: 'prefix', value: '/pri' }] })).toBe(true);
    expect(prescriptionMatchesFilter(item, { all: [{ field: 'visitedPath', op: 'eq', value: '/' }] })).toBe(false);
    expect(prescriptionMatchesFilter(item, { all: [{ field: 'issue', op: 'eq', value: 'fp2' }] })).toBe(false);
    expect(prescriptionMatchesFilter(item, { all: [{ field: 'device', op: 'eq', value: 'phone' }] })).toBe(true);
    expect(prescriptionMatchesFilter({ pagePath: null, fingerprint: null }, { all: [{ field: 'entryPath', op: 'eq', value: '/' }] })).toBe(false);
  });
});

describe('nextActions — the §5.2 page actions', () => {
  const page = ['fix', 'ticket', 'copy_prompt', 'apply_in_composer', 'apply_page'] as const;
  const base = { actionKind: null, refs: EMPTY_REFS, ruleActions: page };

  it('offers copy-prompt and apply-page on any open fix with a page, apply-in-composer only on a hosted canvas app', () => {
    expect(nextActions({ ...base, status: 'proposed', pagePath: '/pricing' })).toEqual(['fix', 'ticket', 'copy-prompt', 'apply-page', 'dismiss']);
    expect(nextActions({ ...base, status: 'proposed', pagePath: '/pricing', hostedCanvas: true }))
      .toEqual(['fix', 'ticket', 'copy-prompt', 'apply-page', 'apply-in-composer', 'dismiss']);
  });

  it('offers none of them without a page, or once the fix is settled', () => {
    expect(nextActions({ ...base, status: 'proposed', pagePath: null, hostedCanvas: true })).toEqual(['fix', 'ticket', 'dismiss']);
    expect(nextActions({ ...base, status: 'worked', pagePath: '/pricing', hostedCanvas: true })).toEqual([]);
  });

  it('keeps copy-prompt open after a hand-applied fix, but not apply-in-composer', () => {
    expect(nextActions({ ...base, status: 'applied', actionKind: 'copy_prompt', pagePath: '/pricing', hostedCanvas: true }))
      .toEqual(['copy-prompt', 'apply-page', 'dismiss']);
  });

  it('closes apply-page when the page has no accepted fix', () => {
    expect(nextActions({ ...base, status: 'proposed', pagePath: '/pricing', pageAcceptedFixes: 0 })).toEqual(['fix', 'ticket', 'copy-prompt', 'dismiss']);
  });

  it('never offers Revert on a hand-applied fix', () => {
    const refs = { ...EMPTY_REFS, previewRelease: 'r2', liveRelease: 'r1' };
    expect(nextActions({ ...base, status: 'worse', actionKind: 'copy_prompt', refs })).toEqual([]);
  });
});

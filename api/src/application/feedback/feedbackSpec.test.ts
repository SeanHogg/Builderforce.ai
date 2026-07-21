import { describe, it, expect } from 'vitest';
import {
  normalizeFeedback,
  computeFeedbackFingerprint,
  buildFeedbackTaskDraft,
  isUnapprovedFeedbackTask,
  FEEDBACK_TASK_SOURCE,
  FEEDBACK_APPROVED_TASK_SOURCE,
  TITLE_MAX,
  BODY_MAX,
} from './feedbackSpec';

describe('normalizeFeedback', () => {
  it('accepts a minimal single-textarea payload and derives the title', () => {
    const r = normalizeFeedback({ body: 'Dark mode on the reports page\nplus CSV export' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.title).toBe('Dark mode on the reports page');
    expect(r.value.kind).toBe('feature');
  });

  it('rejects a payload with no body', () => {
    expect(normalizeFeedback({ title: 'just a title' })).toEqual({ ok: false, error: 'body is required' });
    expect(normalizeFeedback({ body: '   ' })).toEqual({ ok: false, error: 'body is required' });
    expect(normalizeFeedback(null)).toEqual({ ok: false, error: 'Body must be an object' });
  });

  it('falls back to feature for an unknown kind rather than failing the submit', () => {
    const r = normalizeFeedback({ body: 'x', kind: 'wishlist' });
    expect(r.ok && r.value.kind).toBe('feature');
  });

  it('accepts the documented kinds case-insensitively', () => {
    expect(normalizeFeedback({ body: 'x', kind: 'BUG' })).toMatchObject({ value: { kind: 'bug' } });
  });

  it('caps every field so an unauthenticated POST cannot write an oversized row', () => {
    const r = normalizeFeedback({ title: 'T'.repeat(5000), body: 'B'.repeat(50_000) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.title).toHaveLength(TITLE_MAX);
    expect(r.value.body).toHaveLength(BODY_MAX);
  });

  it('reads the alternate field names a hand-rolled client might send', () => {
    const r = normalizeFeedback({ message: 'hi', subject: 'Subject', email: 'a@b.co', url: 'https://x.dev/p' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ body: 'hi', title: 'Subject', submitterEmail: 'a@b.co', pageUrl: 'https://x.dev/p' });
  });

  it('drops a non-object context instead of storing an array', () => {
    expect(normalizeFeedback({ body: 'x', context: ['nope'] })).toMatchObject({ value: { context: null } });
  });
});

describe('computeFeedbackFingerprint', () => {
  const f = { kind: 'feature' as const, title: 'Add CSV export', body: 'We need CSV export.' };

  it('collapses a double-submit of the identical request', async () => {
    expect(await computeFeedbackFingerprint(f)).toBe(await computeFeedbackFingerprint({ ...f }));
  });

  it('ignores casing and whitespace noise', async () => {
    const noisy = { kind: 'feature' as const, title: '  ADD   CSV Export ', body: 'We  need\nCSV export.' };
    expect(await computeFeedbackFingerprint(noisy)).toBe(await computeFeedbackFingerprint(f));
  });

  it('separates genuinely different requests, and the same words under a different kind', async () => {
    expect(await computeFeedbackFingerprint({ ...f, body: 'Something else.' })).not.toBe(await computeFeedbackFingerprint(f));
    expect(await computeFeedbackFingerprint({ ...f, kind: 'bug' })).not.toBe(await computeFeedbackFingerprint(f));
  });
});

describe('the execution gate', () => {
  it('marks a fresh request as unapproved, and an approved one as executable', () => {
    expect(isUnapprovedFeedbackTask(FEEDBACK_TASK_SOURCE)).toBe(true);
    expect(isUnapprovedFeedbackTask(FEEDBACK_APPROVED_TASK_SOURCE)).toBe(false);
  });

  it('leaves every ordinary ticket ungated', () => {
    for (const source of [null, undefined, '', 'github', 'jira', 'manager', 'coaching']) {
      expect(isUnapprovedFeedbackTask(source)).toBe(false);
    }
  });

  it('keeps both markers inside the tasks.source varchar(24) column', () => {
    expect(FEEDBACK_TASK_SOURCE.length).toBeLessThanOrEqual(24);
    expect(FEEDBACK_APPROVED_TASK_SOURCE.length).toBeLessThanOrEqual(24);
  });
});

describe('buildFeedbackTaskDraft', () => {
  it('states the approval gate on the card so nobody expects an agent to start', () => {
    const r = normalizeFeedback({ body: 'Please add SSO', kind: 'feature' });
    if (!r.ok) throw new Error('fixture failed to normalize');
    const draft = buildFeedbackTaskDraft(r.value, { submitterLabel: 'Ada' });
    expect(draft.title).toBe('[Feature request] Please add SSO');
    expect(draft.description).toContain('External request');
    expect(draft.description).toContain('by Ada');
    expect(draft.description).toMatch(/will NOT be picked up by an agent/);
  });

  it('omits the attribution clause for an anonymous submission', () => {
    const r = normalizeFeedback({ body: 'anon idea' });
    if (!r.ok) throw new Error('fixture failed to normalize');
    const description = buildFeedbackTaskDraft(r.value, { submitterLabel: null }).description;
    expect(description).toContain('submitted through the product feedback collector');
    expect(description).not.toMatch(/submitted by/);
  });
});

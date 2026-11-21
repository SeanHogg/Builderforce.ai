import { describe, expect, it } from 'vitest';
import { findNearDuplicateByTitle, isNearDuplicateTitle, normalizeTitle } from './nearDuplicateTitle';

describe('isNearDuplicateTitle', () => {
  it('keeps the exact-match rule it widens', () => {
    expect(isNearDuplicateTitle('Fix login redirect loop', '  fix   LOGIN redirect loop ')).toBe(true);
  });

  it('catches the rephrasing an exact match missed — the reported duplicate-ticket bug', () => {
    // The observed failure: asked twice, the model writes the same gap two ways and the
    // board grows two tickets for one piece of work.
    expect(isNearDuplicateTitle('Fix login redirect loop', 'Login redirect loop needs fixing')).toBe(true);
    expect(isNearDuplicateTitle('Add retry to the webhook sender', 'Webhook sender should retry')).toBe(true);
    expect(isNearDuplicateTitle('Fix the login redirect loop', 'Login redirect loop')).toBe(true);
  });

  it('keeps one-word-different work APART — a false dedup silently loses a ticket', () => {
    expect(isNearDuplicateTitle('Fix login redirect loop', 'Fix signup redirect loop')).toBe(false);
    expect(isNearDuplicateTitle('Cache the tenant plan read', 'Cache the tenant seat read')).toBe(false);
  });

  it('does not fold opposite work together on a shared noun', () => {
    // `add` / `remove` are deliberately NOT filler: they are what distinguishes the work.
    expect(isNearDuplicateTitle('Add dark mode toggle', 'Remove dark mode toggle')).toBe(false);
  });

  it('refuses to let a short title swallow a longer one that adds scope', () => {
    expect(isNearDuplicateTitle('Update README', 'Update README and CHANGELOG')).toBe(false);
    expect(isNearDuplicateTitle('Login', 'Fix the login redirect loop')).toBe(false);
  });

  it('treats a title with no content words by its exact form only', () => {
    expect(isNearDuplicateTitle('The and of', 'a to in')).toBe(false);
    expect(isNearDuplicateTitle('the update', 'The Update')).toBe(true);
  });
});

describe('findNearDuplicateByTitle', () => {
  const board = [
    { id: 1, title: 'Fix login redirect loop' },
    { id: 2, title: 'Ship the billing export' },
  ];

  it('returns the row the new title restates', () => {
    expect(findNearDuplicateByTitle('Login redirect loop needs fixing', board, (r) => r.title)?.id).toBe(1);
  });

  it('returns undefined for genuinely new work', () => {
    expect(findNearDuplicateByTitle('Fix signup redirect loop', board, (r) => r.title)).toBeUndefined();
  });

  it('tolerates rows with a missing title', () => {
    expect(findNearDuplicateByTitle('anything', [{ title: null }], (r) => r.title)).toBeUndefined();
  });
});

describe('normalizeTitle', () => {
  it('collapses whitespace, trims and lowercases', () => {
    expect(normalizeTitle('  Fix\tthe   Loop\n')).toBe('fix the loop');
    expect(normalizeTitle(null)).toBe('');
  });
});

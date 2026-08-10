import { describe, it, expect } from 'vitest';
import { partitionByDiffAnchor } from './publishReviewToPr';
import { isReviewRole } from '../kanban/roleCatalog';
import type { ReviewGapInput } from './ValidationService';

/**
 * `partitionByDiffAnchor` is the guard against the one failure mode that would
 * silently destroy a review: GitHub rejects an ENTIRE `POST /pulls/{n}/reviews`
 * with a 422 if any single inline comment anchors outside the PR's diff. A
 * reviewer commenting on a file the PR did not touch is completely legitimate,
 * so the anchor has to be validated here — and anything that cannot be anchored
 * must be DEMOTED into the review body, never dropped.
 *
 * Every test below is really asserting the same property: no gap disappears.
 */

const gap = (over: Partial<ReviewGapInput> = {}): ReviewGapInput => ({
  title: 'Missing null check',
  detail: 'This dereferences without guarding.',
  ...over,
});

describe('partitionByDiffAnchor', () => {
  it('anchors a gap whose path is in the diff', () => {
    const diff = new Set(['src/a.ts']);
    const { inline, body } = partitionByDiffAnchor([gap({ path: 'src/a.ts', line: 12 })], diff);

    expect(inline).toHaveLength(1);
    expect(body).toHaveLength(0);
    expect(inline[0]).toMatchObject({ path: 'src/a.ts', line: 12 });
    expect(inline[0]!.body).toContain('Missing null check');
  });

  it('demotes a gap whose file is NOT in the diff instead of dropping it', () => {
    // The 422 case. Anchoring this would take the whole review down with it.
    const diff = new Set(['src/a.ts']);
    const { inline, body } = partitionByDiffAnchor([gap({ path: 'src/untouched.ts', line: 3 })], diff);

    expect(inline).toHaveLength(0);
    expect(body).toHaveLength(1);
    expect(body[0]!.path).toBe('src/untouched.ts');
  });

  it('demotes a location-less gap — the "no tests were added" case', () => {
    const { inline, body } = partitionByDiffAnchor([gap({ title: 'No tests added' })], new Set(['src/a.ts']));

    expect(inline).toHaveLength(0);
    expect(body).toHaveLength(1);
    expect(body[0]!.title).toBe('No tests added');
  });

  it('demotes EVERY gap when the diff could not be read', () => {
    // changedPaths() returns null when the files call failed. Degrading
    // presentation is acceptable; 422-ing away a whole review is not.
    const gaps = [gap({ path: 'src/a.ts', line: 1 }), gap({ path: 'src/b.ts', line: 2 })];
    const { inline, body } = partitionByDiffAnchor(gaps, null);

    expect(inline).toHaveLength(0);
    expect(body).toHaveLength(2);
  });

  it('rejects malformed line numbers rather than sending them to GitHub', () => {
    const diff = new Set(['src/a.ts']);
    const gaps = [
      gap({ path: 'src/a.ts', line: 0 }),
      gap({ path: 'src/a.ts', line: -4 }),
      gap({ path: 'src/a.ts', line: Number.NaN }),
      gap({ path: 'src/a.ts', line: null }),
      gap({ path: '', line: 5 }),
    ];
    const { inline, body } = partitionByDiffAnchor(gaps, diff);

    expect(inline).toHaveLength(0);
    expect(body).toHaveLength(5);
  });

  it('never loses a gap, whatever the mix', () => {
    const diff = new Set(['src/a.ts', 'src/b.ts']);
    const gaps = [
      gap({ title: 'anchored 1', path: 'src/a.ts', line: 1 }),
      gap({ title: 'off-diff', path: 'src/z.ts', line: 9 }),
      gap({ title: 'no location' }),
      gap({ title: 'anchored 2', path: 'src/b.ts', line: 42 }),
    ];
    const { inline, body } = partitionByDiffAnchor(gaps, diff);

    expect(inline).toHaveLength(2);
    expect(body).toHaveLength(2);
    // The invariant that matters.
    expect(inline.length + body.length).toBe(gaps.length);
  });

  it('omits the detail paragraph when a gap has only a title', () => {
    const { inline } = partitionByDiffAnchor(
      [{ title: 'Terse finding', path: 'src/a.ts', line: 7 }],
      new Set(['src/a.ts']),
    );
    expect(inline[0]!.body).toBe('**Terse finding**');
  });
});

describe('isReviewRole', () => {
  it('treats arbiter roles as reviews', () => {
    for (const key of ['code-reviewer', 'architect', 'qa-tester', 'security', 'validator', 'team-lead', 'product-owner']) {
      expect(isReviewRole(key)).toBe(true);
    }
  });

  it('does NOT treat contributor or coordinator roles as reviews', () => {
    // Publishing these to the PR would bury the sign-offs a merge depends on.
    for (const key of ['developer', 'business-analyst', 'tech-writer', 'designer', 'devops', 'manager']) {
      expect(isReviewRole(key)).toBe(false);
    }
  });

  it('does not treat an unknown custom role as a review role', () => {
    // Defaulting to publish would spam PRs as tenants add their own roles.
    expect(isReviewRole('vibes-officer')).toBe(false);
    expect(isReviewRole('')).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { classifyReviewDeliverable, type ReviewDeliverableRow } from './autonomyWiringAudit';

/**
 * `review_has_deliverable` used to treat every in-review ticket without a branch
 * as missing code. Spec-shaped titles are document work — the audit must count
 * them as a non-code deliverable, not as stranded implementation.
 */

function row(over: Partial<ReviewDeliverableRow> = {}): ReviewDeliverableRow {
  return {
    taskType: 'task',
    actionType: 'backend_api',
    title: 'Add a /billing endpoint',
    gitBranch: null,
    githubPrUrl: null,
    ...over,
  };
}

describe('classifyReviewDeliverable', () => {
  it('counts a spec-shaped ticket as a non-code deliverable, not missing code', () => {
    // Residual mis-classification: action type taken from the SUBJECT of the spec,
    // no branch because the deliverable is the document itself.
    const prd = classifyReviewDeliverable(row({
      actionType: 'backend_api',
      title: 'Write the PRD for the billing API',
    }));
    const labelled = classifyReviewDeliverable(row({
      actionType: 'frontend_ui',
      title: 'Spec: onboarding wizard',
    }));
    expect(prd).toBe('non_code');
    expect(labelled).toBe('non_code');
    expect(prd).not.toBe('missing_code');
    expect(labelled).not.toBe('missing_code');
  });

  it('still flags implementation work in review with no branch or PR as missing code', () => {
    expect(classifyReviewDeliverable(row({
      title: 'Implement the billing API per the spec',
    }))).toBe('missing_code');
  });

  it('counts implementation work that has a branch as having code', () => {
    expect(classifyReviewDeliverable(row({
      title: 'Add a /billing endpoint',
      gitBranch: 'ticket/123-billing',
    }))).toBe('has_code');
  });
});

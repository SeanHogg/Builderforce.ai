import { describe, expect, it } from 'vitest';
import { matchesRequiredReviewSignoff, missingReviewVerdictMessage } from './cloudAgentEngine';
import { parseReviewRole } from './cloudDispatch';

describe('review verdict finish gate', () => {
  const required = { roleKey: 'code-reviewer', laneKey: 'in_review' };

  it('recognises reviewer payloads but not producer payloads', () => {
    expect(parseReviewRole(JSON.stringify({ reviewRole: 'code-reviewer' }))).toBe('code-reviewer');
    expect(parseReviewRole(JSON.stringify({ actAsRole: 'developer' }))).toBeUndefined();
  });

  it('accepts only a successful signoff for the exact role and lane', () => {
    expect(matchesRequiredReviewSignoff(required, 'builtin_kanban_signoff', required, true)).toBe(true);
    expect(matchesRequiredReviewSignoff(required, 'builtin_kanban_signoff', { ...required, laneKey: 'qa' }, true)).toBe(false);
    expect(matchesRequiredReviewSignoff(required, 'builtin_kanban_signoff', required, false)).toBe(false);
    expect(matchesRequiredReviewSignoff(required, 'finish', required, true)).toBe(false);
  });

  it('gives the model an exact corrective call contract', () => {
    expect(missingReviewVerdictMessage(required)).toContain("roleKey='code-reviewer'");
    expect(missingReviewVerdictMessage(required)).toContain("laneKey='in_review'");
    expect(missingReviewVerdictMessage(required)).toContain('approved or changes_requested');
  });
});

import { describe, expect, it } from 'vitest';
import { REFLECTION_SCORE_FLOOR, runEarnedReflection, skillReflectionDirective } from './skillReflection';

/**
 * GAP C1 — the bar that decides whether a run's work counts as evidence. It exists
 * so the skill catalogue fills with procedures that demonstrably worked, rather
 * than with every run that happened to touch a file.
 */
describe('runEarnedReflection', () => {
  it('counts merged work on its own', () => {
    expect(runEarnedReflection({ merged: true })).toBe(true);
    expect(runEarnedReflection({ merged: true, score: 0 })).toBe(true);
  });

  it('counts an unmerged run only with BOTH real output and a graded score', () => {
    expect(runEarnedReflection({ producedChanges: true, score: REFLECTION_SCORE_FLOOR })).toBe(true);
    expect(runEarnedReflection({ prOpened: true, score: 0.9 })).toBe(true);
    // A good score with nothing to show for it is an opinion, not a procedure.
    expect(runEarnedReflection({ score: 0.9 })).toBe(false);
    // Output with no grade is an attempt, not proof.
    expect(runEarnedReflection({ producedChanges: true })).toBe(false);
    expect(runEarnedReflection({ producedChanges: true, score: REFLECTION_SCORE_FLOOR - 0.01 })).toBe(false);
  });

  it('is false for a run that did nothing', () => {
    expect(runEarnedReflection({})).toBe(false);
    expect(runEarnedReflection({ score: null })).toBe(false);
  });
});

describe('skillReflectionDirective', () => {
  it('names both the tools and the bar, so most runs correctly propose nothing', () => {
    const directive = skillReflectionDirective(true);
    expect(directive).toContain('skill_propose');
    expect(directive).toContain('skill_list');
    expect(directive).toContain('Proposing nothing is the right answer for most runs');
    expect(directive).toContain('draft for human review');
  });

  it('is empty for a run with no repository to have learned a procedure about', () => {
    expect(skillReflectionDirective(false)).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import { REFLECTION_SCORE_FLOOR, draftSkillFromRun, runEarnedReflection, skillReflectionDirective } from './skillReflection';

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

describe('draftSkillFromRun (E1 auto-propose)', () => {
  const run = {
    taskId: 42, taskTitle: 'Add a dark-mode toggle', executionId: 900, agentLabel: 'Coder', projectId: 7,
    trace: [
      { tool: 'search_code', args: { query: 'ThemeProvider' } },
      { tool: 'read_file', args: { path: 'src/theme.ts' } },
      { tool: 'read_file', args: { path: 'src/theme.ts' } },
      { tool: 'finish.blocked', args: { reason: 'branch_ci' } },
      { tool: 'tool_search', args: { query: 'x' } },
      { tool: 'edit_file', args: { path: 'src/theme.ts', old_string: 'a', new_string: 'b' } },
      { tool: 'run_checks', args: {} },
      { tool: 'finish', args: { summary: 'done' } },
    ],
    filesTouched: ['src/theme.ts'],
    verification: 'ci_green' as const,
  };

  it('drafts the procedure from the trace: telemetry and loop control dropped, repeats folded', () => {
    const d = draftSkillFromRun(run);
    expect(d.slug).toBe('auto-task-42');
    expect(d.body).toContain('1. `search_code` — ThemeProvider');
    expect(d.body).toContain('2. `read_file` — src/theme.ts (×2)');
    expect(d.body).toContain('3. `edit_file` — src/theme.ts');
    expect(d.body).toContain('4. `run_checks`');
    expect(d.body).not.toContain('finish.blocked');
    expect(d.body).not.toContain('tool_search');
    expect(d.body).toContain('- `src/theme.ts`');
    expect(d.body).toContain('branch CI went green');
  });

  it('is stamped with its origin for the reviewer, and never claims approval', () => {
    const d = draftSkillFromRun({ ...run, verification: 'merged' });
    expect(d).toMatchObject({ originExecutionId: 900, originTaskId: 42, projectId: 7, authorLabel: 'Coder (auto-drafted)' });
    expect(d.description).toContain('Needs human review');
    expect(d.evidence).toContain('the change was merged');
  });
});
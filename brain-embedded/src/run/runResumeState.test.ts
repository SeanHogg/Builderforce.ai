import { describe, expect, it } from 'vitest';
import { parseResumeState, resumeStateOf, RESUME_STEPS, type ResumeTraceEvent } from './runResumeState';

const tool = (label: string, args: Record<string, unknown>, result: unknown = { ok: true }): ResumeTraceEvent => ({ ts: '', category: 'tool', label, args, result });

describe('the resume state an interrupted run leaves (chat #61651)', () => {
  it('keeps the ask verbatim, the plan, the files changed and the last steps', () => {
    const state = resumeStateOf('  Fix the visualizer legend overlap in KnowledgeView  ', [
      tool('update_task_state', { goal: 'Fix the legend overlap', nextStep: 'Edit Legend.tsx' }),
      tool('read_file', { path: 'src/Legend.tsx' }),
      tool('edit_file', { path: 'src/Legend.tsx', old: 'a', new: 'b' }),
      tool('run_command', { command: 'pnpm test' }, { ok: false, error: 'boom' }),
      { ts: '', category: 'llm', label: 'llm.complete' },
    ]);
    expect(state.ask).toBe('Fix the visualizer legend overlap in KnowledgeView');
    expect(state.plan).toContain('Goal: Fix the legend overlap');
    expect(state.plan).toContain('Next step: Edit Legend.tsx');
    expect(state.files).toEqual(['src/Legend.tsx']);
    expect(state.steps).toEqual(['read_file on src/Legend.tsx — ok', 'edit_file on src/Legend.tsx — ok', 'run_command on pnpm test — failed']);
  });

  it('carries only the last few steps', () => {
    const many = Array.from({ length: RESUME_STEPS + 4 }, (_, i) => tool('read_file', { path: `f${i}.ts` }));
    expect(resumeStateOf('x', many).steps).toHaveLength(RESUME_STEPS);
  });

  it('reads a journaled state back and drops anything malformed', () => {
    expect(parseResumeState({ ask: 'do it', files: ['a.ts', 3], steps: 'nope' })).toEqual({ ask: 'do it', files: ['a.ts'] });
    expect(parseResumeState({})).toBeUndefined();
    expect(parseResumeState('x')).toBeUndefined();
  });
});

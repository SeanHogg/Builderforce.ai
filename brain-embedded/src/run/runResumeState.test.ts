import { describe, expect, it } from 'vitest';
import { parseResumeState, resumeStateOf, RESUME_FACTS, RESUME_FILES, RESUME_READS, RESUME_STEPS, type ResumeTraceEvent } from './runResumeState';

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
  describe('facts saved and files read', () => {
    it('carries facts from successful remember_fact calls, last write per key wins, not from failed ones', () => {
      const state = resumeStateOf('x', [
        tool('remember_fact', { key: 'a', content: 'one' }),
        tool('builtin_remember_fact', { key: 'b', content: 'bee' }),
        tool('remember_fact', { key: 'a', content: 'two' }),
        tool('remember_fact', { key: 'c', content: 'nope' }, { ok: false }),
        { ...tool('remember_fact', { key: 'd', content: 'nope' }), isError: true },
      ]);
      expect(state.facts).toEqual([{ key: 'b', content: 'bee' }, { key: 'a', content: 'two' }]);
    });

    it('dedupes the files read and ignores failed reads', () => {
      const state = resumeStateOf('x', [
        tool('read_file', { path: 'a.ts' }),
        tool('file_outline', { path: 'a.ts' }),
        tool('read_compressed', { path: 'b.ts' }),
        tool('read_file', { path: 'c.ts' }, { ok: false }),
      ]);
      expect(state.read).toEqual(['a.ts', 'b.ts']);
    });

    it('keeps the NEWEST facts and counts read/view and batched paths as reads', () => {
      const many = Array.from({ length: RESUME_FACTS + 3 }, (_, i) => tool('remember_fact', { key: `k${i}`, content: `v${i}` }));
      const state = resumeStateOf('x', [...many, tool('view', { path: 'v.ts' }), tool('read_file', { paths: ['p1.ts', 'p2.ts'] })]);
      expect(state.facts).toHaveLength(RESUME_FACTS);
      expect(state.facts![RESUME_FACTS - 1]).toEqual({ key: `k${RESUME_FACTS + 2}`, content: `v${RESUME_FACTS + 2}` });
      expect(state.read).toEqual(['v.ts', 'p1.ts', 'p2.ts']);
    });

    it('re-applies the caps and normalisation to an untrusted journaled state', () => {
      const facts = Array.from({ length: RESUME_FACTS + 5 }, (_, i) => ({ key: ` k${i} `, content: `a\n\nb ${'x'.repeat(900)}` }));
      const parsed = parseResumeState({ facts, read: Array.from({ length: RESUME_READS + 5 }, (_, i) => `f${i}.ts`) });
      expect(parsed?.facts).toHaveLength(RESUME_FACTS);
      expect(parsed?.facts![0]!.key).toBe(`k5`);
      expect(parsed?.facts![0]!.content.startsWith('a b x')).toBe(true);
      expect(parsed?.facts![0]!.content.length).toBeLessThanOrEqual(600);
      expect(parsed?.read).toHaveLength(RESUME_READS);
    });

    it('caps files and steps and clamps read paths and fact keys on an untrusted state', () => {
      const parsed = parseResumeState({
        files: Array.from({ length: RESUME_FILES + 5 }, (_, i) => `f${i}`),
        steps: Array.from({ length: RESUME_STEPS + 5 }, (_, i) => `s${i}`),
        read: ['p'.repeat(900)],
        facts: [{ key: 'k'.repeat(500), content: 'v' }],
      });
      expect(parsed?.files).toHaveLength(RESUME_FILES);
      expect(parsed?.steps).toHaveLength(RESUME_STEPS);
      expect(parsed?.read![0]).toHaveLength(300);
      expect(parsed?.facts![0]!.key).toHaveLength(120);
    });

    it('reads facts and read back, dropping malformed entries', () => {
      expect(parseResumeState({ facts: [{ key: 'k', content: 'v' }, { key: '', content: 'v' }, { key: 'k' }, 5], read: ['a.ts', 2] })).toEqual({
        facts: [{ key: 'k', content: 'v' }],
        read: ['a.ts'],
      });
      expect(parseResumeState({ facts: [{ key: 1 }] })).toBeUndefined();
    });
  });
});

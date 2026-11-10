import { describe, expect, it } from 'vitest';
import { agentCommitSubject, parseAgentCommitSubject, runCommitMarker } from './agentCommitMarker';
import { agentCommitMessage } from './cloudAgent/prd';

describe('per-run commit marker (PRD 41 §D1)', () => {
  const run = { taskId: 12, executionId: 345 };

  it('every cloud commit names its run as well as its task', () => {
    expect(agentCommitMessage('Add', 'src/a.ts', run, 'Coder')).toBe('Add src/a.ts — task #12 · run #345 (Coder)');
    expect(agentCommitSubject('Remove', 'b.ts', run, 'Coder', ' — obsolete')).toBe('Remove b.ts — task #12 · run #345 (Coder) — obsolete');
  });

  it('the per-run marker matches exactly this run\'s commits', () => {
    const marker = runCommitMarker(12, 345);
    expect(marker).toBe('— task #12 · run #345 (');
    expect(agentCommitSubject('Add', 'a.ts', run, 'Coder').includes(marker)).toBe(true);
    expect(agentCommitSubject('Add', 'a.ts', { taskId: 12, executionId: 3456 }, 'Coder').includes(marker)).toBe(false);
    expect(agentCommitSubject('Add', 'a.ts', { taskId: 12, executionId: 344 }, 'Coder').includes(marker)).toBe(false);
  });

  it('a commit written before per-run subjects never matches a per-run marker (foreign: the safe side)', () => {
    expect('Add a.ts — task #12 (Coder)'.includes(runCommitMarker(12, 345))).toBe(false);
  });

  it('the legacy per-task marker is unchanged without an execution id', () => {
    expect(runCommitMarker(12)).toBe('— task #12 (');
  });

  it('reads the verb and path back from a subject (first line only)', () => {
    const marker = runCommitMarker(12, 345);
    expect(parseAgentCommitSubject('Update src/my file.ts — task #12 · run #345 (Coder)\n\nbody', marker)).toEqual({ verb: 'Update', path: 'src/my file.ts' });
    expect(parseAgentCommitSubject('Merge branch main', marker)).toBeNull();
    expect(parseAgentCommitSubject('— task #12 · run #345 (Coder)', marker)).toBeNull();
  });
});

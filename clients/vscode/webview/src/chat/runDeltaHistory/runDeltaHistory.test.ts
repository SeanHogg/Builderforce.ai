import { describe, expect, it } from 'vitest';
import { historyFromAnswer } from './runDeltaHistory';

const row = (runId: string) => ({
  runId, repoKey: 'https://example.test/repo.git', surface: 'vscode', mode: 'interactive', computedAt: '2026-11-03T10:00:00Z',
  headline: 'worse', summary: { verdict: 'worse', clauses: [], unchanged: [], notMeasured: [] }, verdicts: { security: 'worse' },
  counts: { introduced: 1, resolved: 0 }, blastRadius: { score: 3, band: 'medium' }, blocking: [], digest: 'd',
});

describe('run delta history answer', () => {
  it('keeps well-formed summaries in the order the host sent them', () => {
    expect(historyFromAnswer([row('b'), row('a')]).map((r) => r.runId)).toEqual(['b', 'a']);
  });

  it('answers nothing for an older host or an error shape, and drops a malformed row', () => {
    expect(historyFromAnswer(undefined)).toEqual([]);
    expect(historyFromAnswer({ error: 'nope' })).toEqual([]);
    expect(historyFromAnswer([row('a'), { runId: 'x' }, null, { ...row('c'), blastRadius: { band: 'low' } }]).map((r) => r.runId)).toEqual(['a']);
  });
});

/**
 * VS Code chat #128305 through the REAL `startRun` (fake host ports): a run edits, writes its answer, the ship gate sends it back,
 * and the re-prompt's stream then breaks on the provider. The run keeps the answer it already gave instead of ending on the error —
 * unless a later turn was kept in between, in which case the failure is the run's last word and it fails as before. Not in the
 * snapshot suite: the old loop never produced this record.
 */
import { describe, expect, it } from 'vitest';
import { StreamInterruptedError } from '../../streamChatCompletion';
import { runScenario } from './harness';
import { call, calls, fails, reply, PINNED, SHIPS_TO_MAIN } from './script';
import type { RunRecord, Scenario, ScriptedTurn } from './types';

const IDE = {
  edit_file: () => ({ ok: true }),
  git_status: () => ({ ok: true }),
  git_diff: () => ({ ok: true }),
  git_commit: () => ({ ok: true }),
  git_push: () => ({ ok: true }),
};
const ANSWER = 'I fixed the deep link in src/a.ts. The commit is still open.';
const doomLoop = () => new StreamInterruptedError('stream ended (xAI doom-loop check: tail_repetition:64@response)', 'pinned/model');

function scenario(id: string, afterGate: ScriptedTurn[]): Scenario {
  return {
    id, rows: [], title: id,
    async run(h) {
      h.tools(IDE);
      h.script([calls([call('edit_file', { path: 'src/a.ts', old_string: 'x', new_string: 'y' }, 'e1')]), reply(ANSWER), ...afterGate]);
      // The policy retries the broken turn once on another model; the script breaks that retry too, so the turn fails.
      await h.start({ ...PINNED, ...SHIPS_TO_MAIN, projectId: 11, userTurn: 'fix the deep link' });
    },
  };
}

const labels = (record: RunRecord): string[] =>
  Object.values(record.trace).flat().map((s) => (s as { label?: string }).label ?? '');
const errors = (record: RunRecord): string[] => Object.values(record.error).map((e) => e.message).filter(Boolean);

describe('regression: chat #128305 — a failed re-prompt never destroys the answer it was sent back from', () => {
  it('regression: the ship gate re-prompts, the stream breaks on the provider — the run settles on its answer, quietly', async () => {
    const record = await runScenario(scenario('reprompt-fails', [fails(doomLoop()), fails(doomLoop())]));
    expect(record.scenarioError).toBeUndefined();
    const seen = labels(record);
    expect(seen).toContain('loop.recover_unshipped_change');
    expect(seen).toContain('loop.reprompt_failed_answer_kept');
    expect(errors(record)).toEqual([]);
    // The answer is in the chat once (saved when it was sent back), never a second copy.
    expect(record.persisted.filter((r) => r.role === 'assistant' && r.content.includes('I fixed the deep link')).length).toBe(1);
    expect(Object.values(record.host.activityCalls).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  }, 60_000);

  it('regression: a later KEPT turn clears the sent-back answer — a provider failure after it still fails the run', async () => {
    const record = await runScenario(scenario('kept-then-fails', [calls([call('git_status', {}, 's1')]), fails(doomLoop()), fails(doomLoop())]));
    expect(record.scenarioError).toBeUndefined();
    expect(labels(record)).not.toContain('loop.reprompt_failed_answer_kept');
    expect(errors(record).join('\n')).toMatch(/doom-loop/);
  }, 60_000);
});

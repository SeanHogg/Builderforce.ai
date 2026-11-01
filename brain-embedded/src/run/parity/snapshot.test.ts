/**
 * The snapshot suite (PRD 35 WS4, D4): every scenario runs through the real `startRun` on the agent and must equal the record the
 * Brain's old loop left for it (`snapshots/`, generated before the loop was deleted). The loop is gone, so a snapshot cannot be
 * regenerated: `PARITY_SNAPSHOT=write` is refused outright, and a future intended change is a planning decision, never a rewrite.
 *
 * Each scenario also names the trace labels its stored record must show (`loopShows`): proof the scenario reaches the behaviour it
 * is named for, read from the stored record rather than from a run.
 */
import { describe, expect, it } from 'vitest';
import { comparable, diffRecords, atMostOneReportPerRun } from './diff';
import { runScenario } from './harness';
import { scenarios } from './scenarios';
import { readSnapshot, writingSnapshots } from './snapshots';

describe('the agent reproduces the stored record of the old loop', () => {
  it('refuses to write a snapshot: only the loop could, and it is deleted', () => {
    expect(writingSnapshots(), 'PARITY_SNAPSHOT=write is refused: a snapshot cannot be regenerated from the agent; an intended change needs a planning decision').toBe(false);
  });

  it('has one scenario per id (the id names its snapshot file)', () => {
    const ids = scenarios.map((s) => s.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  for (const s of scenarios) {
    it(`${s.id}`, async () => {
      const stored = readSnapshot(s.id);
      expect(stored, `no snapshot for ${s.id}: it cannot be generated from the agent`).toBeDefined();
      // The stored record must reach the behaviour the scenario is named for; a scenario that never gets there proves nothing.
      const labels = new Set(Object.values(stored!.trace).flat().map((e) => (e as { label: string }).label));
      expect([...(s.loopShows ?? [])].filter((l) => !labels.has(l)), 'trace labels the stored record must show').toEqual([]);
      const record = await runScenario(s);
      expect(record.scenarioError, 'the agent must complete the scenario').toBeUndefined();
      expect(atMostOneReportPerRun(record), 'at most one outcome report per run').toEqual([]);
      expect(diffRecords(comparable(stored!), comparable(record))).toEqual([]);
    }, 60_000);
  }
});

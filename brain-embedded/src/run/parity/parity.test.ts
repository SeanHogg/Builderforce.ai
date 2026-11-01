/**
 * The differential parity suite (PRD 35 WS4, D1): each scenario runs through the real `startRun` once on the Brain's
 * loop and once on the agent, and the two records must be equal once ids and timestamps are normalised. A failure
 * prints the differing paths; the difference IS the finding. Nothing here is skipped, widened or edited to pass.
 *
 * `PARITY_DUMP=<dir>` writes both records of every scenario as JSON, for reading a difference in full.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffRecords } from './diff';
import { runScenario } from './harness';
import { scenarios } from './scenarios';

const dump = (id: string, engine: string, record: unknown): void => {
  const dir = process.env.PARITY_DUMP;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.${engine}.json`), JSON.stringify(record, null, 1));
};

describe('the agent runs the Brain exactly as the loop does', () => {
  for (const s of scenarios) {
    it(`${s.id} [${s.rows.join(',') || '-'}]: ${s.title}`, async () => {
      const loop = await runScenario(s, 'loop');
      const agent = await runScenario(s, 'agent');
      dump(s.id, 'loop', loop);
      dump(s.id, 'agent', agent);
      expect(loop.scenarioError, 'the loop must complete the scenario').toBeUndefined();
      // The scenario must reach the behaviour it is named for on the loop; a scenario that never gets there proves nothing.
      const labels = new Set(Object.values(loop.trace).flat().map((e) => (e as { label: string }).label));
      expect([...(s.loopShows ?? [])].filter((l) => !labels.has(l)), 'trace labels the loop must show').toEqual([]);
      expect(diffRecords(loop, agent)).toEqual([]);
    }, 60_000);
  }
});

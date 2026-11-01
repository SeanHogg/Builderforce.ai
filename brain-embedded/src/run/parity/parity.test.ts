/**
 * The differential parity suite (PRD 35 WS4, D1): each scenario runs through the real `startRun` once on the Brain's
 * loop and once on the agent, and the two records must be equal once ids and timestamps are normalised. A failure
 * prints the differing paths; the difference IS the finding. Nothing here is skipped, widened or edited to pass.
 */
import { describe, expect, it } from 'vitest';
import { diffRecords } from './diff';
import { runScenario } from './harness';
import { scenarios } from './scenarios';

describe('the agent runs the Brain exactly as the loop does', () => {
  for (const s of scenarios) {
    it(`${s.id} [${s.rows.join(',') || '-'}]: ${s.title}`, async () => {
      const loop = await runScenario(s, 'loop');
      const agent = await runScenario(s, 'agent');
      expect(loop.scenarioError, 'the loop must complete the scenario').toBeUndefined();
      expect(diffRecords(loop, agent)).toEqual([]);
    }, 60_000);
  }
});

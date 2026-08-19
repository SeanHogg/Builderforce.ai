import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PIPELINE_STAGE_PROBABILITY, cardProbabilityPercent, cardsAt, pipelineTotals,
  readPipelineModel, stageTotals,
} from './canvasSalesPipeline';

/**
 * The pipeline's arithmetic, and the one cross-package agreement it depends on.
 *
 * A board weights its own cards offline; the server weights the same deals in
 * `salesReports`. Two copies of the stage ladder is exactly the drift that produces a
 * board and a report forecasting different numbers from the same pipeline — so the
 * agreement is asserted rather than hoped for.
 */
describe('canvas sales pipeline', () => {
  const model = readPipelineModel({
    stages: ['new', 'qualified', 'proposal', 'won', 'lost'],
    swimlanes: [{ id: 'smb', title: 'SMB' }, { id: 'ent', title: 'Enterprise' }],
    cards: [
      { id: '1', lane: 'smb', stage: 'qualified', title: 'Acme', valueCents: 100_000 },
      { id: '2', lane: 'ent', stage: 'proposal', title: 'Globex', valueCents: 500_000, probabilityPercent: 80 },
      { id: '3', lane: 'ent', stage: 'proposal', title: 'Initech', valueCents: 0 },
      { id: '4', lane: 'smb', stage: 'won', title: 'Closed', valueCents: 900_000 },
      { id: '5', lane: 'smb', stage: 'lost', title: 'Gone', valueCents: 700_000 },
    ],
  });

  it('agrees with the server about how likely each stage is to close', () => {
    // The server's policy, read from its source. A test that restated the numbers would
    // pass while the two implementations disagreed, which is the whole failure it exists
    // to catch.
    const source = readFileSync(
      fileURLToPath(new URL('../../../api/src/application/sales/salesReports.ts', import.meta.url).href),
      'utf8',
    );
    const block = /export const STAGE_PROBABILITY_PERCENT[^{]*\{([^}]*)\}/.exec(source);
    expect(block, 'the server still declares STAGE_PROBABILITY_PERCENT').not.toBeNull();
    const server = Object.fromEntries(
      [...block![1]!.matchAll(/(\w+)\s*:\s*(\d+)/g)].map((match) => [match[1]!, Number(match[2])]),
    );
    expect(server).toEqual(PIPELINE_STAGE_PROBABILITY);
  });

  it('prefers a human judgement over the stage policy, and 0 means "not judged"', () => {
    expect(cardProbabilityPercent({ stage: 'proposal', probabilityPercent: 80 })).toBe(80);
    expect(cardProbabilityPercent({ stage: 'proposal', probabilityPercent: null })).toBe(60);
    expect(cardProbabilityPercent({ stage: 'proposal', probabilityPercent: 0 })).toBe(60);
    expect(cardProbabilityPercent({ stage: 'invented', probabilityPercent: null })).toBe(0);
  });

  it('excludes closed deals from the open pipeline', () => {
    // $9,000 won and $7,000 lost are both absent: counting won revenue as pipeline would
    // double-count it against the quota it is compared to.
    const totals = pipelineTotals(model);
    expect(totals.openCount).toBe(3);
    expect(totals.openValueCents).toBe(600_000);
    // 100,000 × 25% + 500,000 × 80% + 0 = 425,000.
    expect(totals.weightedCents).toBe(425_000);
    expect(totals.unpricedCount).toBe(1);
  });

  it('counts an unpriced deal rather than hiding it', () => {
    const proposal = stageTotals(model, 'proposal');
    expect(proposal.count).toBe(2);
    expect(proposal.unpriced).toBe(1);
    expect(proposal.weightedCents).toBe(400_000);
  });

  it('still places a card whose lane was renamed', () => {
    const orphaned = readPipelineModel({
      stages: ['new'],
      swimlanes: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
      cards: [{ id: '1', lane: 'gone', stage: 'new', title: 'Orphan' }],
    });
    expect(cardsAt(orphaned, 0, 'new').map((card) => card.id)).toEqual(['1']);
    expect(cardsAt(orphaned, 1, 'new')).toEqual([]);
  });
});

/**
 * A run that stopped at its OWN per-run cap ("token limit reached (12/200000 tokens)", built by
 * `runLimits.ts`) says something about the run, not about the tenant's allowance: the uniform outcome row
 * must NOT mark it quota-exhausted, and the outcome must still be taught to routing. A tenant's spent plan
 * allowance is the opposite on both counts.
 */
import { describe, expect, it } from 'vitest';
import { buildOutcomeRow, type RunOutcomeRow } from '@builderforce/agent-run';
import { foldsIntoRouting } from '@builderforce/learned-routing';
import { runSpendLimitMessage, runTokenLimitMessage } from '../../domain/containment/runLimits';

/** The row builder reads only what a run's state carries; a bare failed state is all these cases need. */
function rowFailedWith(reason: string): RunOutcomeRow {
  return buildOutcomeRow({ entryPoint: 'ide', kind: 'failed', reason, state: { step: 0, messages: [] } as never });
}

describe('a per-run cap is not the tenant running out of quota', () => {
  it('a per-run token limit failure is not quotaExhausted, and still folds into routing', () => {
    const row = rowFailedWith(runTokenLimitMessage(12, 200_000));
    expect(row).not.toHaveProperty('quotaExhausted');
    expect(foldsIntoRouting({ source: 'ide', terminalStatus: 'failed', quotaExhausted: row.quotaExhausted })).toBe(true);
  });

  it('a per-run spend limit failure is not quotaExhausted, and still folds into routing', () => {
    const row = rowFailedWith(runSpendLimitMessage(900, 500));
    expect(row).not.toHaveProperty('quotaExhausted');
    expect(foldsIntoRouting({ source: 'ide', terminalStatus: 'failed', quotaExhausted: row.quotaExhausted })).toBe(true);
  });

  it("the tenant's spent plan allowance IS quotaExhausted, and teaches routing nothing", () => {
    const row = rowFailedWith('chat completion failed with HTTP 429: Plan daily token limit reached (50,000 tokens).');
    expect(row.quotaExhausted).toBe(true);
    expect(foldsIntoRouting({ source: 'ide', terminalStatus: 'failed', quotaExhausted: row.quotaExhausted })).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { costCoverage } from './engineeringCost';

describe('costCoverage', () => {
  it('names how many runs the spend total covers when some did not report a cost', () => {
    expect(costCoverage({ runs: 40, pricedRuns: 10 })).toEqual({ priced: 10, total: 40 });
  });

  it('says nothing when every run is priced, when there are no runs, or when the server sent no count', () => {
    expect(costCoverage({ runs: 40, pricedRuns: 40 })).toBeNull();
    expect(costCoverage({ runs: 0, pricedRuns: 0 })).toBeNull();
    expect(costCoverage({ runs: 40 })).toBeNull();
  });
});

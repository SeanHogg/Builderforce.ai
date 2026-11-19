import { describe, expect, it, vi } from 'vitest';

const runwayReport = vi.fn();
const computeCapTable = vi.fn();
vi.mock('../finance/runwayReport', () => ({ runwayReport: (...a: unknown[]) => runwayReport(...a) }));
vi.mock('../finance/equity', () => ({
  companyKey: (s: string) => s,
  computeCapTable: (...a: unknown[]) => computeCapTable(...a),
}));

const { EXIT_METRICS, DEFAULT_EXIT_VALUES } = await import('./exitMetrics');

const db = {} as never;
const common = { id: 1, classRef: 'common', name: 'c', kind: 'common', authorized: 0, pricePerShare: null, seniority: 0, liquidationMultiple: null, participating: false };
const holder = (ref: string, shares: number, pct: number) => ({
  holderRef: ref, holderName: ref, shareClassRef: 'common', shareClassName: 'c', instrument: 'shares',
  shares, vested: shares, unvested: 0, percentFullyDiluted: pct,
});

describe('equity.exitPayoutAt', () => {
  it('defaults to $25M / $100M / $250M', () => {
    expect([...DEFAULT_EXIT_VALUES]).toEqual([25_000_000, 100_000_000, 250_000_000]);
  });

  it('is null (Not measured), never 0, with no company or no cap table', async () => {
    runwayReport.mockResolvedValueOnce({ declared: null });
    expect(await EXIT_METRICS['equity.exitPayoutAt']!.compute(db, 1, 30)).toBeNull();
    runwayReport.mockResolvedValueOnce({ declared: { companyId: 'acme' } });
    computeCapTable.mockResolvedValueOnce({ fullyDiluted: 0, classes: [], holders: [] });
    expect(await EXIT_METRICS['equity.exitPayoutAt']!.compute(db, 1, 30)).toBeNull();
  });

  it("returns the largest individual holder's payout at $100M", async () => {
    runwayReport.mockResolvedValueOnce({ declared: { companyId: 'acme' } });
    computeCapTable.mockResolvedValueOnce({
      fullyDiluted: 10_000_000,
      classes: [common],
      holders: [holder('founder', 8_000_000, 80), holder('other', 2_000_000, 20)],
    });
    expect(await EXIT_METRICS['equity.exitPayoutAt']!.compute(db, 1, 30)).toBe(80_000_000);
  });
});

/**
 * The agents usage rollup must backfill from the earliest `llm_usage_log` row
 * on a fresh install (no `agents.tokens` / `agents.cost_cents` snapshots yet),
 * then keep the trailing-day incremental scan on later sweeps.
 */
import { describe, expect, it } from 'vitest';
import type { Db } from '../../../infrastructure/database/connection';
import type { RollupSources } from '../metricRollup';
import { AGENTS_ROLLUP, USAGE_TRAILING_DAYS } from './agents';

/** Flatten a drizzle `sql` fragment to its literal text (bound params dropped). */
function sqlText(fragment: unknown): string {
  const walk = (node: unknown): string => {
    if (node && typeof node === 'object' && 'value' in (node as { value?: unknown })
      && Array.isArray((node as { value: unknown }).value)) {
      return (node as { value: string[] }).value.join('');
    }
    if (node && typeof node === 'object' && 'queryChunks' in (node as { queryChunks?: unknown })) {
      return (node as { queryChunks: unknown[] }).queryChunks.map(walk).join('');
    }
    return '';
  };
  return walk(fragment);
}

function executeDb(handler: (text: string) => unknown): Db {
  return {
    execute: async (query: unknown) => handler(sqlText(query)),
  } as unknown as Db;
}

function sourcesWith(coreRows: Array<Record<string, unknown>>): {
  sources: RollupSources;
  usageQueries: string[];
  coreQueries: string[];
} {
  const usageQueries: string[] = [];
  const coreQueries: string[] = [];
  const core = executeDb((text) => {
    coreQueries.push(text);
    return { rows: coreRows };
  });
  const usage = executeDb((text) => {
    usageQueries.push(text);
    return { rows: [] };
  });
  return {
    sources: { core, apps: usage, usage },
    usageQueries,
    coreQueries,
  };
}

const tokensSpec = () => AGENTS_ROLLUP.metrics.find((m) => m.key === 'agents.tokens')!;
const costSpec = () => AGENTS_ROLLUP.metrics.find((m) => m.key === 'agents.cost_cents')!;

describe('agents usage rollup window', () => {
  it('backfills from the earliest usage row when no tokens/cost snapshots exist', async () => {
    const { sources, usageQueries, coreQueries } = sourcesWith([]);
    const built = await tokensSpec().build(new Set(), sources);
    expect(built).toBeTruthy();
    expect(coreQueries).toHaveLength(1);
    expect(coreQueries[0]).toContain('metric_facts');
    expect(coreQueries[0]).toContain('agents.tokens');
    expect(coreQueries[0]).toContain('agents.cost_cents');
    expect(usageQueries).toHaveLength(1);
    expect(usageQueries[0]).toContain('MIN(created_at)');
    expect(usageQueries[0]).toContain('llm_usage_log');
    expect(usageQueries[0]).not.toContain('INTERVAL');
  });

  it('backfills when only one of the two usage metrics has a snapshot', async () => {
    const { sources, usageQueries } = sourcesWith([{ n: 1 }]);
    await tokensSpec().build(new Set(), sources);
    expect(usageQueries[0]).toContain('MIN(created_at)');
    expect(usageQueries[0]).not.toContain('INTERVAL');
  });

  it(`recomputes only the trailing ${USAGE_TRAILING_DAYS} days once both metrics have history`, async () => {
    const { sources, usageQueries } = sourcesWith([{ n: 2 }]);
    await tokensSpec().build(new Set(), sources);
    expect(usageQueries).toHaveLength(1);
    expect(usageQueries[0]).toContain('INTERVAL');
    expect(usageQueries[0]).not.toContain('MIN(created_at)');
  });

  it('shares one ledger scan (and one history probe) between tokens and cost', async () => {
    const { sources, usageQueries, coreQueries } = sourcesWith([{ n: 2 }]);
    await tokensSpec().build(new Set(), sources);
    await costSpec().build(new Set(), sources);
    expect(coreQueries).toHaveLength(1);
    expect(usageQueries).toHaveLength(1);
  });

  it('treats a history-probe failure as first-run backfill rather than skipping the metric', async () => {
    const usageQueries: string[] = [];
    const core = executeDb(() => {
      throw new Error('metric_facts missing');
    });
    const usage = executeDb((text) => {
      usageQueries.push(text);
      return { rows: [] };
    });
    const built = await tokensSpec().build(new Set(), { core, apps: usage, usage });
    expect(built).toBeTruthy();
    expect(usageQueries[0]).toContain('MIN(created_at)');
  });
});

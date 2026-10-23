import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runMemoryEmbeddingBackfill, allDrained } = vi.hoisted(() => ({
  runMemoryEmbeddingBackfill: vi.fn(),
  allDrained: vi.fn(),
}));
vi.mock('./application/memory/memoryEmbeddingBackfill', () => ({ runMemoryEmbeddingBackfill }));
vi.mock('./application/memory/memoryEmbeddingPolicy', async (importActual) => ({
  ...(await importActual<typeof import('./application/memory/memoryEmbeddingPolicy')>()),
  allDrained,
}));

import { CRON_SWEEPS } from './cronSweeps';
import { __clearL1CacheForTests } from './infrastructure/cache/readThroughCache';

const catchup = CRON_SWEEPS.find((s) => s.key === 'memory-embedding-catchup')!;
const ctx = { env: {}, db: {} } as never;

beforeEach(() => {
  vi.clearAllMocks();
  __clearL1CacheForTests();
});

describe('memory-embedding-catchup (E3 backfill cadence)', () => {
  it('rides the frequent tick, beside the daily backfill', () => {
    expect(catchup.cadence).toBe('frequent');
    expect(CRON_SWEEPS.find((s) => s.key === 'memory-embedding-backfill')?.cadence).toBe('daily');
  });

  it('is a no-op once both stores are covered', async () => {
    allDrained.mockResolvedValue(true);
    expect(await catchup.run(ctx)).toBeNull();
    expect(allDrained).toHaveBeenCalledWith({}, ['agent_memory', 'project_facts']);
    expect(runMemoryEmbeddingBackfill).not.toHaveBeenCalled();
  });

  it('runs the backfill once per UTC hour while a store is uncovered', async () => {
    allDrained.mockResolvedValue(false);
    runMemoryEmbeddingBackfill.mockResolvedValue({ memories: 3, projectFacts: 1 });
    expect(await catchup.run(ctx)).toBe('memories=3 facts=1');
    expect(await catchup.run(ctx)).toBeNull();
    expect(runMemoryEmbeddingBackfill).toHaveBeenCalledTimes(1);
  });
});

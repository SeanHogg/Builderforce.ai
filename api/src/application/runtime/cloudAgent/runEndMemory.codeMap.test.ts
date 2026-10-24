/**
 * The cloud run's half of the shared code map: what the run read and changed lands in
 * project memory under its AREA key, next to the run-outcome fact, so the next run on
 * that area — cloud, editor or on-prem — opens those files first.
 */
import { describe, expect, it, vi } from 'vitest';

const remember = vi.fn(async () => undefined);
vi.mock('../../memory/memoryService', () => ({ buildMemoryCapability: () => ({ remember }) }));

import { commitRunMemory } from './runEndMemory';

const base = { db: {} as never, env: {} as never, tenantId: 1, projectId: 2, executionId: 3, summary: 'Moved the canvas into its own panel.' };

describe('commitRunMemory code map', () => {
  it('writes the code map under its own key after the run outcome', async () => {
    remember.mockClear();
    const ok = await commitRunMemory({ ...base, codeMap: { key: 'codemap:web/src', content: 'Code map for `web/src`' } });
    expect(ok).toBe(true);
    expect(remember.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['run-outcome:project-2:3', 'codemap:web/src']);
  });

  it('writes only the outcome when the run mapped nothing', async () => {
    remember.mockClear();
    await commitRunMemory({ ...base, codeMap: null });
    expect(remember).toHaveBeenCalledTimes(1);
  });
});

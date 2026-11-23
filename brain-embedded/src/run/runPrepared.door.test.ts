/**
 * ONE door: a prepared Brain run opens through `openRun` (never `runAgent`), handing it the run's ROUTE input and the surface's
 * ports - the finish ports carry the open-work gate sequence - instead of the module overrides it passed before.
 */
import { describe, expect, it, vi } from 'vitest';
import { runOn, say, type Scenario } from './areaR/harness';

const seen = vi.hoisted(() => ({ inputs: [] as Array<Record<string, any>> }));

vi.mock('@builderforce/agent-run', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@builderforce/agent-run')>();
  return {
    ...actual,
    openRun: (input: Record<string, any>) => {
      seen.inputs.push(input);
      return actual.openRun(input as never);
    },
  };
});

describe('runPrepared opens the run through openRun', () => {
  it('regression: hands openRun the run route and the surface ports (finish.openWork, closeOut, compaction, preflight)', async () => {
    const s: Scenario = {
      key: 9401,
      script: () => [say('Done.')],
      request: () => ({ pipeline: { routing: 'auto' as const }, userTurn: 'fix the typo in a.ts' }),
    };
    await runOn(s);

    expect(seen.inputs).toHaveLength(1);
    const input = seen.inputs[0]!;
    expect(input.route).toMatchObject({ request: expect.any(String), routing: { mode: 'auto' } });
    expect(input.policy.entryPoint).toBeTruthy();
    expect(input.surface.finish.openWork).toBeTypeOf('function');
    expect(input.surface.closeOut).toBeTypeOf('function');
    expect(input.surface.compaction.hook).toBeDefined();
    expect(input.surface.preflight).toBeTypeOf('function');
    expect(input.modules).toBeUndefined();
  });
});

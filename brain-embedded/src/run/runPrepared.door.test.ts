/**
 * ONE door: a prepared Brain run opens through `openRun` (never `runAgent`), handing it the run's ROUTE input and the surface's
 * ports - the finish ports carry the open-work gate sequence - instead of the module overrides it passed before.
 */
import { describe, expect, it, vi } from 'vitest';
import { calls, runOn, say, spec, type Scenario } from './areaR/harness';

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
  it('records a declared PRD check from the Brain tool result even when its display output is shortened', async () => {
    const path = 'docs/specs/50-prd-one-pipeline.md';
    const command = 'pnpm exec vitest run src/crossAdapterConformance.test.ts';
    const cwd = 'brain-embedded';
    const capture = await runOn({
      key: 9402,
      request: () => ({ tools: [spec('read_file'), spec('run_command')], userTurn: `Validate ${path}.` }),
      script: () => [
        calls({ name: 'read_file', args: { path } }),
        calls({ name: 'run_command', args: { command, cwd } }),
        say('Brain conformance passed.'),
      ],
      tools: {
        read_file: () => ({
          path,
          content: ['# PRD 50', '```builderforce-acceptance', JSON.stringify([{ command, cwd }]), '```'].join('\n'),
        }),
        run_command: () => ({ ok: true, exitCode: 0, stdout: 'output line\n'.repeat(5000) }),
      },
    });
    expect(capture.threw).toBeUndefined();
    expect(capture.error).toBe('');
    expect(capture.trace).toContainEqual(expect.objectContaining({
      label: 'run.spec_validation', args: { completed: 1, failed: 0, pending: 0, unverified: 0, incomplete: false },
    }));
  });

  it('regression: hands openRun the run route and the surface ports (finish.openWork, closeOut, compaction, preflight)', async () => {
    seen.inputs.length = 0;
    const modelPreflight = vi.fn(async () => ({ byoUnresolved: ['anthropic:expired'] }));
    const s: Scenario = {
      key: 9401,
      script: () => [say('Done.')],
      request: () => ({ modelPreflight, pipeline: { routing: 'auto' as const }, userTurn: 'fix the typo in a.ts' }),
    };
    const capture = await runOn(s);
    expect(capture.threw).toBeUndefined();
    expect(modelPreflight).toHaveBeenCalledTimes(1);
    expect(capture.trace.filter((event) => event.label === 'model.preflight')).toHaveLength(1);

    expect(seen.inputs).toHaveLength(1);
    const input = seen.inputs[0]!;
    // The route was decided once in the preamble: openRun takes it as `{ input, decided }` and never routes again.
    expect(input.route.input).toMatchObject({ request: expect.any(String), routing: { mode: 'auto' } });
    expect(input.route.decided).toHaveProperty('skipsVerify');
    expect(input.policy.entryPoint).toBeTruthy();
    expect(input.surface.finish.openWork).toBeTypeOf('function');
    expect(input.surface.closeOut).toBeTypeOf('function');
    expect(input.surface.compaction.history).toBeDefined();
    expect(input.surface.compaction.hook).toBeUndefined();
    expect(input.surface.preflight).toMatchObject({ byoUnresolved: ['anthropic:expired'] });
    expect(input.surface.preflight).not.toBeTypeOf('function');
    expect(input.modules).toBeUndefined();
  });
});

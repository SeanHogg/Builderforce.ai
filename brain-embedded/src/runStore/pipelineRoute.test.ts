import { describe, expect, it } from 'vitest';
import { initialRunPolicy, nextTurn } from '@builderforce/run-policy';
import { decideRunPipeline, pipelineMetadata, pipelinePolicyOptions, skipsVerifyStage } from './pipelineRoute';
import type { RunLineage } from '../runLineage';

const lineage = {} as RunLineage;
const SMALL = 'Fix the typo in the README heading';
const BROAD = 'Refactor the auth module across all services, then add tests for every endpoint and then update the docs';

describe('decideRunPipeline', () => {
  it('routes only a host that asked for it, and never a sub-agent', () => {
    expect(decideRunPipeline({}, SMALL, { followUp: false })).toBeNull();
    expect(decideRunPipeline({ pipeline: { routing: 'auto' }, lineage }, SMALL, { followUp: false })).toBeNull();
  });

  it('a small edit takes the quick pass, a broad change the full pipeline', () => {
    expect(decideRunPipeline({ pipeline: { routing: 'auto' } }, SMALL, { followUp: false })?.route).toBe('quick');
    expect(decideRunPipeline({ pipeline: { routing: 'auto' } }, BROAD, { followUp: false })?.route).toBe('full');
  });

  it('`always` and the words "full pipeline" force full, keeping the score', () => {
    const always = decideRunPipeline({ pipeline: { routing: 'always' } }, SMALL, { followUp: false });
    expect(always?.route).toBe('full');
    expect(typeof always?.score).toBe('number');
    expect(decideRunPipeline({ pipeline: { routing: 'auto' } }, `${SMALL} — run the full pipeline`, { followUp: false })?.route).toBe('full');
  });

  it('honours the threshold', () => {
    expect(decideRunPipeline({ pipeline: { routing: 'auto', threshold: 0 } }, SMALL, { followUp: false })?.route).toBe('full');
  });
});

describe('pipelinePolicyOptions — stage resolution', () => {
  const phaseModels = { plan: 'planner', code: 'coder', verify: 'reviewer' };

  it('full: plans first on the stage models', () => {
    const full = decideRunPipeline({ pipeline: { routing: 'always' } }, SMALL, { followUp: false });
    const opts = pipelinePolicyOptions({ phaseModels, pipeline: { routing: 'always' } }, full);
    expect(opts).toEqual({ startPhase: 'plan', phaseModels });
    expect(nextTurn(initialRunPolicy(opts), { hasTools: true })).toMatchObject({ role: 'plan', model: 'planner' });
  });

  it('quick: starts coding on the quick model, with no plan phase', () => {
    const quick = decideRunPipeline({ pipeline: { routing: 'auto' } }, SMALL, { followUp: false });
    const opts = pipelinePolicyOptions({ phaseModels, pipeline: { routing: 'auto', quickModel: 'fast' } }, quick);
    expect(opts.startPhase).toBe('code');
    expect(nextTurn(initialRunPolicy(opts), { hasTools: true })).toMatchObject({ role: 'code', model: 'fast' });
    expect(skipsVerifyStage(quick)).toBe(true);
    expect(pipelineMetadata(quick)).toEqual({ pipelineRoute: 'quick', routeScore: quick!.score });
  });

  it('quick: the quick model wins over a SOFT run model, never over a strict pin', () => {
    const quick = decideRunPipeline({ pipeline: { routing: 'auto' } }, SMALL, { followUp: false });
    const soft = pipelinePolicyOptions({ pipeline: { routing: 'auto', quickModel: 'fast' } }, quick);
    expect(soft.pinnedModel).toBe('fast');
    // Spread after the run's own model, as runPreamble does.
    expect(nextTurn(initialRunPolicy({ pinnedModel: 'default-model', ...soft }), { hasTools: true })).toMatchObject({ model: 'fast' });
    const strict = pipelinePolicyOptions({ modelStrict: true, pipeline: { routing: 'auto', quickModel: 'fast' } }, quick);
    expect(strict).not.toHaveProperty('pinnedModel');
    const full = decideRunPipeline({ pipeline: { routing: 'always' } }, SMALL, { followUp: false });
    expect(pipelinePolicyOptions({ pipeline: { routing: 'always', quickModel: 'fast' } }, full)).not.toHaveProperty('pinnedModel');
  });

  it('quick with no quick model codes on the code model', () => {
    const quick = decideRunPipeline({ pipeline: { routing: 'auto' } }, SMALL, { followUp: false });
    expect(pipelinePolicyOptions({ phaseModels, pipeline: { routing: 'auto' } }, quick).phaseModels?.code).toBe('coder');
  });

  it('a sub-agent keeps its code start; an unrouted run plans and sends no route', () => {
    expect(pipelinePolicyOptions({ lineage }, null)).toEqual({ startPhase: 'code' });
    expect(pipelinePolicyOptions({}, null)).toEqual({ startPhase: 'plan' });
    expect(pipelineMetadata(null)).toEqual({});
    expect(skipsVerifyStage(null)).toBe(false);
  });
});

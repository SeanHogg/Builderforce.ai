import { describe, expect, it } from 'vitest';
import { initialRunPolicy, nextTurn, reviewPhaseModel } from '@builderforce/run-policy';
import { decideRoute, routeMetadata } from './runRoute';
const SMALL = 'Fix the typo in the README heading';
const BROAD = 'Refactor the auth module across all services, then add tests for every endpoint and then update the docs';

/** The run's route as the preamble decides it: `routeRun` over the request, through the one input builder. */
const route = (req: Parameters<typeof decideRoute>[0], request: string, followUp = false) => decideRoute(req, request, followUp);

describe('decideRoute', () => {
  it('uses full routing by default', () => {
    expect(route({}, SMALL).pipeline?.route).toBe('full');
  });

  it('a small edit takes the quick pass, a broad change the full pipeline', () => {
    expect(route({ pipeline: { routing: 'auto' } }, SMALL).pipeline?.route).toBe('quick');
    expect(route({ pipeline: { routing: 'auto' } }, BROAD).pipeline?.route).toBe('full');
  });

  it('`always` and the words "full pipeline" force full, keeping the score', () => {
    const always = route({ pipeline: { routing: 'always' } }, SMALL).pipeline;
    expect(always?.route).toBe('full');
    expect(typeof always?.score).toBe('number');
    expect(route({ pipeline: { routing: 'auto' } }, `${SMALL} — run the full pipeline`).pipeline?.route).toBe('full');
  });

  it('honours the threshold', () => {
    expect(route({ pipeline: { routing: 'auto', threshold: 0 } }, SMALL).pipeline?.route).toBe('full');
  });
});

describe('route.start — stage resolution', () => {
  const phaseModels = { plan: 'planner', code: 'coder', verify: 'reviewer' };

  it('full: plans first on the stage models', () => {
    const opts = route({ phaseModels, pipeline: { routing: 'always' } }, SMALL).start;
    expect(opts).toEqual({ startPhase: 'plan', phaseModels });
    expect(nextTurn(initialRunPolicy(opts), { hasTools: true })).toMatchObject({ role: 'plan', model: 'planner' });
  });

  it('quick: starts coding on the quick model, with no plan phase', () => {
    const quick = route({ phaseModels, pipeline: { routing: 'auto', quickModel: 'fast' } }, SMALL);
    expect(quick.start.startPhase).toBe('code');
    expect(nextTurn(initialRunPolicy(quick.start), { hasTools: true })).toMatchObject({ role: 'code', model: 'fast' });
    expect(quick.skipsVerify).toBe(true);
    expect(routeMetadata(quick)).toEqual({ pipelineRoute: 'quick', routeScore: quick.pipeline!.score });
  });

  it('quick: the quick model wins over a SOFT run model, never over a strict pin', () => {
    const soft = route({ pipeline: { routing: 'auto', quickModel: 'fast' } }, SMALL).start;
    expect(soft.pinnedModel).toBe('fast');
    // Spread after the run's own model, as runPreamble does.
    expect(nextTurn(initialRunPolicy({ pinnedModel: 'default-model', ...soft }), { hasTools: true })).toMatchObject({ model: 'fast' });
    const strict = route({ modelStrict: true, pipeline: { routing: 'auto', quickModel: 'fast' } }, SMALL).start;
    expect(strict).not.toHaveProperty('pinnedModel');
    expect(route({ pipeline: { routing: 'always', quickModel: 'fast' } }, SMALL).start).not.toHaveProperty('pinnedModel');
  });

  it('the review stage model passes through; run-policy prefers it over a legacy verify entry', () => {
    const opts = route({ phaseModels: { code: 'coder', review: 'judge', verify: 'legacy' }, pipeline: { routing: 'always' } }, SMALL).start;
    expect(opts.phaseModels).toEqual({ code: 'coder', review: 'judge', verify: 'legacy' });
    expect(reviewPhaseModel(opts.phaseModels)).toBe('judge');
  });

  it('quick with no quick model codes on the code model', () => {
    expect(route({ phaseModels, pipeline: { routing: 'auto' } }, SMALL).start.phaseModels?.code).toBe('coder');
  });

});

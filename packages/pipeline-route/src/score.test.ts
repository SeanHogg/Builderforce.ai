import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROUTE_THRESHOLD,
  ROUTE_WEIGHTS,
  isPipelineRoute,
  pipelineFeaturesOf,
  routeThreshold,
  scorePipeline,
  type PipelineFeatures,
} from './index.js';

const base: PipelineFeatures = {
  requestChars: 30,
  fileMentions: 0,
  multiStep: false,
  broadScope: false,
  questionOnly: false,
  followUp: false,
  actionType: 'other',
  forceFull: false,
};

describe('pipelineFeaturesOf', () => {
  it('reads files, steps, scope and questions from the request', () => {
    const f = pipelineFeaturesOf('1. update src/auth/login.ts\n2. then fix api/routes.ts\n3. add tests across all services', { actionType: 'refactor' });
    expect(f.fileMentions).toBe(2);
    expect(f.multiStep).toBe(true);
    expect(f.broadScope).toBe(true);
    expect(f.questionOnly).toBe(false);
    expect(f.actionType).toBe('refactor');
  });

  it('a question without a change verb is question-only', () => {
    expect(pipelineFeaturesOf('Where is the session token refreshed?').questionOnly).toBe(true);
    expect(pipelineFeaturesOf('Can you fix the session refresh?').questionOnly).toBe(false);
  });

  it('"full pipeline" is the override', () => {
    expect(pipelineFeaturesOf('Rename the flag — run the full pipeline').forceFull).toBe(true);
    expect(pipelineFeaturesOf('Rename the flag').forceFull).toBe(false);
  });

  it('defaults to `other` and not a follow-up', () => {
    const f = pipelineFeaturesOf('fix it');
    expect(f.actionType).toBe('other');
    expect(f.followUp).toBe(false);
  });
});

describe('scorePipeline', () => {
  it('routes a small edit quick and a broad multi-step change full', () => {
    const small = scorePipeline({ ...base, actionType: 'docs' });
    expect(small.route).toBe('quick');
    expect(small.score).toBeLessThan(0.3);
    const broad = scorePipeline({ ...base, multiStep: true, broadScope: true, actionType: 'refactor' });
    expect(broad.route).toBe('full');
    expect(broad.score).toBeGreaterThan(0.9);
    expect(broad.reason).toContain('multi-step');
  });

  it('is the logistic of the weighted features', () => {
    const z = ROUTE_WEIGHTS.bias + ROUTE_WEIGHTS.multiStep;
    expect(scorePipeline({ ...base, multiStep: true }).score).toBeCloseTo(1 / (1 + Math.exp(-z)), 2);
  });

  it('honours the threshold', () => {
    const f = { ...base, actionType: 'frontend_ui' };
    const { score } = scorePipeline(f);
    expect(scorePipeline(f, { threshold: score }).route).toBe('full');
    expect(scorePipeline(f, { threshold: Math.min(1, score + 0.01) }).route).toBe('quick');
  });

  it('`always` and the phrase force full but keep the score', () => {
    const quick = scorePipeline(base);
    expect(quick.route).toBe('quick');
    expect(scorePipeline(base, { mode: 'always' })).toMatchObject({ route: 'full', score: quick.score });
    expect(scorePipeline({ ...base, forceFull: true })).toMatchObject({ route: 'full', score: quick.score });
  });

  it('length and file mentions are capped', () => {
    const huge = scorePipeline({ ...base, requestChars: 10_000_000, fileMentions: 999 }, { weights: { ...ROUTE_WEIGHTS, bias: 0 } });
    const capped = scorePipeline({ ...base, requestChars: 8_000, fileMentions: 4 }, { weights: { ...ROUTE_WEIGHTS, bias: 0 } });
    expect(huge.score).toBe(capped.score);
  });
});

describe('routeThreshold', () => {
  it('clamps numbers and defaults the rest', () => {
    expect(routeThreshold(0.7)).toBe(0.7);
    expect(routeThreshold(3)).toBe(1);
    expect(routeThreshold(-1)).toBe(0);
    expect(routeThreshold('0.7')).toBe(DEFAULT_ROUTE_THRESHOLD);
    expect(routeThreshold(Number.NaN)).toBe(DEFAULT_ROUTE_THRESHOLD);
  });
});

describe('isPipelineRoute', () => {
  it('accepts only the two routes', () => {
    expect(isPipelineRoute('full')).toBe(true);
    expect(isPipelineRoute('quick')).toBe(true);
    expect(isPipelineRoute('gateway')).toBe(false);
  });
});

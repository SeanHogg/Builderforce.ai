import { describe, expect, it } from 'vitest';
import { readPipelineAttribution } from './pipelineRouteAttribution';

describe('readPipelineAttribution', () => {
  it('promotes a known route and an in-range score', () => {
    expect(readPipelineAttribution({ pipelineRoute: 'quick', routeScore: 0.31 })).toEqual({ pipelineRoute: 'quick', routeScore: 0.31 });
    expect(readPipelineAttribution({ pipelineRoute: 'full' })).toEqual({ pipelineRoute: 'full', routeScore: null });
  });

  it('reads anything else as null', () => {
    expect(readPipelineAttribution(null)).toEqual({ pipelineRoute: null, routeScore: null });
    expect(readPipelineAttribution({ pipelineRoute: 'gateway', routeScore: 7 })).toEqual({ pipelineRoute: null, routeScore: null });
    expect(readPipelineAttribution({ pipelineRoute: 'full', routeScore: '0.5' })).toEqual({ pipelineRoute: 'full', routeScore: null });
  });
});

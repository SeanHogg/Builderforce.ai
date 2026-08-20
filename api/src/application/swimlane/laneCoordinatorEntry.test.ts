import { describe, it, expect } from 'vitest';
import { laneNeedsCoordinator } from './laneCoordinatorEntry';

/**
 * WHICH ENGINE a lane entry gets. A board drag used to reach only the simple one-agent
 * executor, so a lane's second agent, its success policy and its lane action were all
 * configuration with no effect. This is the predicate that decides.
 */
const lane = (over: Partial<Parameters<typeof laneNeedsCoordinator>[0]> = {}) => ({
  successPolicy: 'all',
  successThreshold: null,
  actionType: null,
  executionMode: 'sequential',
  ...over,
});

describe('laneNeedsCoordinator', () => {
  it('keeps the cheap path for the ordinary lane: one agent, default policy, no action', () => {
    expect(laneNeedsCoordinator(lane(), [{ runtime: 'cloud' }])).toBe(false);
  });

  it('keeps the cheap path for an UNSTAFFED lane (nothing to stage)', () => {
    expect(laneNeedsCoordinator(lane(), [])).toBe(false);
  });

  it('stages a lane with more than one agent — the simple executor would run one and drop the rest', () => {
    expect(laneNeedsCoordinator(lane(), [{ runtime: 'cloud' }, { runtime: 'cloud' }])).toBe(true);
  });

  it('stages a browser-claimed agent — it is pulled by a worker, never pushed', () => {
    expect(laneNeedsCoordinator(lane(), [{ runtime: 'browser' }])).toBe(true);
  });

  it('stages a quorum policy, which only means something across a SET of dispatches', () => {
    expect(laneNeedsCoordinator(lane({ successPolicy: 'any' }), [{ runtime: 'cloud' }])).toBe(true);
    expect(laneNeedsCoordinator(lane({ successPolicy: 'n_of_m', successThreshold: 2 }), [{ runtime: 'cloud' }])).toBe(true);
  });

  it('stages a lane ACTION — it fires when the stage settles, and there is no stage otherwise', () => {
    expect(laneNeedsCoordinator(lane({ actionType: 'move_ticket' }), [{ runtime: 'cloud' }])).toBe(true);
    expect(laneNeedsCoordinator(lane({ actionType: 'run_workflow' }), [{ runtime: 'cloud' }])).toBe(true);
  });

  it('does NOT stage on `advance`, which is what the simple path already does', () => {
    expect(laneNeedsCoordinator(lane({ actionType: 'advance' }), [{ runtime: 'cloud' }])).toBe(false);
  });

  it('does NOT stage on sequential mode alone — ordering is unobservable with one dispatch', () => {
    expect(laneNeedsCoordinator(lane({ executionMode: 'sequential' }), [{ runtime: 'cloud' }])).toBe(false);
  });
});

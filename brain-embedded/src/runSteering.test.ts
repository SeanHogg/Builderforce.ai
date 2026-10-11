import { beforeEach, describe, expect, it } from 'vitest';
import { drainRunSteering, queueRunSteering, resetRunSteering } from './runSteering';

/** Direction for a LIVE run, by run key — an owner redirecting its sub-agent, a child
 *  reporting to its owner, the person steering a queued message in. */
describe('run steering', () => {
  beforeEach(() => resetRunSteering());

  it('hands a run its messages once, oldest first', () => {
    queueRunSteering(-7, 'only the API half');
    queueRunSteering(-7, 'Ada already did the schema');
    expect(drainRunSteering(-7)).toEqual(['only the API half', 'Ada already did the schema']);
    expect(drainRunSteering(-7)).toEqual([]);
  });

  it('keeps each run its own inbox', () => {
    queueRunSteering(1, 'for the owner');
    queueRunSteering(-2, 'for the child');
    expect(drainRunSteering(-2)).toEqual(['for the child']);
    expect(drainRunSteering(1)).toEqual(['for the owner']);
  });

  it('ignores blank direction', () => {
    queueRunSteering(3, '   ');
    expect(drainRunSteering(3)).toEqual([]);
  });
});

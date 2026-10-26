import { beforeEach, describe, expect, it } from 'vitest';
import { drainRunSteering, queueRunSteering, resetRunSteering, steerModelContent } from './runSteering';

/** Direction for a LIVE run, by run key — an owner redirecting its sub-agent, a child
 *  reporting to its owner, the person steering a queued message in. */
describe('run steering', () => {
  beforeEach(() => resetRunSteering());

  it('hands a run its messages once, oldest first', () => {
    queueRunSteering(-7, 'only the API half');
    queueRunSteering(-7, 'Ada already did the schema');
    expect(drainRunSteering(-7).map((m) => m.text)).toEqual(['only the API half', 'Ada already did the schema']);
    expect(drainRunSteering(-7)).toEqual([]);
  });

  it('keeps each run its own inbox', () => {
    queueRunSteering(1, 'for the owner');
    queueRunSteering(-2, 'for the child');
    expect(drainRunSteering(-2).map((m) => m.text)).toEqual(['for the child']);
    expect(drainRunSteering(1).map((m) => m.text)).toEqual(['for the owner']);
  });

  it('ignores blank direction', () => {
    queueRunSteering(3, '   ');
    expect(drainRunSteering(3)).toEqual([]);
  });

  it('carries attachments so a mid-run message keeps its images', () => {
    queueRunSteering(4, 'what does this screenshot show?', {
      interrupt: true,
      attachments: [{ key: 'a', name: 'shot.png', type: 'image/png', imageUrl: 'data:image/png;base64,AAA' }],
    });
    const [msg] = drainRunSteering(4);
    expect(msg.attachments?.[0].imageUrl).toBe('data:image/png;base64,AAA');
  });

  it('builds the same vision content a normal send builds', () => {
    const plain = steerModelContent({ text: 'plain words' });
    expect(plain).toBe('plain words');
    const withImage = steerModelContent({
      text: 'look at this',
      attachments: [{ key: 'a', name: 'shot.png', type: 'image/png', imageUrl: 'data:image/png;base64,AAA' }],
    });
    expect(withImage).toEqual([
      { type: 'text', text: 'look at this' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
    ]);
  });
});

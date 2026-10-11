import { describe, expect, it } from 'vitest';
import type { ReplayChunk, ReplayVisitMeta } from '@builderforce/interaction-contract';
import { aggregateInteractions, deviceClassFromViewport } from './interactionAggregate';

const meta: ReplayVisitMeta = {
  visitId: 'v1',
  siteId: 's1',
  startedAt: 1,
  releaseKey: 'rel',
  path: '/pricing',
  viewport: { w: 1280, h: 720 },
};

function chunk(events: ReplayChunk['events']): ReplayChunk {
  return { visitId: 'v1', seq: 0, events };
}

describe('deviceClassFromViewport', () => {
  it('uses the filter-registry vocabulary', () => {
    expect(deviceClassFromViewport({ w: 375 })).toBe('mobile');
    expect(deviceClassFromViewport({ w: 767 })).toBe('mobile');
    expect(deviceClassFromViewport({ w: 768 })).toBe('tablet');
    expect(deviceClassFromViewport({ w: 1023 })).toBe('tablet');
    expect(deviceClassFromViewport({ w: 1024 })).toBe('desktop');
  });
});

describe('aggregateInteractions', () => {
  it('counts two clicks in the same 50px cell as n=2', () => {
    const cells = aggregateInteractions(
      chunk([
        { t: 0, kind: 'click', x: 10, y: 10, selector: 'button.buy', label: 'Buy' },
        { t: 1, kind: 'click', x: 40, y: 20, selector: 'button.buy', label: 'Buy' },
      ]),
      meta,
    );
    expect(cells).toEqual([
      {
        path: '/pricing',
        device: 'desktop',
        kind: 'click',
        selector: 'button.buy',
        label: 'Buy',
        gx: 0,
        gy: 0,
        n: 2,
      },
    ]);
  });

  it('does not merge different selectors or grid cells', () => {
    const cells = aggregateInteractions(
      chunk([
        { t: 0, kind: 'click', x: 10, y: 10, selector: 'a' },
        { t: 1, kind: 'click', x: 60, y: 10, selector: 'a' },
        { t: 2, kind: 'click', x: 10, y: 10, selector: 'b' },
      ]),
      meta,
    );
    expect(cells).toHaveLength(3);
    expect(cells.map((c) => c.n).every((n) => n === 1)).toBe(true);
  });

  it('places scroll on a depth decile with an empty selector', () => {
    const cells = aggregateInteractions(
      chunk([
        { t: 0, kind: 'scroll', depth: 0.45, selector: 'main' },
        { t: 1, kind: 'scroll', depthDecile: 4 },
      ]),
      meta,
    );
    expect(cells).toEqual([
      {
        path: '/pricing',
        device: 'desktop',
        kind: 'scroll',
        selector: '',
        label: '',
        gx: 0,
        gy: 4,
        n: 2,
      },
    ]);
  });

  it('ignores kinds that are not heatmap cells and clicks without a point', () => {
    const cells = aggregateInteractions(
      chunk([
        { t: 0, kind: 'pageview' },
        { t: 1, kind: 'click', selector: 'a' },
        { t: 2, kind: 'nav' },
      ]),
      meta,
    );
    expect(cells).toEqual([]);
  });

  it('prefers the event path and the viewport device', () => {
    const cells = aggregateInteractions(
      chunk([{ t: 0, kind: 'dead', x: 0, y: 0, path: '/docs', selector: 'div' }]),
      { ...meta, viewport: { w: 390, h: 844 } },
    );
    expect(cells[0]).toMatchObject({ path: '/docs', device: 'mobile', kind: 'dead' });
  });
});

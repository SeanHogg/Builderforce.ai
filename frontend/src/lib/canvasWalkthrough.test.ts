import { describe, expect, it } from 'vitest';
import { canvasWalkthroughStops, MIN_WALKTHROUGH_OBJECTS, type CanvasWalkthroughObject } from './canvasWalkthrough';

function object(id: string, kind: string, x: number, y: number, extra: Record<string, unknown> = {}): CanvasWalkthroughObject {
  return { id, position: { x, y }, data: { kind: kind as CanvasWalkthroughObject['data']['kind'], title: id, ...extra } };
}

/** The board from the diagnostics that prompted this: 24 objects, 9 kinds. */
function generatedBoard(): CanvasWalkthroughObject[] {
  return [
    object('project', 'project', -330, 48),
    ...Array.from({ length: 5 }, (_, index) => object(`agent-${index}`, 'agent', 312 + index * 320, 182)),
    object('brain', 'chat', 0, 600),
    object('NutriPlan', 'company', 520, 500, { subtitle: 'Consumer nutrition app' }),
    ...Array.from({ length: 6 }, (_, index) => object(`competitor-${index}`, 'competitor', 100 + index * 320, 900)),
    object('segment-a', 'customerSegment', 100, 1_300),
    object('segment-b', 'customerSegment', 420, 1_300),
    object('gtm', 'gtmPlan', 740, 1_300),
    object('pricing', 'pricing', 1_060, 1_300),
    object('map', 'map', 1_380, 1_300),
  ];
}

describe('canvasWalkthroughStops', () => {
  it('says nothing about a board too small to get lost in', () => {
    const board = generatedBoard().slice(0, MIN_WALKTHROUGH_OBJECTS - 1);
    expect(canvasWalkthroughStops(board)).toEqual([]);
  });

  it('gives one stop per kind rather than one per object', () => {
    const stops = canvasWalkthroughStops(generatedBoard());

    // 24 objects, 8 artifact kinds — not 24 steps, and not one merged blur.
    expect(stops.map((stop) => stop.kind)).toEqual(
      expect.arrayContaining(['project', 'agent', 'company', 'competitor', 'customerSegment', 'gtmPlan', 'pricing', 'map']),
    );
    expect(stops.find((stop) => stop.kind === 'competitor')?.count).toBe(6);
    expect(stops.find((stop) => stop.kind === 'agent')?.count).toBe(5);
  });

  it('leaves the conversation and its frames out — they are not what was made', () => {
    const stops = canvasWalkthroughStops([...generatedBoard(), object('frame', 'frame', 0, 0)]);
    expect(stops.some((stop) => stop.kind === 'chat' || stop.kind === 'frame')).toBe(false);
  });

  it('reads a connected board in dependency order, not in board order', () => {
    // The pricing model is authored last and sits bottom-right, but everything
    // hangs off the company — so the company is where a walkthrough starts.
    const stops = canvasWalkthroughStops(generatedBoard(), [
      { source: 'NutriPlan', target: 'competitor-0' },
      { source: 'competitor-0', target: 'segment-a' },
      { source: 'segment-a', target: 'gtm' },
      { source: 'gtm', target: 'pricing' },
    ]);
    const at = (kind: string) => stops.findIndex((stop) => stop.kind === kind);

    expect(at('company')).toBeLessThan(at('competitor'));
    expect(at('competitor')).toBeLessThan(at('customerSegment'));
    expect(at('customerSegment')).toBeLessThan(at('gtmPlan'));
    expect(at('gtmPlan')).toBeLessThan(at('pricing'));
  });

  it('falls back to reading order when nothing is connected', () => {
    const stops = canvasWalkthroughStops([
      object('c', 'pricing', 900, 40),
      object('a', 'company', 100, 40),
      object('b', 'competitor', 500, 40),
      object('d', 'map', 100, 400),
    ]);
    expect(stops.map((stop) => stop.leadTitle)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('absorbs what will not fit instead of dropping it silently', () => {
    const stops = canvasWalkthroughStops(generatedBoard(), [], { maxStops: 3 });

    expect(stops).toHaveLength(3);
    expect(stops.at(-1)!.overflowKinds).toBeGreaterThan(0);
    // Every artifact is still spoken for by one stop or another.
    const covered = new Set(stops.flatMap((stop) => stop.objectIds));
    expect(covered.size).toBe(generatedBoard().filter((node) => node.data.kind !== 'chat').length);
  });

  it('carries the object own authored line and never invents one', () => {
    const stops = canvasWalkthroughStops(generatedBoard());
    expect(stops.find((stop) => stop.kind === 'company')?.summary).toBe('Consumer nutrition app');
    expect(stops.find((stop) => stop.kind === 'map')?.summary).toBe('');
  });
});

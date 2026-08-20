import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { LifecycleSwimlane } from './LifecycleSwimlane';
import { laneOccupancy } from '@/lib/laneOccupancy';
import type { LifecycleEvent } from '@/lib/builderforceApi';

const HOUR = 3_600_000;
const T0 = Date.parse('2026-08-01T00:00:00.000Z');

function move(hoursIn: number, from: string, to: string, backward = false): LifecycleEvent {
  return {
    at: new Date(T0 + hoursIn * HOUR).toISOString(),
    kind: 'lane_moved',
    actorKind: 'system',
    actorName: null,
    fromStatus: from,
    toStatus: to,
    isBackward: backward,
    source: 'task_status_transitions',
  } as LifecycleEvent;
}

const laneLabel = (l: string) => l.replace('_', ' ');
const fmt = (ms: number) => `${Math.round(ms / HOUR)}h`;

describe('LifecycleSwimlane', () => {
  it('draws one row per lane and one bar per stay', () => {
    const occupancy = laneOccupancy(
      [
        move(2, 'backlog', 'in_progress'),
        move(5, 'in_progress', 'in_review'),
        move(7, 'in_review', 'in_progress', true),
      ],
      new Date(T0).toISOString(),
      T0 + 9 * HOUR,
    );
    const { container } = render(
      <LifecycleSwimlane occupancy={occupancy} laneLabel={laneLabel} formatDuration={fmt} ariaLabel="swimlane" />,
    );

    // Three lanes, four stays (in_progress is entered twice).
    const rects = container.querySelectorAll('rect[rx="3"]');
    expect(rects).toHaveLength(4);
    expect(container.textContent).toContain('in review');
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toBe('swimlane');
  });

  it('renders nothing rather than an empty frame when there is no history', () => {
    const { container } = render(
      <LifecycleSwimlane occupancy={laneOccupancy([], null, T0)} laneLabel={laneLabel} formatDuration={fmt} />,
    );
    expect(container.querySelector('svg')).toBeNull();
  });

  it('scales rather than overflowing — no fixed pixel width on the svg', () => {
    const occupancy = laneOccupancy([move(1, 'backlog', 'done')], new Date(T0).toISOString(), T0 + 2 * HOUR);
    const { container } = render(
      <LifecycleSwimlane occupancy={occupancy} laneLabel={laneLabel} formatDuration={fmt} />,
    );
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('100%');
    expect(svg.getAttribute('viewBox')).toBeTruthy();
  });

  it('gives a stay of minutes a visible floor instead of rounding it away', () => {
    // "It passed review in 90 seconds" is itself worth seeing on a three-week chart.
    const occupancy = laneOccupancy(
      [move(0.02, 'in_review', 'done'), move(0.03, 'done', 'shipped')],
      new Date(T0).toISOString(),
      T0 + 500 * HOUR,
    );
    const { container } = render(
      <LifecycleSwimlane occupancy={occupancy} laneLabel={laneLabel} formatDuration={fmt} />,
    );
    for (const rect of container.querySelectorAll('rect[rx="3"]')) {
      expect(Number(rect.getAttribute('width'))).toBeGreaterThanOrEqual(3);
    }
  });
});

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { trackActivity } from '@/lib/activity/tracker';
import { useSectionTour } from './useSectionTour';

vi.mock('@/lib/activity/tracker', () => ({ trackActivity: vi.fn() }));

describe('useSectionTour step completion', () => {
  it('records each confirmed step once per start, including Finish', () => {
    const event = 'creation_tutorial_step_completed';
    const { result } = renderHook(() => useSectionTour({
      sectionId: 'creation-canvas',
      version: 2,
      audienceId: null,
      stepCompletedEvent: event,
    }));
    const completed = () => vi.mocked(trackActivity).mock.calls.filter(([kind]) => kind === event);

    act(() => result.current.openOffer());
    act(() => result.current.start());
    expect(completed()).toHaveLength(0);
    act(() => result.current.next(2));
    act(() => result.current.back());
    act(() => result.current.next(2));
    act(() => result.current.next(2));
    expect(completed()).toEqual([1, 2].map((step) => [
      event, { metadata: { sectionId: 'creation-canvas', tourVersion: 2, step } },
    ]));
    expect(result.current.phase).toBe('idle');

    act(() => result.current.start());
    act(() => result.current.cancel('escape'));
    expect(completed()).toHaveLength(2);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { StageHeaderSwitcher } from './StageHeaderSwitcher';

/**
 * The Journey Strip marks the tenant's REAL position (`aria-current="step"`) — now
 * including Make and Measure, which `useFounderJourney` derives from the proof
 * journey signal (PRD 33 §5.3.5) — independently of the stage being browsed.
 */
describe('StageHeaderSwitcher', () => {
  it.each(['make', 'measure'] as const)('marks %s as the current step', (stage) => {
    render(<StageHeaderSwitcher activeStage="idea" currentStage={stage} onSelect={vi.fn()} />);
    const current = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-current') === 'step');
    expect(current.map((b) => b.getAttribute('data-stage'))).toEqual([stage]);
  });

  it('keeps the browsed stage separate from the current one', () => {
    const onSelect = vi.fn();
    render(<StageHeaderSwitcher activeStage="run" currentStage="measure" onSelect={onSelect} />);
    const run = screen.getAllByRole('button').find((b) => b.getAttribute('data-stage') === 'run')!;
    expect(run).toHaveAttribute('data-active', 'true');
    expect(run).not.toHaveAttribute('aria-current');
    fireEvent.click(screen.getAllByRole('button').find((b) => b.getAttribute('data-stage') === 'measure')!);
    expect(onSelect).toHaveBeenCalledWith('measure');
  });
});

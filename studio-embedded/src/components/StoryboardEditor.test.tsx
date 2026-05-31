import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// StoryboardEditor imports CAMERA_MOVES (runtime) + types from the engine.
vi.mock('@seanhogg/builderforce-studio', () => ({
  CAMERA_MOVES: ['static', 'pan-left', 'pan-right', 'tilt-up', 'tilt-down', 'dolly-in', 'dolly-out'],
}));

import { StoryboardEditor } from './StoryboardEditor';
import type { Storyboard, ShotValidation } from '@seanhogg/builderforce-studio';

const storyboard: Storyboard = {
  treatment: 'A misty valley at dawn.',
  characters: [{ id: 'char-1', name: 'Knight', appearance: 'dented steel armour' }],
  shots: [
    { id: 's1', prompt: 'wide valley shot', characterIds: ['char-1'], camera: 'pan-right', action: 'walking', durationFrames: 6 },
    { id: 's2', prompt: 'dragon reveal', characterIds: [], camera: 'tilt-up', action: 'looking up', durationFrames: 4 },
  ],
};

describe('StoryboardEditor', () => {
  it('renders the treatment and an editable prompt per shot', () => {
    render(
      <StoryboardEditor storyboard={storyboard} onChange={() => {}} onRender={() => {}} onReplan={() => {}} />,
    );
    expect(screen.getByText(/misty valley/i)).toBeTruthy();
    expect(screen.getByDisplayValue('wide valley shot')).toBeTruthy();
    expect(screen.getByDisplayValue('dragon reveal')).toBeTruthy();
  });

  it('editing a shot prompt calls onChange with the patched storyboard', () => {
    const onChange = vi.fn();
    render(
      <StoryboardEditor storyboard={storyboard} onChange={onChange} onRender={() => {}} onReplan={() => {}} />,
    );
    fireEvent.change(screen.getByDisplayValue('wide valley shot'), {
      target: { value: 'aerial valley shot' },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as Storyboard;
    expect(next.shots[0].prompt).toBe('aerial valley shot');
    // Other shots untouched.
    expect(next.shots[1].prompt).toBe('dragon reveal');
  });

  it('shows a per-shot validation badge after a render', () => {
    const validations: ShotValidation[] = [
      { shotId: 's1', frameIndex: 0, validation: { ok: true, score: 0.91, issues: [] } },
      {
        shotId: 's2',
        frameIndex: 6,
        validation: { ok: false, score: 0.3, issues: [{ kind: 'character-drift', detail: 'wrong armour' }] },
      },
    ];
    render(
      <StoryboardEditor
        storyboard={storyboard}
        onChange={() => {}}
        onRender={() => {}}
        onReplan={() => {}}
        validations={validations}
      />,
    );
    expect(screen.getByText(/91%/)).toBeTruthy();
    expect(screen.getByText(/30%/)).toBeTruthy();
    // The failing shot's issue detail surfaces.
    expect(screen.getByText(/wrong armour/i)).toBeTruthy();
  });

  it('fires onRender / onReplan from the action buttons', () => {
    const onRender = vi.fn();
    const onReplan = vi.fn();
    render(
      <StoryboardEditor storyboard={storyboard} onChange={() => {}} onRender={onRender} onReplan={onReplan} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /render storyboard/i }));
    fireEvent.click(screen.getByRole('button', { name: /re-plan/i }));
    expect(onRender).toHaveBeenCalledTimes(1);
    expect(onReplan).toHaveBeenCalledTimes(1);
  });
});

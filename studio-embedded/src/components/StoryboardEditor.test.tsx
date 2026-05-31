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

  it('adds a shot with a fresh, collision-free id', () => {
    const onChange = vi.fn();
    render(<StoryboardEditor storyboard={storyboard} onChange={onChange} onRender={() => {}} onReplan={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /add shot/i }));
    const next = onChange.mock.calls[0][0] as Storyboard;
    expect(next.shots).toHaveLength(3);
    // New id must not collide with existing s1/s2 (uses the shot-N scheme).
    expect(new Set(next.shots.map((s) => s.id)).size).toBe(3);
  });

  it('removes a shot', () => {
    const onChange = vi.fn();
    render(<StoryboardEditor storyboard={storyboard} onChange={onChange} onRender={() => {}} onReplan={() => {}} />);
    fireEvent.click(screen.getAllByTitle('Delete shot')[0]);
    const next = onChange.mock.calls[0][0] as Storyboard;
    expect(next.shots.map((s) => s.id)).toEqual(['s2']);
  });

  it('reorders shots with move-down', () => {
    const onChange = vi.fn();
    render(<StoryboardEditor storyboard={storyboard} onChange={onChange} onRender={() => {}} onReplan={() => {}} />);
    fireEvent.click(screen.getAllByTitle('Move down')[0]);
    const next = onChange.mock.calls[0][0] as Storyboard;
    expect(next.shots.map((s) => s.id)).toEqual(['s2', 's1']);
  });

  it('editing a character appearance calls onChange with the patched bible', () => {
    const onChange = vi.fn();
    render(<StoryboardEditor storyboard={storyboard} onChange={onChange} onRender={() => {}} onReplan={() => {}} />);
    fireEvent.change(screen.getByDisplayValue('dented steel armour'), {
      target: { value: 'gleaming gold armour' },
    });
    const next = onChange.mock.calls[0][0] as Storyboard;
    expect(next.characters[0].appearance).toBe('gleaming gold armour');
  });

  it('removing a character also drops it from every shot cast', () => {
    const onChange = vi.fn();
    render(<StoryboardEditor storyboard={storyboard} onChange={onChange} onRender={() => {}} onReplan={() => {}} />);
    // s1 references char-1; removing char-1 must strip it from s1.characterIds.
    fireEvent.click(screen.getByTitle('Remove character'));
    const next = onChange.mock.calls[0][0] as Storyboard;
    expect(next.characters).toHaveLength(0);
    expect(next.shots.every((s) => !s.characterIds.includes('char-1'))).toBe(true);
  });
});

import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { formatReplayMomentTrailer, replayMomentFromDescription, type ReplayMoment } from '@builderforce/interaction-contract';
import type { CreationNodeData } from '../types';
import { TaskDescriptionField } from './TaskDescriptionField';

/**
 * The inspector shows a ticket's description without its hidden replay-moment trailer
 * and must never write the stripped text back (that would erase the moment the ticket's
 * measured effect is read from).
 */

const MOMENT: ReplayMoment = {
  siteId: '11111111-1111-4111-8111-111111111111',
  recordingId: '22222222-2222-4222-8222-222222222222',
  atMs: 12_345,
  releaseKey: 'abcdef123456',
  metric: 'frustrated',
  route: '/pricing',
};
const TRAILER = formatReplayMomentTrailer(MOMENT);
const RAW = `Rage click on Buy.\n\n${TRAILER}`;

/** Holds the node's data like the canvas does, so the controlled box follows what is typed. */
function Harness({ initial, onChange, onPersist }: { initial: string; onChange: (patch: Partial<CreationNodeData>) => void; onPersist: (description: string | null) => void }) {
  const [data, setData] = useState({ kind: 'task', title: 'T', content: initial } as CreationNodeData);
  return <TaskDescriptionField data={data} persistable onChange={(patch) => { onChange(patch); setData((current) => ({ ...current, ...patch })); }} onPersist={onPersist} />;
}

function setup(content: string) {
  const onChange = vi.fn();
  const onPersist = vi.fn();
  render(<Harness initial={content} onChange={onChange} onPersist={onPersist} />);
  return { box: screen.getByRole('textbox') as HTMLTextAreaElement, onChange, onPersist };
}

describe('TaskDescriptionField', () => {
  it('shows the text without the trailer', () => {
    expect(setup(RAW).box.value).toBe('Rage click on Buy.');
  });

  it('writes nothing when the box is blurred unchanged', () => {
    const { box, onPersist } = setup(RAW);
    fireEvent.focus(box);
    fireEvent.blur(box);
    expect(onPersist).not.toHaveBeenCalled();
  });

  it('persists an edit with the original trailer still attached', () => {
    const { box, onChange, onPersist } = setup(RAW);
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'Rage click on Buy, copy fixed.' } });
    fireEvent.blur(box);
    const saved = onPersist.mock.calls[0]![0] as string;
    expect(saved).toBe(`Rage click on Buy, copy fixed.\n\n${TRAILER}`);
    expect(replayMomentFromDescription(saved)).toEqual(MOMENT);
    expect(onChange).toHaveBeenCalledWith({ content: `Rage click on Buy, copy fixed.\n\n${TRAILER}` });
  });

  it('keeps trailing spaces and newlines as they are typed, and the trailer on save', () => {
    const { box, onChange, onPersist } = setup(RAW);
    fireEvent.focus(box);
    for (const typed of ['a', 'a ', 'a \n']) {
      fireEvent.change(box, { target: { value: typed } });
      expect(box.value).toBe(typed);
      expect(onChange).toHaveBeenLastCalledWith({ content: `${typed}\n\n${TRAILER}` });
    }
    fireEvent.blur(box);
    const saved = onPersist.mock.calls[0]![0] as string;
    expect(saved).toBe(`a \n\n\n${TRAILER}`);
    expect(replayMomentFromDescription(saved)).toEqual(MOMENT);
  });

  it('persists a plain description as typed, and null when emptied', () => {
    const { box, onPersist } = setup('Plain');
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: '' } });
    fireEvent.blur(box);
    expect(onPersist).toHaveBeenCalledWith(null);
  });
});

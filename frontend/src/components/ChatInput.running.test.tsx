import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatInput } from './ChatInput';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

/**
 * What the composer does WHILE the agent is working.
 *
 * Two guarantees, and they are the same on every surface that mounts this
 * control (Brain panel, Creation Canvas): the run can be interrupted, and the
 * user can keep typing. A composer that greys itself out for the length of a
 * turn reads as a hang, and there was no way to end a run that had gone wrong.
 */
describe('ChatInput while a run is in flight', () => {
  const renderComposer = (props: Partial<React.ComponentProps<typeof ChatInput>> = {}) => {
    const onSubmit = vi.fn();
    const onStop = vi.fn();
    const view = render(
      <ChatInput value="" onChange={() => {}} onSubmit={onSubmit} running onStop={onStop} {...props} />,
    );
    return { onSubmit, onStop, view };
  };

  const textarea = () => screen.getByRole('textbox');
  const stopButton = () => screen.getByRole('button', { name: 'chatInput.stop' });

  it('keeps the input live so the next turn can be typed mid-run', () => {
    renderComposer();
    expect(textarea()).not.toBeDisabled();
  });

  it('offers Stop in place of Send while the composer is empty', () => {
    const { onStop } = renderComposer();
    fireEvent.click(stopButton());
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('gives Send back the moment there is something to queue', () => {
    const { onSubmit } = renderComposer({ value: 'the follow-up I already know I want' });
    expect(screen.queryByRole('button', { name: 'chatInput.stop' })).toBeNull();

    fireEvent.submit(textarea().closest('form')!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('shows what it is holding, so a queued turn is never invisible', () => {
    const queued = { items: [{ id: 1, value: 'first' }, { id: 2, value: 'second' }], remove: () => {} };
    const { view } = renderComposer({ queued });
    // The held turns are listed as the shared chips — each one readable, each removable.
    expect(view.container.textContent).toContain('first');
    expect(view.container.textContent).toContain('second');
    expect(view.container.textContent).toContain('brain.queuedHint');

    view.rerender(<ChatInput value="" onChange={() => {}} onSubmit={() => {}} running onStop={() => {}} queued={{ items: [], remove: () => {} }} />);
    expect(view.container.textContent).not.toContain('brain.queuedHint');
  });

  it('shows Send, never Stop, when the host supplies no interrupt', () => {
    render(<ChatInput value="" onChange={() => {}} onSubmit={() => {}} running />);
    expect(screen.queryByRole('button', { name: 'chatInput.stop' })).toBeNull();
  });
});

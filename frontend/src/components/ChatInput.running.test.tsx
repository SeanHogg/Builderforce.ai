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
    const { view } = renderComposer({ queuedCount: 2 });
    expect(view.container.textContent).toContain('brain.queuedCount');

    view.rerender(<ChatInput value="" onChange={() => {}} onSubmit={() => {}} running onStop={() => {}} queuedCount={0} />);
    expect(view.container.textContent).not.toContain('brain.queuedCount');
  });

  it('shows Send, never Stop, when the host supplies no interrupt', () => {
    render(<ChatInput value="" onChange={() => {}} onSubmit={() => {}} running />);
    expect(screen.queryByRole('button', { name: 'chatInput.stop' })).toBeNull();
  });
});

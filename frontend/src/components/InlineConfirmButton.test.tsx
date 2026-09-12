import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InlineConfirmButton } from './InlineConfirmButton';

describe('InlineConfirmButton', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('arms on the first click and runs only on the second', () => {
    const onConfirm = vi.fn();
    render(<InlineConfirmButton onConfirm={onConfirm} hint="Every agent will follow it.">Approve</InlineConfirmButton>);

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onConfirm).not.toHaveBeenCalled();
    // Armed: the label turns into the confirm label and the consequence is shown.
    const armed = screen.getByRole('button', { name: 'common.inlineConfirm.confirm' });
    expect(armed).toHaveAttribute('data-armed', 'true');
    expect(screen.getByText('Every agent will follow it.')).toBeInTheDocument();

    fireEvent.click(armed);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Approve' })).not.toHaveAttribute('data-armed');
  });

  it('stands down on Escape, on Cancel, and after the timeout', () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    render(<InlineConfirmButton onConfirm={onConfirm} disarmAfterMs={1000}>Run</InlineConfirmButton>);

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'common.inlineConfirm.confirm' }), { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

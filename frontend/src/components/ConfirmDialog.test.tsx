import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('uses the shared surface and destructive button contract', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open title="Delete session?" message="This cannot be recovered." confirmLabel="Delete session" onConfirm={onConfirm} onCancel={vi.fn()} destructive />);

    expect(screen.getByRole('dialog', { name: 'Delete session?' })).toHaveAttribute('aria-describedby');
    const confirmButton = screen.getByRole('button', { name: 'Delete session' });
    expect(confirmButton).toHaveClass('ui-button--danger');
    fireEvent.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/messages/en.json';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import { SessionManagementControls } from './SessionManagementControls';

function renderControls(onDelete = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ConfirmProvider>
        <SessionManagementControls
          session={{ id: 'target', title: 'Launch plan' }}
          mergeCandidates={[{ id: 'source', title: 'Research' }]}
          onRename={vi.fn()}
          onMove={vi.fn()}
          onMerge={vi.fn()}
          onDelete={onDelete}
        />
      </ConfirmProvider>
    </NextIntlClientProvider>,
  );
  return onDelete;
}

describe('SessionManagementControls', () => {
  it('uses the shared icon menu rather than raw glyph controls', () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ConfirmProvider>
          <SessionManagementControls session={{ id: 'target', title: 'Launch plan' }} mergeCandidates={[]} onRename={vi.fn()} onMove={vi.fn()} onDelete={vi.fn()} />
        </ConfirmProvider>
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Launch plan' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Rename' }).querySelector('svg')).not.toBeNull();
    expect(container).not.toHaveTextContent(/📁|✎|⇆|×/);
  });

  it('routes deletion through the canonical confirm dialog', async () => {
    const nativeConfirm = vi.spyOn(window, 'confirm');
    const onDelete = renderControls();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Launch plan' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete session' }));

    expect(screen.getByRole('dialog', { name: 'Delete session?' })).toBeInTheDocument();
    expect(nativeConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete session' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledOnce());
    nativeConfirm.mockRestore();
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/messages/en.json';
import { SessionManagementControls } from './SessionManagementControls';

const confirmSpy = vi.fn(async () => true);
vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => confirmSpy }));

function renderControls(onDelete = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SessionManagementControls
        session={{ id: 'target', title: 'Launch plan' }}
        mergeCandidates={[{ id: 'source', title: 'Research' }]}
        onRename={vi.fn()}
        onMove={vi.fn()}
        onMerge={vi.fn()}
        onDelete={onDelete}
      />
    </NextIntlClientProvider>,
  );
  return onDelete;
}

describe('SessionManagementControls', () => {
  it('uses the shared icon menu rather than raw glyph controls', () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SessionManagementControls session={{ id: 'target', title: 'Launch plan' }} mergeCandidates={[]} onRename={vi.fn()} onMove={vi.fn()} onDelete={vi.fn()} />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'sessionManagement.actionsFor Launch plan' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'sessionManagement.rename' }).querySelector('svg')).not.toBeNull();
    expect(container).not.toHaveTextContent(/📁|✎|⇆|×/);
  });

  it('routes deletion through the canonical confirm dialog', async () => {
    confirmSpy.mockClear();
    const nativeConfirm = vi.spyOn(window, 'confirm');
    const onDelete = renderControls();

    fireEvent.click(screen.getByRole('button', { name: 'sessionManagement.actionsFor Launch plan' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'sessionManagement.delete' }));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalledWith(expect.objectContaining({
      title: 'sessionManagement.deleteConfirmTitle',
      destructive: true,
    })));
    expect(nativeConfirm).not.toHaveBeenCalled();
    await waitFor(() => expect(onDelete).toHaveBeenCalledOnce());
    nativeConfirm.mockRestore();
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/messages/en.json';
import { SessionActionBar } from './SessionActionBar';

const confirmSpy = vi.fn(async () => true);
vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => confirmSpy }));

function renderBar(overrides: Partial<Parameters<typeof SessionActionBar>[0]> = {}) {
  const props = {
    session: { id: 'target', title: 'Launch plan', folder: null },
    mergeCandidates: [{ id: 'source', title: 'Research' }],
    folders: ['Client work', 'Marketing'],
    onRename: vi.fn(),
    onMove: vi.fn(),
    onMerge: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SessionActionBar {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

describe('SessionActionBar', () => {
  it('shows every action on the session rather than behind a menu', () => {
    renderBar();

    for (const label of ['sessionManagement.rename', 'sessionManagement.move', 'sessionManagement.merge', 'sessionManagement.delete']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('offers the folders that already exist when moving', async () => {
    renderBar();

    fireEvent.click(screen.getByRole('button', { name: 'sessionManagement.move' }));

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'sessionManagement.folderLabel' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('combobox', { name: 'sessionManagement.folderLabel' }));

    await waitFor(() => expect(screen.getByRole('option', { name: 'Client work' })).toBeInTheDocument());
    expect(screen.getByRole('option', { name: 'Marketing' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'sessionManagement.folderNew' })).toBeInTheDocument();
  });

  it('routes deletion through the canonical confirm dialog', async () => {
    confirmSpy.mockClear();
    const nativeConfirm = vi.spyOn(window, 'confirm');
    const { onDelete } = renderBar();

    fireEvent.click(screen.getByRole('button', { name: 'sessionManagement.delete' }));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalledWith(expect.objectContaining({
      title: 'sessionManagement.deleteConfirmTitle',
      destructive: true,
    })));
    expect(nativeConfirm).not.toHaveBeenCalled();
    await waitFor(() => expect(onDelete).toHaveBeenCalledOnce());
    nativeConfirm.mockRestore();
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/messages/en.json';
import type { CreationSessionSummary } from '@/lib/builderforceApi';
import { CreationSessionTile } from './CreationSessionTile';

const session = {
  id: 's1',
  title: 'Launch plan',
  description: null,
  folderId: 'f1',
  folderName: 'Client work',
  status: 'active',
  preview: { objectCount: 3, kinds: ['chat'], objects: [] },
  revision: 1,
  lastActivityAt: '2026-09-05T10:00:00.000Z',
  createdAt: '2026-09-01T10:00:00.000Z',
  role: 'owner',
  collaboratorCount: 1,
  projectIds: [],
} satisfies CreationSessionSummary;

function renderTile(overrides: Partial<Parameters<typeof CreationSessionTile>[0]> = {}) {
  const props = {
    session,
    view: 'table' as const,
    selected: false,
    onSelectedChange: vi.fn(),
    projectLabel: (id: number) => `Project ${id}`,
    onOpen: vi.fn(),
    onFolderSelect: vi.fn(),
    folderActive: false,
    ...overrides,
  };
  const view = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <CreationSessionTile {...props}>{null}</CreationSessionTile>
    </NextIntlClientProvider>,
  );
  return { ...view, props };
}

describe('CreationSessionTile', () => {
  it('keeps the date with the rest of the session facts', () => {
    const { container } = renderTile();

    const meta = container.querySelector('[class*="meta"]');
    expect(meta?.textContent).toContain('Sep 5, 2026');
    expect(meta?.textContent).toContain('creationCanvas.sessionObjectsPeople');
  });

  it('offers selection without opening the session', () => {
    const { props } = renderTile();

    fireEvent.click(screen.getByRole('checkbox', { name: 'creationCanvas.selectSession' }));

    expect(props.onSelectedChange).toHaveBeenCalledWith(true);
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it('filters by folder when the folder chip is pressed', () => {
    const { props } = renderTile();

    fireEvent.click(screen.getByRole('button', { name: /Client work/ }));

    expect(props.onFolderSelect).toHaveBeenCalledWith('f1');
    expect(props.onOpen).not.toHaveBeenCalled();
  });
});

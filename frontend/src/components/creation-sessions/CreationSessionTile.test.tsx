import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/messages/en.json';
import type { CreationLibraryItem } from '@/domains/canvas/domain/creationLibrary';
import { CreationSessionTile } from './CreationSessionTile';

/** A canvas: it has a session, so it has a board to preview and actions to manage. */
const canvasItem = {
  key: 'session-s1',
  facet: 'canvas',
  sessionId: 's1',
  resource: null,
  title: 'Launch plan',
  kinds: ['chat'],
  objects: [],
  objectCount: 3,
  collaboratorCount: 1,
  lastActivityAt: '2026-09-05T10:00:00.000Z',
  pinned: false,
  unread: false,
  folderId: 'f1',
  folderName: 'Client work',
  projectIds: [],
  icon: null,
  subtitle: '',
  managed: true,
  focusObjectId: null,
} satisfies CreationLibraryItem;

/** A record whose session does not exist yet — the case that used to be drawn by a
 *  second, flatter row shape entirely. */
const recordItem = {
  ...canvasItem,
  key: 'workflow-w1',
  facet: 'workflow',
  sessionId: null,
  resource: { type: 'workflow', id: 'w1' },
  title: 'Nurture sequence',
  kinds: [],
  folderId: null,
  folderName: null,
  icon: '⌘',
  subtitle: 'Workflow · 3 runs',
  managed: false,
} satisfies CreationLibraryItem;

function renderTile(overrides: Partial<Parameters<typeof CreationSessionTile>[0]> = {}) {
  const props = {
    item: canvasItem,
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
  it('keeps the date with the rest of the item facts', () => {
    const { container } = renderTile();

    const meta = container.querySelector('[class*="meta"]');
    expect(meta?.textContent).toContain('Sep 5, 2026');
    expect(meta?.textContent).toContain('creationCanvas.sessionObjectsPeople');
  });

  it('offers selection without opening the session', () => {
    const { props } = renderTile();

    fireEvent.click(screen.getByRole('checkbox', { name: 'creationCanvas.selectSession Launch plan' }));

    expect(props.onSelectedChange).toHaveBeenCalledWith(true);
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it('filters by folder when the folder chip is pressed', () => {
    const { props } = renderTile();

    fireEvent.click(screen.getByRole('button', { name: /Client work/ }));

    expect(props.onFolderSelect).toHaveBeenCalledWith('f1');
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  // A record is the SAME tile, not a lesser row: it draws its own mark where a board
  // would be, reports its own line instead of "0 objects · 1 person", and offers no
  // bulk selection, because the archive/merge/delete it feeds all need a session.
  it('draws a record with its glyph, its own line, and no selection', () => {
    const { container } = renderTile({ item: recordItem });

    expect(container.querySelector('[class*="previewIcon"]')).not.toBeNull();
    expect(container.querySelector('[class*="previewEmpty"]')).toBeNull();
    expect(container.querySelector('[class*="meta"]')?.textContent).toContain('Workflow · 3 runs');
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('opens a record the same way it opens a canvas', () => {
    const { props } = renderTile({ item: recordItem });

    fireEvent.click(screen.getByText('Nurture sequence'));

    expect(props.onOpen).toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// The real catalogue, through the shared harness the other canvas specs use — so a
// key that is renamed in `en.json` and not here fails the test instead of silently
// rendering its own name.
vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

import messages from '@/i18n/messages/en.json';
import { presenceColor, presenceColorIndex } from '@/lib/canvas/presenceColor';
import { RemoteCursors, visibleCursors, type RemoteCursorMember } from './RemoteCursors';

// `ViewportPortal` renders into React Flow's pane, which does not exist outside a
// mounted board. Rendering its children in place is the whole of what the layer
// needs from it here — the point of the component under test is WHICH cursors are
// drawn and WHERE, not which DOM node they are parented to.
vi.mock('@xyflow/react', () => ({
  ViewportPortal: ({ children }: { children: React.ReactNode }) => <div data-testid="viewport">{children}</div>,
  useStore: (selector: (state: { transform: [number, number, number] }) => unknown) =>
    selector({ transform: [120, 40, 2] }),
}));

function renderCursors(members: RemoteCursorMember[], currentUserId: string | null = 'me') {
  return render(<RemoteCursors members={members} currentUserId={currentUserId} />);
}

const maya: RemoteCursorMember = { userId: 'maya', displayName: 'Maya', cursor: { x: 300, y: 180 } };

describe('visibleCursors', () => {
  it('never draws your own pointer — you already have one', () => {
    expect(visibleCursors([{ ...maya, userId: 'me' }], 'me')).toHaveLength(0);
  });

  it('drops members who have no live pointer', () => {
    const members: RemoteCursorMember[] = [
      maya,
      { userId: 'reeve', displayName: 'Reeve', cursor: null },
      { userId: 'cass', displayName: 'Cass' },
      // A pointer that left the board is published as null coordinates, not as a
      // zero — drawing it at the origin would park a stranger's cursor in the
      // top-left corner of everyone's board forever.
      { userId: 'wren', displayName: 'Wren', cursor: { x: undefined, y: 4 } },
    ];
    expect(visibleCursors(members, 'me').map((member) => member.userId)).toEqual(['maya']);
  });

  it('keeps a pointer at the origin, which is a real position', () => {
    expect(visibleCursors([{ userId: 'maya', displayName: 'Maya', cursor: { x: 0, y: 0 } }], 'me')).toHaveLength(1);
  });
});

describe('presenceColor', () => {
  it('is stable for a user id, so a colour means a person', () => {
    expect(presenceColor('maya')).toBe(presenceColor('maya'));
    expect(presenceColor('maya')).toMatch(/^var\(--canvas-presence-[1-4]\)$/);
  });

  it('spreads ids across the four presence tokens', () => {
    const slots = new Set(['maya', 'reeve', 'cass', 'wren', 'sean', 'ada'].map(presenceColorIndex));
    expect(slots.size).toBeGreaterThan(1);
  });
});

describe('RemoteCursors', () => {
  it('positions in FLOW coordinates and lets the pane transform carry them', () => {
    renderCursors([maya]);
    const cursor = screen.getByText('Maya').parentElement!;
    // 300,180 verbatim: the layer lives inside the viewport, so it must NOT
    // pre-multiply by the zoom — doing that once was the bug that put every
    // cursor in the wrong place the moment anyone panned.
    expect(cursor.style.transform).toContain('translate(300px, 180px)');
  });

  it('counter-scales the label so a name is readable at any zoom', () => {
    renderCursors([maya]);
    // The mocked store is at zoom 2, so the label is drawn at half size.
    expect(screen.getByText('Maya').parentElement!.style.transform).toContain('scale(0.5)');
  });

  it('falls back to a translated name rather than a hardcoded one', () => {
    renderCursors([{ userId: 'ghost', displayName: null, cursor: { x: 1, y: 2 } }]);
    expect(screen.getByText(messages.creationCanvas.collaborator)).toBeInTheDocument();
  });

  it('marks who is typing', () => {
    renderCursors([{ ...maya, typing: true }]);
    expect(screen.getByText(/Maya/)).toHaveTextContent(messages.creationCanvas.cursorTyping);
  });

  it('renders nothing at all when there is nobody else', () => {
    const { container } = renderCursors([]);
    expect(container).toBeEmptyDOMElement();
  });
});

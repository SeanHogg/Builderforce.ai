import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ROOM_PALETTES, type RoomSeat } from '@/lib/canvas/roomSeating';
import { ROOM_ROSTER_STORAGE_KEY } from './roomRosterPreferences';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

const { RoomRoster } = await import('./RoomRoster');

const ada: RoomSeat = {
  userId: 'ada',
  displayName: 'Ada',
  avatarUrl: null,
  kind: 'human',
  index: 0,
  position: [0, 0, 0],
  yaw: 0,
  live: true,
  isSelf: false,
  present: true,
};

function renderRoster() {
  render(
    <RoomRoster
      seats={[ada]}
      palette={ROOM_PALETTES.light}
      stations={[]}
      onOpenStation={vi.fn()}
    />,
  );
}

describe('RoomRoster collapse chevron', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('starts expanded, with a named collapse control', () => {
    renderRoster();
    const toggle = screen.getByRole('button', { name: 'Collapse the people panel' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('1 person')).toBeInTheDocument();
  });

  it('collapses to a re-expand rail and remembers the choice', () => {
    renderRoster();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse the people panel' }));
    const toggle = screen.getByRole('button', { name: 'Expand the people panel' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('[data-collapsed="true"]')).not.toBeNull();
    expect(window.localStorage.getItem(ROOM_ROSTER_STORAGE_KEY)).toBe('collapsed');
  });

  it('restores the full roster from the remaining control', () => {
    window.localStorage.setItem(ROOM_ROSTER_STORAGE_KEY, 'collapsed');
    renderRoster();
    expect(screen.getByRole('button', { name: 'Expand the people panel' })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Expand the people panel' }));
    expect(screen.getByRole('button', { name: 'Collapse the people panel' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(window.localStorage.getItem(ROOM_ROSTER_STORAGE_KEY)).toBe('expanded');
  });

  it('treats anything other than collapsed as expanded', () => {
    window.localStorage.setItem(ROOM_ROSTER_STORAGE_KEY, 'nope');
    renderRoster();
    expect(screen.getByRole('button', { name: 'Collapse the people panel' })).toHaveAttribute('aria-expanded', 'true');
  });
});

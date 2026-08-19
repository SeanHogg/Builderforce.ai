import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));
vi.mock('next/navigation', () => ({ usePathname: () => '/canvas' }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ hasTenant: true }) }));

import type { TeamRosterMember } from '@/lib/kernel/kernelApi';
import { TeamBar } from './TeamBar';

const roster = vi.hoisted(() => ({ members: [] as TeamRosterMember[] }));
vi.mock('@/lib/team/useTeamRoster', () => ({
  useTeamRoster: () => ({ members: roster.members, loading: false }),
}));

const seat = (seatName: string): TeamRosterMember => ({
  kind: 'agent',
  id: `agent-${seatName}`,
  name: `${seatName} agent`,
  role: seatName,
  availability: 'available',
  avatarUrl: null,
  seat: seatName,
  domain: null,
  alwaysOn: true,
  locked: false,
});

/**
 * **The overflow has to be REACHABLE, not merely rendered.**
 *
 * `+6` on the canvas command bar looked dead: the panel was `position:absolute` inside
 * the bar, and the bar is a `z-index:20` floating card, so the panel opened upward into
 * the prompt composer's band (`z-index:21`) and was painted over. A z-index inside a
 * stacking context cannot climb out of it, so "it is in the DOM" was true and useless.
 *
 * The fix is `AnchoredPopover`: the panel is portalled out of the bar entirely. That is
 * what these assert — the seats that did not fit are in the document AND outside the
 * strip that could bury them.
 */
describe('the canvas team strip overflow', () => {
  it('draws five seats and counts the rest', () => {
    roster.members = ['CEO', 'CFO', 'CTO', 'CMO', 'CRO', 'HR', 'Security'].map(seat);
    render(<TeamBar variant="bar" />);

    expect(screen.getByRole('button', { name: /2 more seats/i })).toBeTruthy();
    // The two that did not fit are not drawn until the count is pressed.
    expect(screen.queryByRole('button', { name: /HR agent/i })).toBeNull();
  });

  it('opens the rest OUTSIDE the strip, so no float can paint over them', () => {
    roster.members = ['CEO', 'CFO', 'CTO', 'CMO', 'CRO', 'HR', 'Security'].map(seat);
    const { container } = render(<TeamBar variant="bar" />);

    fireEvent.click(screen.getByRole('button', { name: /2 more seats/i }));

    const hidden = screen.getByRole('button', { name: /HR agent/i });
    expect(hidden).toBeTruthy();
    // THE assertion: portalled to <body>, not nested in the strip the command bar clips
    // and paints over.
    expect(container.contains(hidden)).toBe(false);
    expect(document.body.contains(hidden)).toBe(true);
  });

  it('closes on Escape and on a press outside it', () => {
    roster.members = ['CEO', 'CFO', 'CTO', 'CMO', 'CRO', 'HR', 'Security'].map(seat);
    render(<TeamBar variant="bar" />);
    const more = screen.getByRole('button', { name: /2 more seats/i });

    fireEvent.click(more);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: /HR agent/i })).toBeNull();

    fireEvent.click(more);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('button', { name: /HR agent/i })).toBeNull();
  });

  it('says nothing when every seat fits', () => {
    roster.members = ['CEO', 'CFO'].map(seat);
    render(<TeamBar variant="bar" />);
    expect(screen.queryByRole('button', { name: /more seats/i })).toBeNull();
  });
});

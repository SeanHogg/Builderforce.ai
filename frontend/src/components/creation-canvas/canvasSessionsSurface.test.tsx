import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { adminSubHref } from '@/lib/adminGroups';

/**
 * PRD 33a S4 — Sessions lists this canvas's recordings, and still opens Visitors
 * (the place that already plays them). Empty when the replay API has no rows.
 */

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

vi.mock('@/lib/adminApi', () => ({
  adminApi: {
    replayVisits: vi.fn(),
  },
}));

const { CanvasSessionsSurface } = await import('./CanvasSessionsSurface');
const { renderWithPhase } = await import('./phase/testPhaseProvider');
const { adminApi } = await import('@/lib/adminApi');

function renderSessions(onExit = vi.fn()) {
  renderWithPhase(<CanvasSessionsSurface onExit={onExit} />, { phase: 'measure' });
  return { onExit };
}

beforeEach(() => {
  vi.mocked(adminApi.replayVisits).mockReset();
  vi.mocked(adminApi.replayVisits).mockResolvedValue({ visits: [] });
});

describe('CanvasSessionsSurface', () => {
  it('says there are no recordings yet and opens Visitors through the admin door', async () => {
    renderSessions();
    const surface = screen.getByTestId('canvas-sessions-surface');
    expect(surface).toHaveAttribute('aria-label', 'Session recordings');
    const empty = await waitFor(() => screen.getByTestId('canvas-sessions-empty'));
    expect(empty).toHaveTextContent('No recordings of this canvas yet');
    expect(empty).toHaveTextContent('Once visitors use this canvas, their sessions appear here. Open Visitors to play them back.');
    const link = screen.getByRole('link', { name: 'Open visitor recordings' });
    expect(link).toHaveAttribute('href', adminSubHref('growth', 'visitors'));
  });

  it('lists recorded visits when the replay API has rows', async () => {
    vi.mocked(adminApi.replayVisits).mockResolvedValueOnce({
      visits: [{
        visitId: 'v1',
        siteId: 's1',
        startedAt: '2026-10-11T12:00:00.000Z',
        lastEventAt: '2026-10-11T12:01:30.000Z',
        endedAt: '2026-10-11T12:01:30.000Z',
        durationMs: 90_000,
        activeMs: 80_000,
        entryPath: '/pricing',
        exitPath: '/checkout',
        pageCount: 3,
        clickCount: 12,
        rageCount: 0,
        deadCount: 0,
        errorCount: 0,
        quickbackCount: 0,
        excessiveScrollCount: 0,
        converted: true,
        chunkCount: 2,
      }],
    });
    renderSessions();
    const list = await waitFor(() => screen.getByTestId('canvas-sessions-list'));
    expect(list).toHaveTextContent('/pricing');
    expect(list).toHaveTextContent('1m 30s');
    expect(list).toHaveTextContent('Converted');
    expect(screen.queryByTestId('canvas-sessions-empty')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open visitor recordings' })).toHaveAttribute(
      'href',
      adminSubHref('growth', 'visitors'),
    );
  });

  it('hands the board back on Escape', () => {
    const { onExit } = renderSessions();
    fireEvent.keyDown(screen.getByTestId('canvas-sessions-surface'), { key: 'Escape' });
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

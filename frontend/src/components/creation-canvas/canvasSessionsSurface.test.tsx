import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { adminSubHref } from '@/lib/adminGroups';

/**
 * PRD 33a S3 — Sessions is the canvas's Measure-phase reading of recordings: an
 * empty state that names the gap, and one press that opens Visitors (the place
 * that already plays them). No second player.
 */

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

const { CanvasSessionsSurface } = await import('./CanvasSessionsSurface');
const { renderWithPhase } = await import('./phase/testPhaseProvider');

function renderSessions(onExit = vi.fn()) {
  renderWithPhase(<CanvasSessionsSurface onExit={onExit} />, { phase: 'measure' });
  return { onExit };
}

describe('CanvasSessionsSurface', () => {
  it('says there are no recordings yet and opens Visitors through the admin door', () => {
    renderSessions();
    const surface = screen.getByTestId('canvas-sessions-surface');
    expect(surface).toHaveAttribute('aria-label', 'Session recordings');
    const empty = screen.getByTestId('canvas-sessions-empty');
    expect(empty).toHaveTextContent('No recordings of this canvas yet');
    expect(empty).toHaveTextContent('Once visitors use this canvas, their sessions appear here. Open Visitors to play them back.');
    const link = screen.getByRole('link', { name: 'Open visitor recordings' });
    expect(link).toHaveAttribute('href', adminSubHref('growth', 'visitors'));
  });

  it('hands the board back on Escape', () => {
    const { onExit } = renderSessions();
    fireEvent.keyDown(screen.getByTestId('canvas-sessions-surface'), { key: 'Escape' });
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

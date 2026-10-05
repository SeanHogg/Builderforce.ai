import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import { CanvasSurfaceProvider } from '../canvasSurfaceContext';
import { renderWithPhase } from '../phase/testPhaseProvider';
import { CanvasTopChrome } from './CanvasTopChrome';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

/**
 * WHERE THE PATH CARD STANDS (PRD 32 · W7). The chrome carries it on every surface but
 * the Room, whose scene says the same thing as a sign station — a second copy floated
 * over the scene and covered its toolbar and its list.
 */
function chrome(surface: CanvasSurfaceId, phoneViewport = false) {
  return (
    <CanvasSurfaceProvider value={surface}>
      <CanvasTopChrome
        phoneViewport={phoneViewport}
        topChromeRef={() => {}}
        title="Session"
        surface={surface}
        setSurface={vi.fn()}
        collapsed={false}
        roster={[]}
        share={{ available: false } as never}
        inviteMenu={null}
        boardMenu={null}
        notice=""
      />
    </CanvasSurfaceProvider>
  );
}

const paths = () => screen.queryAllByTestId('canvas-phase-path');

describe('CanvasTopChrome — the path card', () => {
  it('stands under the phase card on the board in an unready phase', () => {
    renderWithPhase(chrome('graph'), { phase: 'measure', signals: {} });
    expect(paths()).toHaveLength(1);
  });

  it('stands down on the Room, where the scene carries it', () => {
    renderWithPhase(chrome('room'), { phase: 'measure', signals: {} });
    expect(paths()).toHaveLength(0);
  });

  it('stands down on the Room on a phone too', () => {
    renderWithPhase(chrome('room', true), { phase: 'measure', signals: {} });
    expect(paths()).toHaveLength(0);
  });
});

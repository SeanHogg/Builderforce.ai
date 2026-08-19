import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { websiteBeforeFrom, websiteBeforePatch } from '@builderforce/creation-canvas-contract';
import type { CreationNodeData } from './types';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

const capture = vi.fn();
vi.mock('@/lib/canvasImageAssets', () => ({ captureCanvasScreenshot: (...args: unknown[]) => capture(...args) }));

const { CanvasSiteSurface } = await import('./CanvasSiteSurface');

const PIXELS = 'data:image/jpeg;base64,AAAA';

const SITE = {
  kind: 'website',
  title: 'AI CoachBuild Redesign',
  pages: [{
    id: 'home',
    name: 'Home',
    path: '/',
    sections: [{ id: 'hero', kind: 'hero', heading: 'Tailored AI', body: 'For coaches', cta: 'Start' }],
  }],
} as unknown as CreationNodeData;

const WITH_BEFORE = {
  ...SITE,
  ...websiteBeforePatch({
    url: 'https://aicoachbuild.com/',
    imageUrl: PIXELS,
    capturedAt: '2026-08-19T09:00:00.000Z',
    viewport: 'desktop',
  }),
} as unknown as CreationNodeData;

describe('the before-capture contract', () => {
  it('reads a complete capture and defaults its width to the shared device vocabulary', () => {
    const before = websiteBeforeFrom(WITH_BEFORE as unknown as Record<string, unknown>);
    expect(before).toMatchObject({ url: 'https://aicoachbuild.com/', imageUrl: PIXELS, viewport: 'desktop', width: 1280 });
  });

  it('reads a half-authored capture as NO comparison rather than a broken image', () => {
    // A model patch that names a URL but no pixels must not render an empty pane beside
    // a finished design and call it a before.
    expect(websiteBeforeFrom({ beforeUrl: 'https://example.com' })).toBeNull();
    expect(websiteBeforeFrom({ beforeImageUrl: PIXELS })).toBeNull();
    expect(websiteBeforeFrom({})).toBeNull();
  });
});

describe('the site surface comparison', () => {
  it('draws the capture and the new design side by side, dated and attributed', async () => {
    render(<CanvasSiteSurface data={WITH_BEFORE} onExit={() => {}} onEdit={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));

    const shot = screen.getByRole('img', { name: /aicoachbuild\.com/i }) as HTMLImageElement;
    expect(shot.src).toBe(PIXELS);
    // The address is a real link, so the reader can go and check the claim.
    expect(screen.getByRole('link', { name: 'https://aicoachbuild.com/' })).toBeTruthy();
    // Scoped to the panes: "Before" also names the toolbar's capture field, and a
    // comparison that only labelled one half would be the ambiguity this pairing fixes.
    expect(document.querySelector('[data-side="before"] figcaption strong')).toHaveTextContent('Before');
    expect(document.querySelector('[data-side="after"] figcaption strong')).toHaveTextContent('After');
    // The "after" is the SAME framed document the preview shows — a comparison against an
    // approximation of the new design would be a comparison against nothing.
    expect(document.querySelector('iframe')).not.toBeNull();
  });

  it('offers no comparison reading to a viewer who can neither capture nor read one', () => {
    // No capture and no write access: a button that can only explain its own emptiness.
    render(<CanvasSiteSurface data={SITE} onExit={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Compare' })).toBeNull();
  });

  it('captures the before an author types, through the same patch the agent writes', async () => {
    capture.mockResolvedValue({
      url: PIXELS, thumbnailUrl: PIXELS, source: 'capture', provider: 'cloudflare-browser-rendering',
      width: 1280, height: 800, capturedUrl: 'https://aicoachbuild.com/', capturedAt: '2026-08-19T09:00:00.000Z',
      capturedViewport: 'desktop',
    });
    const onEdit = vi.fn();
    render(<CanvasSiteSurface data={SITE} onExit={() => {}} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    fireEvent.change(screen.getByLabelText('Before'), { target: { value: 'https://aicoachbuild.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }));

    await waitFor(() => expect(onEdit).toHaveBeenCalled());
    expect(onEdit.mock.calls[0]![0]).toMatchObject({
      beforeUrl: 'https://aicoachbuild.com/',
      beforeImageUrl: PIXELS,
      beforeViewport: 'desktop',
      beforeWidth: 1280,
    });
  });

  it('relays the renderer\'s real reason when a capture fails', async () => {
    capture.mockRejectedValue(new Error('Navigation timeout of 30000 ms exceeded'));
    render(<CanvasSiteSurface data={SITE} onExit={() => {}} onEdit={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    fireEvent.change(screen.getByLabelText('Before'), { target: { value: 'https://slow.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }));

    // Not "capture failed" — the whole capability exists so the person is told WHY.
    expect(await screen.findByRole('alert')).toHaveTextContent('Navigation timeout of 30000 ms exceeded');
  });
});

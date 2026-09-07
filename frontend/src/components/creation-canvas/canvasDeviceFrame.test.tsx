import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

// The copy IS part of the assertion, as it is for every other canvas surface test: a
// button labelled "creationCanvas.surface.site.reading.preview" tells nobody what it does.
vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

import { CANVAS_VIEWPORT_WIDTHS } from '@builderforce/creation-canvas-contract';
import { canvasWebsiteDocument, CANVAS_WEBSITE_FRAME_SANDBOX } from '@/lib/canvasWebsite';
import { CanvasAppSurface } from './CanvasAppSurface';
import { CanvasSiteSurface } from './CanvasSiteSurface';
import { CanvasSurfaceActionsProvider, useContributedSurfaceActions } from './canvasSurfaceActions';
import { WebsiteFrame } from './WebsiteCanvas';
import type { CreationNodeData } from './types';

/**
 * The three defects a canvas preview had, asserted where each one lived.
 *
 *  1. Desktop / Tablet / Phone changed nothing you could see, because the frame was CAPPED
 *     to the stage (`min(100%,…)`) and then told to `flex:1` anyway.
 *  2. The site rendered as React inside the board, so the app's tokens and the operator's
 *     dark-mode toggle styled the artifact.
 *  3. What rendered was an approximation of the page, not the page.
 *
 * All three are one root cause — a second renderer, sized by the stylesheet — so they are
 * one fix (`CanvasDeviceFrame` + `canvasWebsiteDocument`) and these are its guards.
 */

/** The frame, wherever it is: the ONE element carrying a device width. */
const framed = (root: HTMLElement): HTMLIFrameElement =>
  root.querySelector<HTMLIFrameElement>('iframe')!;

const SITE: CreationNodeData = {
  kind: 'website',
  title: 'GreenEdge Yard Care',
  pages: [{
    id: 'home',
    name: 'Home',
    sections: [
      { id: 's1', kind: 'hero', heading: 'Lawns that stay green', body: 'Weekly care, one price.', cta: 'Book a visit' },
      {
        id: 's2',
        kind: 'features',
        heading: 'What you get',
        items: [
          { title: 'Mowing', body: 'Every week, rain or shine.' },
          { title: 'Feeding', body: 'Seasonal treatment plan.' },
        ],
      },
    ],
  }, {
    id: 'pricing',
    name: 'Pricing',
    sections: [{ id: 's3', kind: 'cta', heading: 'From $40 a visit', cta: 'Start' }],
  }],
} as unknown as CreationNodeData;

describe('a site preview is the site, not a drawing of it', () => {
  /**
   * The `features` grid is the tell. The board's own renderer drew a heading and one line
   * of prose for it; the document the publisher serves lays out the items themselves — so
   * a preview holding the item text is a preview of the real page.
   */
  it('renders every section the published document renders', () => {
    const document = canvasWebsiteDocument(SITE)!;
    expect(document).toContain('Lawns that stay green');
    expect(document).toContain('Seasonal treatment plan.');
    expect(document).toContain('<ul class="features">');
    // Both pages travel, so switching inside the frame has somewhere to go.
    expect(document).toContain('From $40 a visit');
  });

  /**
   * The leak this closes: the app's own light/dark. A published page answers
   * `prefers-color-scheme` because it is served to strangers; a PREVIEW that did would be
   * repainted by the reader's OS — and, rendered as React the way it used to be, by the
   * canvas's own theme toggle. So a preview pins the mode and emits ONE palette.
   */
  it('pins its own light or dark, so nothing outside the frame can repaint it', () => {
    const light = canvasWebsiteDocument(SITE)!;
    expect(light).not.toContain('prefers-color-scheme');
    expect(light).toContain('color-scheme:light');

    const dark = canvasWebsiteDocument(SITE, { colorScheme: 'dark' })!;
    expect(dark).not.toContain('prefers-color-scheme');
    expect(dark).toContain('color-scheme:dark');
    expect(dark).not.toBe(light);

    // The published site keeps answering the visitor's device — that is not a preview.
    expect(canvasWebsiteDocument(SITE, { colorScheme: 'auto' })!).toContain('prefers-color-scheme');
  });

  /** Same rule as every other framed document on this canvas: with `allow-scripts`, an
   *  `allow-same-origin` would let the frame reach this page's session and drop its own
   *  sandbox — the two together are equivalent to no sandbox at all. */
  it('never gives the frame an origin', () => {
    expect(CANVAS_WEBSITE_FRAME_SANDBOX).toContain('allow-scripts');
    expect(CANVAS_WEBSITE_FRAME_SANDBOX).not.toContain('allow-same-origin');
  });

  /** An object the author has only named holds no page. Framing that would replace a
   *  legible "here is your headline" with a blank white rectangle. */
  it('says nothing rather than framing an empty shell', () => {
    expect(canvasWebsiteDocument({ kind: 'website', title: 'Unstarted' })).toBeNull();
  });

  it('frames the document on the card, and falls back to the editor when there is none', () => {
    const { container, rerender } = render(
      <WebsiteFrame data={SITE} viewport="desktop" colorScheme="light" />,
    );
    const frame = framed(container);
    expect(frame).toHaveAttribute('sandbox', CANVAS_WEBSITE_FRAME_SANDBOX);
    expect(frame.getAttribute('srcdoc')).toContain('Seasonal treatment plan.');

    rerender(<WebsiteFrame
      data={{ kind: 'website', title: 'Unstarted', websiteHeadline: 'Coming soon' } as CreationNodeData}
      viewport="desktop"
      colorScheme="light"
    />);
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
  });
});

describe('the width a preview is checked at', () => {
  /**
   * THE regression. `Desktop`, `Tablet` and `Phone` must lay the document out at three
   * different real widths — not cap one frame three ways, which is what let the page's own
   * media queries fire for the stage instead of for the device and made all three
   * readings look identical.
   */
  it('lays the document out at the real device width, and changes it with the switcher', () => {
    const { container, rerender } = render(
      <WebsiteFrame data={SITE} viewport="desktop" colorScheme="light" />,
    );
    expect(framed(container).style.width).toBe(`${CANVAS_VIEWPORT_WIDTHS.desktop}px`);

    rerender(<WebsiteFrame data={SITE} viewport="tablet" colorScheme="light" />);
    expect(framed(container).style.width).toBe(`${CANVAS_VIEWPORT_WIDTHS.tablet}px`);

    rerender(<WebsiteFrame data={SITE} viewport="mobile" colorScheme="light" />);
    expect(framed(container).style.width).toBe(`${CANVAS_VIEWPORT_WIDTHS.mobile}px`);
  });

  /** The app runtime publishes its width switcher into the session bar, so the test needs
   *  the bar — see `canvasAppSurface.test.tsx`, which stands one up the same way. */
  function AppHost({ nodes }: { nodes: ReadonlyArray<{ id: string; data: CreationNodeData }> }) {
    return <CanvasSurfaceActionsProvider><AppBar /><CanvasAppSurface nodes={nodes} onExit={() => undefined} /></CanvasSurfaceActionsProvider>;
  }
  function AppBar() {
    const { controls } = useContributedSurfaceActions();
    return <div data-testid="session-bar">{controls}</div>;
  }

  it('moves the app runtime between the same three widths', () => {
    const page = { id: 'n1', data: {
      kind: 'code', title: 'index.html', path: 'index.html',
      content: '<!doctype html><html><body><h1>Hi</h1></body></html>',
    } as unknown as CreationNodeData };
    const { container } = render(<AppHost nodes={[page]} />);
    const bar = screen.getByTestId('session-bar');

    fireEvent.click(within(bar).getByRole('button', { name: 'Run' }));
    expect(framed(container).style.width).toBe(`${CANVAS_VIEWPORT_WIDTHS.desktop}px`);

    fireEvent.click(within(bar).getByRole('button', { name: 'Phone' }));
    expect(framed(container).style.width).toBe(`${CANVAS_VIEWPORT_WIDTHS.mobile}px`);

    fireEvent.click(within(bar).getByRole('button', { name: 'Tablet' }));
    expect(framed(container).style.width).toBe(`${CANVAS_VIEWPORT_WIDTHS.tablet}px`);
  });
});

describe('the site surface reads a site two ways', () => {
  it('previews the real document, and edits the markup the board can reach', () => {
    const onEdit = vi.fn();
    render(<CanvasSiteSurface data={SITE} onExit={() => undefined} onEdit={onEdit} />);
    const surface = screen.getByTestId('canvas-site-surface');

    // Preview first: what the author wants to see is what a visitor gets.
    expect(within(surface).getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-pressed', 'true');
    expect(framed(surface).getAttribute('srcdoc')).toContain('Seasonal treatment plan.');
    // Structural chrome has nowhere to sit over a framed page, so it stands down entirely
    // rather than being drawn over a layout the frame owns.
    expect(within(surface).queryByRole('button', { name: 'Move up' })).toBeNull();

    fireEvent.click(within(surface).getByRole('button', { name: 'Edit' }));
    expect(surface.querySelector('iframe')).toBeNull();
    expect(within(surface).getAllByRole('button', { name: 'Move up' }).length).toBeGreaterThan(0);
    expect(within(surface).getByText('Lawns that stay green')).toBeInTheDocument();
  });

  /** The site's own mode, asked in the site's own controls — never the board's theme. */
  it('lets the author check the site in dark without touching the canvas theme', () => {
    render(<CanvasSiteSurface data={SITE} onExit={() => undefined} />);
    const surface = screen.getByTestId('canvas-site-surface');

    expect(framed(surface).getAttribute('srcdoc')).toContain('color-scheme:light');
    fireEvent.click(within(surface).getByRole('button', { name: 'Dark' }));
    expect(framed(surface).getAttribute('srcdoc')).toContain('color-scheme:dark');
    // Pinned in both directions: a preview must never answer the reader's own device.
    expect(framed(surface).getAttribute('srcdoc')).not.toContain('prefers-color-scheme');
  });

  /** Looking is not authoring — the object's own viewport survives a glance at a phone. */
  it('changes the width the reader checks without re-authoring the object', () => {
    const onEdit = vi.fn();
    render(<CanvasSiteSurface data={SITE} onExit={() => undefined} onEdit={onEdit} />);
    const surface = screen.getByTestId('canvas-site-surface');

    expect(framed(surface).style.width).toBe(`${CANVAS_VIEWPORT_WIDTHS.desktop}px`);
    fireEvent.click(within(surface).getByRole('button', { name: 'Phone' }));
    expect(framed(surface).style.width).toBe(`${CANVAS_VIEWPORT_WIDTHS.mobile}px`);
    expect(onEdit).not.toHaveBeenCalled();
  });
});

describe('a page switched inside the frame reaches the board', () => {
  /**
   * The nav the reader clicks lives INSIDE the frame. Without the document reporting the
   * switch, the card and the full-size surface would disagree about which page is open —
   * the one thing a person changes surfaces to check.
   */
  it('carries the reporting script only when the board can write', () => {
    expect(canvasWebsiteDocument(SITE, { reportPageChanges: true })!)
      .toContain('builderforce:canvas-website-page');
    expect(canvasWebsiteDocument(SITE)!).not.toContain('builderforce:canvas-website-page');
  });

  /** Several website cards listen on the same window. A message from another frame is not
   *  this card's page switch, and acting on it would move a page the reader never touched. */
  it("writes back its own frame's page switch and ignores every other frame's", () => {
    const onEdit = vi.fn();
    const { container } = render(
      <WebsiteFrame data={SITE} viewport="desktop" colorScheme="light" onEdit={onEdit} />,
    );
    const switched = (source: MessageEventSource | null) => fireEvent(window, new MessageEvent('message', {
      data: { tag: 'builderforce:canvas-website-page', pageId: 'pricing' },
      source,
    }));

    // Another card's frame — or the host page itself — is not this preview talking.
    switched(window);
    expect(onEdit).not.toHaveBeenCalled();

    switched(framed(container).contentWindow);
    expect(onEdit).toHaveBeenCalledWith({ activeWebsitePageId: 'pricing' });
  });
});

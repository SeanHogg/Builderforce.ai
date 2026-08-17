import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

// The copy IS part of the assertion, exactly as it is for the surface switcher: a Run
// button labelled "creationCanvas.surface.app.run" tells nobody what it does.
vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

import {
  CANVAS_APP_FRAME_SANDBOX,
  CANVAS_APP_MESSAGE,
  canvasApp,
  canvasAppEntry,
  canvasAppFiles,
} from '@/lib/canvasApp';
import type { CreationNodeData } from './types';
import { CanvasAppSurface } from './CanvasAppSurface';
import { CanvasSurfaceActionsProvider, useContributedSurfaceActions } from './canvasSurfaceActions';
import { canvasChromeShows } from '@/lib/canvasChrome';

/**
 * The surface's controls are PUBLISHED into the session bar, not drawn by the surface —
 * so a test that renders it bare would see a body with no Run button and conclude the
 * feature was gone. This host stands in for the bar: it renders the contribution exactly
 * where `CanvasSessionActions` does.
 */
function WithBar({ children, collapsed = false }: { children: React.ReactNode; collapsed?: boolean }) {
  return <CanvasSurfaceActionsProvider><Bar collapsed={collapsed} />{children}</CanvasSurfaceActionsProvider>;
}
/** Stands in for `CanvasSessionActions`, applying the same chrome rule it does. */
function Bar({ collapsed }: { collapsed: boolean }) {
  const { controls, status } = useContributedSurfaceActions();
  return <div data-testid="session-bar">
    {canvasChromeShows('surfaceStatus', collapsed) && status}
    {canvasChromeShows('surfaceControls', collapsed) && controls}
  </div>;
}

/**
 * The first canvas derivation that reads MANY objects as one artifact.
 *
 * These assert the three things the surface exists to be honest about: that loose code
 * cards compose into one runnable app, that what a browser CANNOT run is separated out
 * and named rather than silently failing, and that the frame never gets an origin.
 */

const card = (id: string, path: string, code: string, language = ''): { id: string; data: CreationNodeData } =>
  ({ id, data: { kind: 'code', title: path, path, code, language } as CreationNodeData });

const SESSION = [
  card('n1', 'backend/server.js', "const express = require('express');\napp.listen(3000);"),
  card('n2', 'frontend/index.html', '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><h1>Send an SMS</h1><script src="app.js"></script></body></html>'),
  card('n3', 'frontend/styles.css', 'body { font-family: system-ui; }'),
  card('n4', 'frontend/app.js', "document.querySelector('h1').dataset.ready = '1';"),
];

describe('the app a canvas session is', () => {
  it('composes loose code cards into one file list, keeping the card each came from', () => {
    const files = canvasAppFiles(SESSION);
    expect(files.map((file) => file.path)).toEqual([
      'backend/server.js', 'frontend/index.html', 'frontend/styles.css', 'frontend/app.js',
    ]);
    // The card is not lost in the projection — "open the card" needs it back.
    expect(files.find((file) => file.path === 'frontend/app.js')?.nodeId).toBe('n4');
  });

  /**
   * The bug this closes: Brain authors a code card's source into `content` — the field
   * `canvas_add_object` actually receives and the field `CreationNode`'s own card preview
   * reads first — not the rarer `code` field this projection used to read exclusively.
   * A GreenEdge Yard Care session (2026-08-16) had six `code` cards written this way and
   * the `app` surface reported "nothing to run" despite all six being on the board.
   */
  it('reads a code card\'s source from `content`, the field Brain actually authors', () => {
    const authoredByBrain = { id: 'n8', data: {
      kind: 'code', title: 'backend/server.js', content: "require('express');\napp.listen(3000);",
    } as unknown as CreationNodeData };
    const files = canvasAppFiles([authoredByBrain]);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: 'backend/server.js', role: 'server', nodeId: 'n8' });
  });

  /**
   * The bug this closes: a `website` card with a form and the `code` card its form
   * posts to are one application, not a static preview beside an orphan file.
   */
  it('projects a website object\'s pages into the file list, so it composes with a code backend', () => {
    const website = { id: 'n5', data: {
      kind: 'website', title: 'GreenEdge Yard Care',
      pages: [{
        id: 'quote', name: 'Quote', path: '/quote', sections: [
          { id: 'hero', kind: 'hero', heading: 'GreenEdge Yard Care', body: 'Proof of concept', cta: 'Get a quote' },
          { id: 'form', kind: 'content', heading: 'Request a quote', body: '<form action="/api/quote"><input name="email"></form>' },
        ],
      }],
    } as unknown as CreationNodeData };
    const backend = card('n6', 'twilio-handler.js', "const twilio = require('twilio');\napp.listen(3000);");
    const files = canvasAppFiles([website, backend]);

    const site = files.find((file) => file.nodeId === 'n5');
    expect(site?.role).toBe('page');
    // The form is sandboxed, not printed as escaped text on the page (same fix as the
    // `site` surface) — its markup shows up entity-encoded inside the iframe's `srcdoc`.
    expect(site?.source).toContain('sandbox="allow-scripts allow-forms"');
    expect(site?.source).toContain('&lt;form action=&quot;/api/quote&quot;&gt;');
    // The board's own card is still reachable from the projected file.
    expect(site?.nodeId).toBe('n5');
    // With no code `index.html` on the board, the site is the entry the app opens on.
    expect(canvasAppEntry(files)?.nodeId).toBe('n5');
    expect(canvasApp([website, backend]).server.map((file) => file.nodeId)).toEqual(['n6']);
  });

  it('does not project a plain document — it has no runnable shape', () => {
    const doc = { id: 'n7', data: { kind: 'document', title: 'Notes', content: 'Some prose.' } as unknown as CreationNodeData };
    expect(canvasAppFiles([doc])).toEqual([]);
  });

  /**
   * The distinction the whole surface rests on. A browser frame cannot run a Node
   * server, and a preview that pretended otherwise would let somebody conclude their
   * Twilio credentials were wrong when the truth is there is no host attached.
   */
  it('tells a server apart from a script the page loads, by what the source needs', () => {
    const files = canvasAppFiles(SESSION);
    expect(files.find((file) => file.path === 'backend/server.js')?.role).toBe('server');
    expect(files.find((file) => file.path === 'frontend/app.js')?.role).toBe('script');
    expect(files.find((file) => file.path === 'frontend/styles.css')?.role).toBe('style');
    expect(files.find((file) => file.path === 'frontend/index.html')?.role).toBe('page');
    expect(canvasApp(SESSION).server.map((file) => file.path)).toEqual(['backend/server.js']);
  });

  it('opens on index.html when there is one, and on the only page when there is not', () => {
    expect(canvasAppEntry(canvasAppFiles(SESSION))?.path).toBe('frontend/index.html');
    const single = canvasAppFiles([card('n1', 'pages/about.html', '<h1>About</h1>')]);
    expect(canvasAppEntry(single)?.path).toBe('pages/about.html');
    expect(canvasAppEntry(canvasAppFiles([card('n1', 'server.js', "require('http')")]))).toBeNull();
  });

  /**
   * A `srcDoc` has no origin to resolve `href="styles.css"` against, so a relative
   * reference 404s — which is how a preview shows a correct page with none of its
   * styling and no explanation. Inlining is what makes the preview the real page.
   */
  it('inlines the entry page\'s own stylesheets and scripts', () => {
    const document = canvasApp(SESSION).document ?? '';
    expect(document).toContain('body { font-family: system-ui; }');
    expect(document).toContain("document.querySelector('h1').dataset.ready");
    expect(document).not.toContain('href="styles.css"');
    expect(document).not.toContain('src="app.js"');
  });

  it('instruments the document before any authored code runs', () => {
    const document = canvasApp(SESSION).document ?? '';
    expect(document).toContain(CANVAS_APP_MESSAGE);
    // Ahead of the page's own script, or a throw during boot goes unreported.
    expect(document.indexOf(CANVAS_APP_MESSAGE)).toBeLessThan(document.indexOf('dataset.ready'));
  });

  /** An inlined source containing `</script>` would otherwise close the element it is
   *  being written into, and the rest of the file would render as text on the page. */
  it('cannot be broken out of by a script tag inside an inlined source', () => {
    const nasty = [
      card('n1', 'index.html', '<html><body><script src="x.js"></script></body></html>'),
      card('n2', 'x.js', 'const s = "</script><h1>escaped</h1>";'),
    ];
    const document = canvasApp(nasty).document ?? '';
    expect(document).toContain('<\\/script>');
    expect(document).not.toContain('"</script><h1>escaped</h1>"');
  });

  /** The same load-bearing rule the game frame follows: `allow-scripts` together with
   *  `allow-same-origin` lets a frame drop its own sandbox entirely. */
  it('never advertises same-origin in the frame contract', () => {
    expect(CANVAS_APP_FRAME_SANDBOX).toContain('allow-scripts');
    expect(CANVAS_APP_FRAME_SANDBOX).not.toContain('allow-same-origin');
  });

  it('wraps a bare fragment so a card holding only markup still renders', () => {
    const document = canvasApp([card('n1', 'form.html', '<form><input name="to"></form>')]).document ?? '';
    expect(document).toMatch(/^<!doctype html>/i);
    expect(document).toContain('<form>');
  });
});

describe('a game in the app modality', () => {
  const html = '<!doctype html><html><head><title>Runner</title></head><body><canvas></canvas></body></html>';
  const place = `<roblox version="4"><Item class="ServerScriptService" referent="RBX0">
<Properties><string name="Name">ServerScriptService</string></Properties>
<Item class="Script" referent="RBX1"><Properties>
<string name="Name">GameServer</string>
<ProtectedString name="Source"><![CDATA[print("rules")]]></ProtectedString>
</Properties></Item></Item></roblox>`;

  const gameNode = (id: string, title: string, mime: string, body: string) => ({
    id,
    data: { kind: 'game', title, outputUrl: `data:${mime};charset=utf-8,${encodeURIComponent(body)}` } as CreationNodeData,
  });

  it('runs a web game as the app, because a web game IS an HTML document', () => {
    // Left out, a board whose only object was a game reported "nothing to run"
    // while holding a complete, runnable page.
    const app = canvasApp([gameNode('g1', 'Star Run', 'text/html', html)]);
    expect(app.entry?.path).toBe('star-run.html');
    expect(app.document).toContain('<canvas>');
  });

  it('offers a Roblox place as SOURCE, since its rules are the part you edit', () => {
    const files = canvasAppFiles([gameNode('g2', 'Skybound Citadels', 'application/xml', place)]);
    expect(files.map((file) => file.path)).toEqual(['skybound-citadels/GameServer.luau']);
    expect(files[0]!.source).toBe('print("rules")');
  });

  it('never makes a place the thing the preview tries to run', () => {
    // Luau is not a page. Claiming it as one would put a `.luau` file in a frame.
    const app = canvasApp([gameNode('g3', 'Skybound Citadels', 'application/xml', place)]);
    expect(app.files).toHaveLength(1);
    expect(app.entry).toBeNull();
    expect(app.document).toBeNull();
  });
});

describe('the app surface', () => {
  /**
   * THE ONE THAT KEEPS THE CANVAS AT ONE BAR. These controls used to be a second toolbar
   * drawn by this surface, 40px under the session bar and looking just like it. They are
   * now published into the bar, and this asserts they arrive THERE rather than here —
   * which is what a regression would silently undo.
   */
  it('puts its controls in the session bar rather than a toolbar of its own', () => {
    render(<WithBar><CanvasAppSurface nodes={SESSION} onExit={vi.fn()} /></WithBar>);
    const bar = screen.getByTestId('session-bar');
    expect(within(bar).getByRole('button', { name: 'Run' })).toBeInTheDocument();
    expect(within(bar).getByRole('group', { name: 'Preview width' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Preview' })).toBeInTheDocument();
    // The surface itself draws no bar — one press, one place.
    expect(within(screen.getByTestId('canvas-app-surface')).queryByRole('button', { name: 'Run' })).toBeNull();
  });

  /**
   * The rule the operator settled, applied to a runtime: fold the bar and the Run button
   * goes, but the app must keep saying it is running. A collapse that silenced that would
   * leave somebody looking at a canvas with a live preview and nothing on screen saying so.
   */
  it('keeps saying it is running after the bar is folded, without the button', () => {
    const { rerender } = render(<WithBar><CanvasAppSurface nodes={SESSION} onExit={vi.fn()} /></WithBar>);
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    const bar = () => screen.getByTestId('session-bar');
    expect(within(bar()).getByRole('status')).toHaveTextContent('frontend/index.html');

    rerender(<WithBar collapsed><CanvasAppSurface nodes={SESSION} onExit={vi.fn()} /></WithBar>);
    expect(within(bar()).queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(within(bar()).getByRole('status')).toHaveTextContent('frontend/index.html');
  });

  /** Withdrawn on unmount: a Run button left in the bar would be wired to a runtime
   *  that no longer exists, which is the one failure a shared bar has and two do not. */
  it('takes its controls back out of the bar when it closes', () => {
    const { rerender } = render(<WithBar><CanvasAppSurface nodes={SESSION} onExit={vi.fn()} /></WithBar>);
    expect(within(screen.getByTestId('session-bar')).getByRole('button', { name: 'Run' })).toBeInTheDocument();
    rerender(<WithBar><p>the board</p></WithBar>);
    expect(within(screen.getByTestId('session-bar')).queryByRole('button', { name: 'Run' })).toBeNull();
  });

  it('says so plainly when the board holds nothing to run', () => {
    render(<WithBar><CanvasAppSurface nodes={[]} onExit={vi.fn()} /></WithBar>);
    expect(screen.getByText('Nothing to run yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  it('does not run until asked, then mounts the app in a sandboxed frame', () => {
    render(<WithBar><CanvasAppSurface nodes={SESSION} onExit={vi.fn()} /></WithBar>);
    expect(screen.getByText('Ready to run')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    const frame = screen.getByTitle('frontend/index.html, running');
    expect(frame).toHaveAttribute('sandbox', CANVAS_APP_FRAME_SANDBOX);
    expect(frame.getAttribute('srcdoc')).toContain('Send an SMS');
    // The control is the same one, and it now says what pressing it does.
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });

  it('lists every file under Code and marks the ones that need a host', () => {
    render(<WithBar><CanvasAppSurface nodes={SESSION} onExit={vi.fn()} /></WithBar>);
    fireEvent.click(screen.getByRole('button', { name: 'Code' }));

    const tree = screen.getByRole('navigation', { name: 'Files in this app' });
    expect(within(tree).getByRole('button', { name: /backend\/server\.js/ })).toBeInTheDocument();
    expect(within(tree).getByText('Server')).toBeInTheDocument();
  });

  it('sends the reader back to the card a file came from', () => {
    const onOpenObject = vi.fn();
    render(<WithBar><CanvasAppSurface nodes={SESSION} onExit={vi.fn()} onOpenObject={onOpenObject} /></WithBar>);
    fireEvent.click(screen.getByRole('button', { name: 'Code' }));
    fireEvent.click(screen.getByRole('button', { name: /frontend\/app\.js/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Open the card' }));
    expect(onOpenObject).toHaveBeenCalledWith('n4');
  });

  /** THE ONE THIS SURFACE EXISTS FOR. The preview runs the front end and cannot run the
   *  server; saying which file that is, before the user watches a fetch fail, is the
   *  difference between an honest preview and a misleading one. */
  it('names the files it cannot run rather than letting them fail silently', () => {
    render(<WithBar><CanvasAppSurface nodes={SESSION} onExit={vi.fn()} /></WithBar>);
    fireEvent.click(screen.getByRole('button', { name: 'Console' }));
    expect(screen.getByRole('note')).toHaveTextContent('backend/server.js');
    expect(screen.getByRole('note')).toHaveTextContent(/needs a host/i);
  });

  /** Publishing is the session bar's `publish` action, scoped to the whole board. A
   *  second Publish here would be one decision with two controls — the thing the
   *  surface registry exists to prevent. */
  it('draws no publish control of its own', () => {
    render(<WithBar><CanvasAppSurface nodes={SESSION} onExit={vi.fn()} /></WithBar>);
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
  });

  it('hands the board back on Escape, the way every other surface does', () => {
    const onExit = vi.fn();
    render(<WithBar><CanvasAppSurface nodes={SESSION} onExit={onExit} /></WithBar>);
    fireEvent.keyDown(screen.getByTestId('canvas-app-surface'), { key: 'Escape' });
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

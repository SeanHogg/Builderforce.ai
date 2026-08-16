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

describe('the app surface', () => {
  it('says so plainly when the board holds nothing to run', () => {
    render(<CanvasAppSurface nodes={[]} onExit={vi.fn()} />);
    expect(screen.getByText('Nothing to run yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  it('does not run until asked, then mounts the app in a sandboxed frame', () => {
    render(<CanvasAppSurface nodes={SESSION} onExit={vi.fn()} />);
    expect(screen.getByText('Ready to run')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    const frame = screen.getByTitle('frontend/index.html, running');
    expect(frame).toHaveAttribute('sandbox', CANVAS_APP_FRAME_SANDBOX);
    expect(frame.getAttribute('srcdoc')).toContain('Send an SMS');
    // The control is the same one, and it now says what pressing it does.
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });

  it('lists every file under Code and marks the ones that need a host', () => {
    render(<CanvasAppSurface nodes={SESSION} onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Code' }));

    const tree = screen.getByRole('navigation', { name: 'Files in this app' });
    expect(within(tree).getByRole('button', { name: /backend\/server\.js/ })).toBeInTheDocument();
    expect(within(tree).getByText('Server')).toBeInTheDocument();
  });

  it('sends the reader back to the card a file came from', () => {
    const onOpenObject = vi.fn();
    render(<CanvasAppSurface nodes={SESSION} onExit={vi.fn()} onOpenObject={onOpenObject} />);
    fireEvent.click(screen.getByRole('button', { name: 'Code' }));
    fireEvent.click(screen.getByRole('button', { name: /frontend\/app\.js/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Open the card' }));
    expect(onOpenObject).toHaveBeenCalledWith('n4');
  });

  /** THE ONE THIS SURFACE EXISTS FOR. The preview runs the front end and cannot run the
   *  server; saying which file that is, before the user watches a fetch fail, is the
   *  difference between an honest preview and a misleading one. */
  it('names the files it cannot run rather than letting them fail silently', () => {
    render(<CanvasAppSurface nodes={SESSION} onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Console' }));
    expect(screen.getByRole('note')).toHaveTextContent('backend/server.js');
    expect(screen.getByRole('note')).toHaveTextContent(/needs a host/i);
  });

  it('offers publishing as a door onto the release lifecycle, not a second one', () => {
    const onPublish = vi.fn();
    const { rerender } = render(<CanvasAppSurface nodes={SESSION} onExit={vi.fn()} onPublish={onPublish} />);
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(onPublish).toHaveBeenCalledTimes(1);

    // A session that cannot publish stands the control down rather than drawing it dead.
    rerender(<CanvasAppSurface nodes={SESSION} onExit={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
  });

  it('hands the board back on Escape, the way every other surface does', () => {
    const onExit = vi.fn();
    render(<CanvasAppSurface nodes={SESSION} onExit={onExit} />);
    fireEvent.keyDown(screen.getByTestId('canvas-app-surface'), { key: 'Escape' });
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

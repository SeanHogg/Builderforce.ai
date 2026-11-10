import { createElement, isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('./vscodeBridge', () => bridge);

import { BOOT_STRINGS_ELEMENT_ID } from '../../src/webviewBundleShell';
import { DEFAULT_ROOT_FALLBACK_STRINGS, RootBoundary, RootFallback, errorDetails, readBootStrings } from './RootBoundary';

/**
 * The webview has no DOM renderer here (vitest `environment: 'node'`), and React's
 * server renderer does not run error boundaries. So the boundary is driven through its
 * own lifecycle — exactly what React calls when a child throws: `getDerivedStateFromError`
 * for the fallback state, then `componentDidCatch` with the component stack — and what
 * it renders is rendered to markup.
 */

const GERMAN = { title: 'BuilderForce ist auf einen Fehler gestoßen', body: 'Dieses Panel wird nicht mehr dargestellt.', reload: 'Panel neu laden', copy: 'Details kopieren' };

function fakeDocument(json: string | null) {
  return { getElementById: (id: string) => (id === BOOT_STRINGS_ELEMENT_ID && json !== null ? { textContent: json } : null) } as unknown as Document;
}

/** A boundary whose child just threw `error`, as React leaves it. */
function crashed(error: unknown) {
  const boundary = new RootBoundary({ children: createElement('div', null, 'app') });
  boundary.setState = ((patch: object) => { boundary.state = { ...boundary.state, ...patch }; }) as never;
  boundary.state = { ...boundary.state, ...RootBoundary.getDerivedStateFromError(error) };
  boundary.componentDidCatch(error, { componentStack: '\n    in Chat\n    in WorkspaceApp' });
  return boundary;
}

describe('RootBoundary', () => {
  beforeEach(() => bridge.post.mockClear());
  afterEach(() => { delete (globalThis as { document?: unknown }).document; });

  it('renders its children while nothing has thrown', () => {
    const boundary = new RootBoundary({ children: createElement('div', null, 'app') });
    expect(renderToStaticMarkup(boundary.render() as ReactElement)).toBe('<div>app</div>');
  });

  it('renders the fallback in the host-localized boot strings when a child throws', () => {
    (globalThis as { document?: unknown }).document = fakeDocument(JSON.stringify(GERMAN));
    const html = renderToStaticMarkup(crashed(new Error('chat exploded')).render() as ReactElement);
    expect(html).toContain('role="alert"');
    expect(html).toContain(GERMAN.title);
    expect(html).toContain(GERMAN.body);
    expect(html).toContain('Panel neu laden');
    expect(html).toContain('Details kopieren');
    expect(html).toContain('chat exploded');
    expect(html).toContain('var(--vscode-editor-background)');
  });

  it('posts the error, with both stacks, to the host log', () => {
    const error = new Error('chat exploded');
    crashed(error);
    expect(bridge.post).toHaveBeenCalledWith('webview.error', expect.objectContaining({
      source: 'render',
      message: 'chat exploded',
      stack: error.stack,
      componentStack: '\n    in Chat\n    in WorkspaceApp',
    }));
  });

  it("wires Reload and Copy details to the host", () => {
    const error = new Error('chat exploded');
    const boundary = crashed(error);
    bridge.post.mockClear();
    const fallback = boundary.render();
    expect(isValidElement(fallback) && fallback.type).toBe(RootFallback);
    const props = (fallback as ReactElement<{ onReload: () => void; onCopy: () => void }>).props;
    props.onReload();
    expect(bridge.post).toHaveBeenCalledWith('webview.reload');
    props.onCopy();
    const [, payload] = bridge.post.mock.calls.find(([type]) => type === 'webview.copy')!;
    expect(payload.text).toContain('chat exploded');
    expect(payload.text).toContain(error.stack);
    expect(payload.text).toContain('in WorkspaceApp');
  });

  it('reports a non-Error throw by its value', () => {
    crashed('plain string');
    expect(bridge.post).toHaveBeenCalledWith('webview.error', expect.objectContaining({ message: 'plain string' }));
  });
});

describe('readBootStrings', () => {
  it('reads the localized copy from the data block', () => {
    expect(readBootStrings(fakeDocument(JSON.stringify(GERMAN)))).toEqual(GERMAN);
  });

  it('falls back to English when the block is missing, malformed or partial', () => {
    expect(readBootStrings(fakeDocument(null))).toEqual(DEFAULT_ROOT_FALLBACK_STRINGS);
    expect(readBootStrings(fakeDocument('{not json'))).toEqual(DEFAULT_ROOT_FALLBACK_STRINGS);
    expect(readBootStrings(undefined)).toEqual(DEFAULT_ROOT_FALLBACK_STRINGS);
    expect(readBootStrings(fakeDocument(JSON.stringify({ title: 'Nur Titel', body: 7 })))).toEqual({ ...DEFAULT_ROOT_FALLBACK_STRINGS, title: 'Nur Titel' });
  });
});

describe('errorDetails', () => {
  it('joins the message and each stack that is present', () => {
    expect(errorDetails({ source: 'render', message: 'boom' })).toBe('boom');
    expect(errorDetails({ source: 'render', message: 'boom', stack: 'Error: boom', componentStack: '\n    in A' })).toBe('boom\n\nError: boom\n\nComponent stack:\n    in A');
  });
});

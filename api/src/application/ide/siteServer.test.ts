/**
 * The two hosting fixes that decide whether a published site looks broken:
 * whether a deep link renders, and whether an unmatched `/api/…` answers like an
 * API instead of handing a `fetch()` the app's HTML.
 */

import { describe, expect, it } from 'vitest';
import { withRootBase } from './siteServer';

describe('withRootBase', () => {
  it('injects a root base so relative assets resolve from a nested route', () => {
    const html = '<!doctype html><html><head><title>x</title></head><body><script src="./assets/app.js"></script></body></html>';
    const out = withRootBase(html);
    expect(out).toContain('<base href="/">');
    // Immediately after <head>, so it precedes every URL the document declares —
    // a base tag after the first <script src> would not apply to that script.
    expect(out.indexOf('<base href="/">')).toBeLessThan(out.indexOf('<title>'));
  });

  it('leaves a document that declares its own base untouched', () => {
    const html = '<html><head><base href="/app/"><title>x</title></head></html>';
    expect(withRootBase(html)).toBe(html);
  });

  it('creates a head when the document has none', () => {
    const out = withRootBase('<html><body>hi</body></html>');
    expect(out).toContain('<head><base href="/"></head>');
  });

  it('still produces a base for a fragment with no html element', () => {
    expect(withRootBase('<div>hi</div>')).toBe('<base href="/"><div>hi</div>');
  });

  it('is idempotent — re-serving an already-rewritten document adds nothing', () => {
    const once = withRootBase('<html><head></head></html>');
    expect(withRootBase(once)).toBe(once);
  });
});

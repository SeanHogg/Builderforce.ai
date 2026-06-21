import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BFEMBED_SOURCE } from '@seanhogg/builderforce-embedded';

/**
 * The embed layout injects an EARLY inline `window.onerror`/`unhandledrejection`
 * reporter that postMessages `{ source, type:'error', message }` to the host. The
 * `source` token is inlined as a raw string literal in the script (it must run
 * before any bundle, so it can't import the constant) — this test guards against
 * drift from `BFEMBED_SOURCE` and asserts the reporter covers both error channels
 * and only fires when framed.
 */
describe('embed in-band error reporter (layout.tsx)', () => {
  const layout = readFileSync(join(__dirname, '../../app/embed/layout.tsx'), 'utf-8');

  it('inlines the exact protocol source token (no drift from BFEMBED_SOURCE)', () => {
    expect(BFEMBED_SOURCE).toBe('builderforce-embed/v1');
    expect(layout).toContain(`var SRC = '${BFEMBED_SOURCE}';`);
  });

  it("posts a frame `error` message shape to the parent", () => {
    expect(layout).toContain("type: 'error'");
    expect(layout).toContain('window.parent.postMessage');
  });

  it('only reports when framed (window !== window.parent)', () => {
    expect(layout).toContain('if (window === window.parent) return;');
  });

  it('catches both window errors and unhandled promise rejections', () => {
    expect(layout).toContain("addEventListener('error'");
    expect(layout).toContain("addEventListener('unhandledrejection'");
  });

  it('runs before the route bundle (beforeInteractive)', () => {
    expect(layout).toContain('beforeInteractive');
  });
});

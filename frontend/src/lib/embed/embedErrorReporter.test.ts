import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BFEMBED_SOURCE } from '@seanhogg/builderforce-embedded';
import { EMBED_ERROR_REPORTER } from './embedErrorReporter';

/**
 * The root layout injects an EARLY inline `window.onerror`/`unhandledrejection`
 * reporter that postMessages `{ source, type:'error', message }` to the host when
 * framed. The `source` token is inlined as a raw string literal in the script (it
 * must run before any bundle, so it can't import the constant) — this test guards
 * against drift from `BFEMBED_SOURCE`, asserts the reporter covers both error
 * channels and only fires when framed, and verifies it is wired into the ROOT
 * layout (a nested layout can't provide a true pre-bundle script).
 */
describe('embed in-band error reporter', () => {
  it('inlines the exact protocol source token (no drift from BFEMBED_SOURCE)', () => {
    expect(BFEMBED_SOURCE).toBe('builderforce-embed/v1');
    expect(EMBED_ERROR_REPORTER).toContain(`var SRC = '${BFEMBED_SOURCE}';`);
  });

  it('posts frame messages to the parent', () => {
    expect(EMBED_ERROR_REPORTER).toContain('window.parent.postMessage');
  });

  it('only reports when framed (window !== window.parent)', () => {
    expect(EMBED_ERROR_REPORTER).toContain('if (window === window.parent) return;');
  });

  it('emits a proof-of-life `boot` ping the instant inline JS runs', () => {
    expect(EMBED_ERROR_REPORTER).toContain("send('boot'");
  });

  it('catches window errors, unhandled rejections, AND capture-phase resource-load failures', () => {
    expect(EMBED_ERROR_REPORTER).toContain("addEventListener('error'");
    expect(EMBED_ERROR_REPORTER).toContain("addEventListener('unhandledrejection'");
    // Capture phase (3rd arg true) is what catches a chunk that fails to LOAD —
    // those errors do not bubble to window and were otherwise invisible.
    expect(EMBED_ERROR_REPORTER).toContain('}, true);');
    expect(EMBED_ERROR_REPORTER).toContain('resource failed to load');
  });

  it('reports a boot-stall, gated on the app never posting ready', () => {
    expect(EMBED_ERROR_REPORTER).toContain('boot-stall');
    expect(EMBED_ERROR_REPORTER).toContain('__bfEmbedReady');
  });

  it('runs before the route bundle via a raw inline <head> script in the ROOT layout', () => {
    const rootLayout = readFileSync(join(__dirname, '../../app/layout.tsx'), 'utf-8');
    // Imported and injected as a raw inline script (NOT a nested-layout
    // `beforeInteractive` <Script>, which Next.js ignores outside the root).
    expect(rootLayout).toContain('EMBED_ERROR_REPORTER');
    expect(rootLayout).toContain('dangerouslySetInnerHTML={{ __html: EMBED_ERROR_REPORTER }}');
  });
});

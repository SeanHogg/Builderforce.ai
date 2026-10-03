import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Cross-origin-isolation (COOP/COEP) header parity [1570].
 *
 * Three places declare the isolation headers and MUST stay in sync, or a page
 * is isolated in one environment and not another. Isolation is what gives
 * in-browser WASM (onnxruntime-web) its threads:
 *   - public/_headers      — the Cloudflare Workers static-asset deploy
 *   - next.config.js        — `next dev` (and prerendered routes)
 *   - src/middleware.ts     — `withCoi`, SSR Creation Canvas routes
 *
 * Vitest runs from the frontend package root, so cwd-relative reads resolve.
 * Token-presence (not line-exact) so it's agnostic to each file's format
 * (`Header: value` vs `{ key, value }` vs an object literal) while still
 * failing loudly if any source changes the canonical COOP/COEP values.
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const SOURCES: ReadonlyArray<readonly [string, string]> = [
  ['public/_headers', read('public/_headers')],
  ['next.config.js', read('next.config.js')],
  ['src/middleware.ts', read('src/middleware.ts')],
];

describe('cross-origin-isolation header parity [1570]', () => {
  it('every source declares COOP: same-origin + global COEP: credentialless', () => {
    for (const [name, src] of SOURCES) {
      expect(src, `${name}: COOP header`).toContain('Cross-Origin-Opener-Policy');
      expect(src, `${name}: COOP value`).toContain('same-origin');
      expect(src, `${name}: COEP header`).toContain('Cross-Origin-Embedder-Policy');
      expect(src, `${name}: COEP credentialless`).toContain('credentialless');
    }
  });

  it('no source carves out the retired StackBlitz connect route any more', () => {
    // That tab existed only for @webcontainer/api's handshake; previews run on our
    // own runtime now, on preview.builderforce.ai, with nothing to connect.
    for (const [name, src] of SOURCES) {
      expect(src, `${name}: no webcontainer/connect exception`).not.toContain('webcontainer/connect');
      expect(src, `${name}: no unsafe-none override`).not.toContain('unsafe-none');
    }
  });

  it('no source silently weakens the global COEP to require-corp', () => {
    // require-corp would block cross-origin fonts/images that credentialless allows.
    for (const [name, src] of SOURCES) {
      expect(src, `${name}: must not use require-corp`).not.toContain('require-corp');
    }
  });
});

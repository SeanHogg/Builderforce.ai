/**
 * Test-only stub for `mambacode.js`.
 *
 * The upstream github tarball (`SeanHogg/Mamba`) ships only `src/` and no
 * built `dist/`, so `import('mambacode.js')` fails to resolve under vite's
 * static import-analysis pass. Production runtime (webpack) defers resolution
 * to load time and the existing try/catch in [model-provider.ts](../../lib/model-provider.ts)
 * handles the runtime failure gracefully — but vitest cannot transform the
 * file at all without this stub.
 *
 * `vitest.config.ts` aliases the `mambacode.js` specifier to this file when
 * tests run. The stub deliberately throws on every entry point so the
 * existing `MambaModelProvider.init()` happy-path tests stay valid: they
 * assert the provider gracefully degrades when the library is unavailable.
 */

function notAvailable(): never {
  throw new Error('mambacode.js is not available in the test environment');
}

export function initWebGPU(): never {
  notAvailable();
}

export class BPETokenizer {
  async load(): Promise<void> {
    notAvailable();
  }
}

export class MambaModel {
  constructor() {
    notAvailable();
  }
}

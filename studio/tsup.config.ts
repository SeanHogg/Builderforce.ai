import { defineConfig } from 'tsup';
import { libraryConfig } from '../scripts/tsup.base.mjs';

export default defineConfig(libraryConfig({
  entry: { index: 'src/index.ts', capabilities: 'src/engine/device-router.ts' },
  external: [
    'onnxruntime-web',
    '@huggingface/transformers',
    '@seanhogg/builderforce-memory-engine',
    '@seanhogg/builderforce-sdk',
    // @webdit/runtime imports web-llm (optional peer of webdit, never of studio);
    // the consumer provides it if they use it, so it is not bundled.
    '@mlc-ai/web-llm',
  ],
  // @webdit/* is private (never published), so it is BUNDLED into dist rather than
  // listed as a runtime dependency. Its own third-party imports (onnxruntime-web,
  // @huggingface/transformers) stay external above and are studio peers.
  // The lazy `import('@webdit/runtime')` in webdit-engine.ts stays a code-split
  // boundary (via src/engine/webdit-runtime.ts, named re-exports only so the
  // Node-only loader is tree-shaken out): splitting emits it as its own chunk in
  // dist for both ESM and CJS, so consumers that only pick lcm-diffusion models
  // never load the ORT/tensor-runner tree.
  //
  // @builderforce/voice-provenance is source-only and private too: bundled the
  // same way, so the engine marks every clip it synthesizes without consumers
  // installing anything (it is a `link:` devDependency, resolved by `paths`).
  dts: { resolve: [/^@webdit\//, /^@builderforce\/voice-provenance/] },
  extra: {
    noExternal: [/^@webdit\//, /^@builderforce\/voice-provenance/],
    splitting: true,
  },
}));

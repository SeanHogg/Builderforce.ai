import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', capabilities: 'src/engine/device-router.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  external: [
    'onnxruntime-web',
    '@huggingface/transformers',
    '@seanhogg/builderforce-memory-engine',
    '@seanhogg/builderforce-sdk',
    // webdit is only reached via a lazy `import('@webdit/runtime')` in
    // webdit-engine.ts (see WebDitModelDescriptor) — external here so that
    // dynamic import stays a real code-split boundary instead of tsup
    // inlining the whole ORT/tensor-runner tree into the main bundle for
    // every consumer, even ones that only ever pick lcm-diffusion models.
    '@webdit/runtime',
    '@webdit/shared',
  ],
  outExtension({ format }) {
    return { js: format === 'esm' ? '.mjs' : '.cjs' };
  },
});

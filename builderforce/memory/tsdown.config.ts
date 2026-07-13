import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esmb'],
  dts: true,
  clean: true,
  target: 'node22',
  shims: true,
  splitting: false,
  sourcemap: true,
  sourcemapPath: '../dist-maps',
  minimize: true,
  banner: {
    js: `/**
 * @packageDocumentation
 * @module builderforce/memory
 * @internal
 */`
  }
});
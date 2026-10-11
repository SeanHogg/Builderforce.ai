import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';
import { browserSnippetConfig } from '../scripts/tsup.base.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const contract = path.resolve(root, '../packages/interaction-contract/src/index.ts');

function alias() {
  return {
    esbuildOptions(options: { alias?: Record<string, string> }) {
      options.alias = {
        ...(options.alias ?? {}),
        '@builderforce/interaction-contract': contract,
      };
    },
  };
}

/** IIFE entries published to cdn.builderforce.ai — hashed after this build. */
function cdnIife(entryName: string, entryFile: string, globalName: string) {
  return {
    entry: { [entryName]: entryFile },
    format: ['iife' as const],
    globalName,
    minify: true,
    sourcemap: false,
    dts: false,
    clean: false,
    outDir: 'dist',
    platform: 'browser' as const,
    outExtension() {
      return { js: '.js' };
    },
    ...alias(),
  };
}

export default defineConfig([
  {
    ...browserSnippetConfig({
      entry: ['src/index.ts'],
      globalName: 'BuilderForceReplay',
    }),
    clean: true,
    ...alias(),
  },
  cdnIife('loader', 'src/loader.ts', 'BuilderForceReplayLoader'),
  cdnIife('recorder', 'src/recorder.ts', 'BuilderForceReplayRecorder'),
  cdnIife('embed', 'src/embed.ts', 'BuilderForceEmbed'),
]);

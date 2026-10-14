import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';
import { browserSnippetConfig } from '../scripts/tsup.base.mjs';
import { sourcePackageAliasMap } from '../scripts/sourcePackages.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
/** Source-only shared packages (`@builderforce/interaction-contract`), derived from their manifests. */
const sourceAliases = sourcePackageAliasMap(path.resolve(root, '..'));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };

function alias() {
  return {
    esbuildOptions(options: { alias?: Record<string, string> }) {
      options.alias = { ...(options.alias ?? {}), ...sourceAliases };
    },
  };
}

/** IIFE entries published to cdn.builderforce.ai — laid out and hashed by scripts/emit-assets.mjs. */
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
    define: { __BF_RECORDER_VERSION__: JSON.stringify(pkg.version) },
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
      globalName: 'BuilderforceReplay',
    }),
    clean: true,
    ...alias(),
  },
  cdnIife('loader', 'src/loader.ts', 'BuilderforceReplayLoader'),
  cdnIife('recorder', 'src/recorder.ts', 'BuilderforceReplayRecorder'),
  cdnIife('embed', 'src/embed.ts', 'BuilderforceEmbed'),
  cdnIife('player', 'src/player.ts', 'BuilderforceReplayPlayer'),
  cdnIife('pagekit', 'src/pageKit.ts', 'BuilderforcePageKit'),
]);

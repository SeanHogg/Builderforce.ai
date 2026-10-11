#!/usr/bin/env node
/**
 * Stamp the CDN layout under dist/assets (and a dist/cdn alias) after tsup:
 *   dist/assets/replay/v1/loader.js
 *   dist/assets/replay/r/recorder.<hash>.js
 *   dist/assets/replay/manifest.json
 *   dist/assets/embed/v1.js
 *
 * The manifest carries both the loader shape (`recorder`, `hash`) and the
 * ReplayConfigService shape (`latest.{version,url,hash,builtAt}`).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('.', import.meta.url)));
const dist = join(root, 'dist');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const CDN_ORIGIN = 'https://cdn.builderforce.ai';

function sha8(buf) {
  return createHash('sha256').update(buf).digest('hex').slice(0, 8);
}

function stamp(file, hash) {
  const raw = readFileSync(file, 'utf8');
  if (!raw.includes('__BF_RECORDER_HASH__')) return;
  writeFileSync(file, raw.replaceAll('__BF_RECORDER_HASH__', hash));
}

const loader = readFileSync(join(dist, 'loader.js'));
const recorder = readFileSync(join(dist, 'recorder.js'));
const hash = sha8(recorder);
const recorderPath = `/replay/r/recorder.${hash}.js`;
const builtAt = new Date().toISOString();

function emitLayout(outRoot) {
  mkdirSync(join(outRoot, 'replay', 'v1'), { recursive: true });
  mkdirSync(join(outRoot, 'replay', 'r'), { recursive: true });
  mkdirSync(join(outRoot, 'embed'), { recursive: true });
  writeFileSync(join(outRoot, 'replay', 'v1', 'loader.js'), loader);
  writeFileSync(join(outRoot, recorderPath.replace(/^\//, '')), recorder);

  const embed = readFileSync(join(dist, 'embed.js'));
  writeFileSync(join(outRoot, 'embed', 'v1.js'), embed);

  const manifest = {
    version: 1,
    hash,
    loader: '/replay/v1/loader.js',
    recorder: recorderPath,
    embed: '/embed/v1.js',
    builtAt,
    latest: {
      version: pkg.version,
      url: `${CDN_ORIGIN}${recorderPath}`,
      hash,
      builtAt,
    },
  };
  writeFileSync(join(outRoot, 'replay', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

emitLayout(join(dist, 'assets'));
emitLayout(join(dist, 'cdn'));

for (const name of ['index.mjs', 'index.cjs', 'index.global.js']) {
  try {
    stamp(join(dist, name), hash);
  } catch {
    /* optional format */
  }
}

const copied = [
  'replay/v1/loader.js',
  recorderPath.slice(1),
  'replay/manifest.json',
  'embed/v1.js',
];
console.log(`emit-assets: hash=${hash} → dist/assets/{${copied.join(', ')}}`);

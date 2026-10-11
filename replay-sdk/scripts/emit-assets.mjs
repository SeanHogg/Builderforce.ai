#!/usr/bin/env node
/**
 * Copy tsup IIFE output into the CDN layout and stamp a content hash on the
 * recorder so a new build is a new URL (`/replay/r/recorder.<hash>.js`).
 *
 * Layout:
 *   dist/cdn/replay/v1/loader.js
 *   dist/cdn/replay/r/recorder.<hash>.js
 *   dist/cdn/replay/manifest.json
 *   dist/cdn/embed/v1.js
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('.', import.meta.url)));
const dist = join(root, 'dist');

function mustRead(file) {
  if (!existsSync(file)) {
    throw new Error(`emit-assets: missing ${file} — run tsup first`);
  }
  return readFileSync(file);
}

function write(file, buf, encoding) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, buf, encoding);
}

const loader = mustRead(join(dist, 'loader.js'));
const recorder = mustRead(join(dist, 'recorder.js'));
const embed = existsSync(join(dist, 'embed.js')) ? readFileSync(join(dist, 'embed.js')) : Buffer.from('');

const hash = createHash('sha256').update(recorder).digest('hex').slice(0, 8);
const recorderPath = `/replay/r/recorder.${hash}.js`;

write(join(dist, 'cdn/replay/v1/loader.js'), loader);
write(join(dist, 'cdn', recorderPath.slice(1)), recorder);
if (embed.length) write(join(dist, 'cdn/embed/v1.js'), embed);

const manifest = {
  version: 1,
  hash,
  loader: '/replay/v1/loader.js',
  recorder: recorderPath,
  embed: embed.length ? '/embed/v1.js' : undefined,
  builtAt: new Date().toISOString(),
};
write(join(dist, 'cdn/replay/manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

for (const file of ['index.mjs', 'index.cjs', 'index.global.js']) {
  const target = join(dist, file);
  if (!existsSync(target)) continue;
  const src = readFileSync(target, 'utf8');
  if (!src.includes('__BF_RECORDER_HASH__')) continue;
  writeFileSync(target, src.replaceAll('__BF_RECORDER_HASH__', hash));
}

process.stdout.write(`cdn assets: loader + recorder.${hash}.js\n`);

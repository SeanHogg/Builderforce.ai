#!/usr/bin/env node
/**
 * Post-build size + layout check. Fail if dist/assets is missing, if gzip
 * budgets are exceeded, or if the manifest is not the ReplayConfigService
 * contract. Run after `npm run build` (`npm run size`).
 */
import { createGzip } from 'node:zlib';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';

const root = dirname(fileURLToPath(new URL('.', import.meta.url)));
const assets = join(root, 'dist', 'assets');

const LOADER_MAX = 2 * 1024;
const RECORDER_MAX = 80 * 1024;

async function gzipBytes(file) {
  let n = 0;
  const sink = new Writable({
    write(chunk, _enc, cb) {
      n += chunk.length;
      cb();
    },
  });
  await pipeline(createReadStream(file), createGzip(), sink);
  return n;
}

function fail(msg) {
  console.error(`size: ${msg}`);
  process.exit(1);
}

if (!existsSync(assets)) {
  fail(`missing ${assets} — run npm run build first`);
}

const loader = join(assets, 'replay', 'v1', 'loader.js');
const embed = join(assets, 'embed', 'v1.js');
const manifestPath = join(assets, 'replay', 'manifest.json');
const recorderDir = join(assets, 'replay', 'r');

if (!existsSync(loader)) fail(`missing ${loader}`);
if (!existsSync(embed)) fail(`missing ${embed} — unifiedEmbedSnippet 404s without it`);
if (!existsSync(manifestPath)) fail(`missing ${manifestPath}`);
if (!existsSync(recorderDir)) fail(`missing ${recorderDir}`);

const recorders = readdirSync(recorderDir).filter((n) => /^recorder\.[0-9a-f]{8}\.js$/.test(n));
if (recorders.length !== 1) {
  fail(`expected exactly one hashed recorder under replay/r, got ${recorders.join(',') || '(none)'}`);
}
const recorder = join(recorderDir, recorders[0]);

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (typeof manifest.hash !== 'string' || !/^[0-9a-f]{8}$/.test(manifest.hash)) {
  fail('manifest.hash must be 8 hex chars');
}
if (manifest.recorder !== `/replay/r/recorder.${manifest.hash}.js`) {
  fail(`manifest.recorder ${manifest.recorder} does not match hash`);
}
if (!manifest.latest || typeof manifest.latest !== 'object') {
  fail('manifest.latest missing — ReplayConfigService cannot learn the recorder');
}
const latest = manifest.latest;
if (latest.hash !== manifest.hash) fail('manifest.latest.hash must equal manifest.hash');
if (latest.url !== `https://cdn.builderforce.ai/replay/r/recorder.${manifest.hash}.js`) {
  fail(`manifest.latest.url is ${latest.url}`);
}
if (typeof latest.version !== 'string' || !latest.version) fail('manifest.latest.version missing');
if (typeof latest.builtAt !== 'string' || !latest.builtAt) fail('manifest.latest.builtAt missing');

const loaderGz = await gzipBytes(loader);
const recorderGz = await gzipBytes(recorder);
const embedRaw = statSync(embed).size;

if (loaderGz > LOADER_MAX) {
  fail(`loader gzip ${loaderGz} > ${LOADER_MAX} (2 KB)`);
}
if (recorderGz > RECORDER_MAX) {
  fail(`recorder gzip ${recorderGz} > ${RECORDER_MAX} (80 KB)`);
}

console.log(
  `size: loader ${loaderGz} B gz (≤ ${LOADER_MAX}), recorder ${recorderGz} B gz (≤ ${RECORDER_MAX}), embed ${embedRaw} B raw, hash=${manifest.hash}`,
);

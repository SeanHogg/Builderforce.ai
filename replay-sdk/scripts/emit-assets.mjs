#!/usr/bin/env node
/**
 * Lay the CDN out under dist/assets after tsup (PRD 33 D5):
 *   dist/assets/replay/v1/loader.js           (max-age 300)
 *   dist/assets/replay/r/recorder.<hash>.js   (immutable; hash = 12 hex of SHA-256)
 *   dist/assets/replay/manifest.json          (max-age 60) — { latest: { version, url, hash, builtAt } }
 *   dist/assets/embed/v1.js                   (max-age 300)
 *   dist/assets/replay/r/player.<hash>.js     (immutable) — rrweb Replayer for the Insights player + MP4 export
 *   dist/assets/replay/r/player.<hash>.css    (immutable) — rrweb's replayer stylesheet
 *   dist/assets/replay/r/pagekit.<hash>.js    (immutable) — deriveSelector + applyVisualPatch for the page-review runner
 *
 * `ReplayConfigService` reads `pinned`/`channels`/`latest` from REPLAY_MANIFEST_URL and
 * names the recorder in the config answer; nothing else reads the manifest. This script
 * writes only `latest`/`player`/`pageKit`: `pinned` and `channels` are operator-set, and
 * `.github/scripts/cdn-publish.sh` carries them forward from the live manifest.
 * `.github/scripts/cdn-publish.sh` uploads this tree, manifest last.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('.', import.meta.url)));
const dist = join(root, 'dist');
const out = join(dist, 'assets');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const CDN_ORIGIN = 'https://cdn.builderforce.ai';

/**
 * Content hash length — at least 10 hex chars (D5). MUST equal `RECORDER_HASH_LENGTH` in
 * `packages/interaction-contract/src/snippets.ts` (this plain-node script cannot import
 * the TS source; `src/emitAssets.test.ts` fails if the two drift).
 */
const HASH_LENGTH = 12;

const loader = readFileSync(join(dist, 'loader.js'));
const recorder = readFileSync(join(dist, 'recorder.js'));
const embed = readFileSync(join(dist, 'embed.js'));
const player = readFileSync(join(dist, 'player.js'));
const pageKit = readFileSync(join(dist, 'pagekit.js'));
const playerCss = readFileSync(join(root, 'node_modules', 'rrweb', 'dist', 'style.css'));
const rrwebVersion = JSON.parse(readFileSync(join(root, 'node_modules', 'rrweb', 'package.json'), 'utf8')).version;
const contentHash = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, HASH_LENGTH);
const hash = contentHash(recorder);
const recorderKey = `replay/r/recorder.${hash}.js`;
const playerKey = `replay/r/player.${contentHash(player)}.js`;
const playerCssKey = `replay/r/player.${contentHash(playerCss)}.css`;
const pageKitKey = `replay/r/pagekit.${contentHash(pageKit)}.js`;

rmSync(out, { recursive: true, force: true });
rmSync(join(dist, 'cdn'), { recursive: true, force: true });
for (const dir of ['replay/v1', 'replay/r', 'embed']) mkdirSync(join(out, dir), { recursive: true });

writeFileSync(join(out, 'replay', 'v1', 'loader.js'), loader);
writeFileSync(join(out, recorderKey), recorder);
writeFileSync(join(out, 'embed', 'v1.js'), embed);
writeFileSync(join(out, playerKey), player);
writeFileSync(join(out, playerCssKey), playerCss);
writeFileSync(join(out, pageKitKey), pageKit);

const manifest = {
  latest: {
    version: pkg.version,
    url: `${CDN_ORIGIN}/${recorderKey}`,
    hash,
    builtAt: new Date().toISOString(),
  },
  player: {
    url: `${CDN_ORIGIN}/${playerKey}`,
    cssUrl: `${CDN_ORIGIN}/${playerCssKey}`,
    rrweb: rrwebVersion,
  },
  pageKit: {
    url: `${CDN_ORIGIN}/${pageKitKey}`,
  },
};
writeFileSync(join(out, 'replay', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`emit-assets: recorder ${hash} → dist/assets/{replay/v1/loader.js, ${recorderKey}, replay/manifest.json, embed/v1.js, ${playerKey}, ${playerCssKey}, ${pageKitKey}}`);

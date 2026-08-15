/**
 * Publishes the next-intl message catalogs under `public/i18n/`.
 *
 * WHY this exists: the five catalogs are ~4.7 MB of JSON. Imported, they land in
 * the JS module graph, and every Edge Runtime function must carry every chunk it
 * can reach — so all thirty server-translating routes shipped the whole blob and
 * `/embedded` broke the 4 MB edge-function ceiling at build time. They are data,
 * not code, so they ship as static assets and `src/i18n/catalog.ts` fetches the
 * one a request actually needs.
 *
 * The copies are the same bytes the app is tested against (same files the
 * `messages.test.ts` catalog guard reads), minified — pretty-printing is ~13% of
 * the payload and no one reads the deployed copy.
 *
 * Every catalog is published, including the default locale's — which the loader
 * serves from its bundled copy and never fetches. Which locale is the default is
 * a RUNTIME decision (`i18n/config.ts`); teaching this script to prune by it
 * would put that fact in two places, to save one cached asset.
 *
 * Run from `prebuild`, so a deploy always carries catalogs matching the source
 * rather than a stale committed copy. Output is gitignored for the same reason.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src', 'i18n', 'messages');
const OUT = path.join(ROOT, 'public', 'i18n');

/**
 * Cloudflare rejects a static asset over 25 MiB. A catalog is nowhere near that
 * today, but the failure would surface as a deploy error far from this file.
 */
const MAX_ASSET_BYTES = 25 * 1024 * 1024;

function main() {
  const catalogs = fs.readdirSync(SRC).filter((file) => file.endsWith('.json'));
  if (!catalogs.length) {
    // Not a warning: no catalogs means the i18n source moved, and every
    // non-default locale would silently fall back to English at runtime.
    console.error(`[i18n] no catalogs found in ${SRC} — nothing to publish.`);
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(OUT, { recursive: true });
  let published = 0;
  let bytes = 0;

  for (const file of catalogs) {
    const source = fs.readFileSync(path.join(SRC, file), 'utf8');
    // Parse-then-stringify rather than a byte copy: it strips the indentation
    // AND fails the build on a malformed catalog, at the point where the file
    // name is still in hand.
    let minified;
    try {
      minified = JSON.stringify(JSON.parse(source));
    } catch (error) {
      console.error(`[i18n] ${file} is not valid JSON:`, error.message);
      process.exitCode = 1;
      continue;
    }

    if (Buffer.byteLength(minified) > MAX_ASSET_BYTES) {
      console.error(`[i18n] ${file} exceeds the 25 MiB static-asset limit — not published.`);
      process.exitCode = 1;
      continue;
    }

    const to = path.join(OUT, file);
    // Skip an unchanged write so `prebuild` stays cheap on repeat runs.
    if (!fs.existsSync(to) || fs.readFileSync(to, 'utf8') !== minified) fs.writeFileSync(to, minified, 'utf8');
    published += 1;
    bytes += Buffer.byteLength(minified);
  }

  console.log(`[i18n] published ${published} catalog(s) to public/i18n/ (${(bytes / 1024 / 1024).toFixed(2)} MiB).`);
}

main();

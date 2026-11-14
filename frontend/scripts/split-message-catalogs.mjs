/**
 * Split the flat per-locale message catalogs into per-namespace chunks and emit
 * a manifest, for chunked (namespace-level) runtime loading.
 *
 * WHY this exists: the five flat catalogs are ~10 MB of JSON; a non-default
 * locale fetches ~1.2 MB (gzipped) on a cold visit before anything renders, and
 * ~90% of that copy is namespaces the current page never reads. This script
 * reads each flat `src/i18n/messages/<locale>.json` (the single source of truth
 * every guard + `messages.test.ts` already reads) and writes one small JSON
 * asset per top-level namespace into `public/i18n/chunks/<locale>/<ns>.json`,
 * plus `public/i18n/manifest.json` mapping each locale to the list of its
 * namespace names. The runtime (`src/i18n/catalog.ts`) then fetches only the
 * namespaces a route uses instead of the whole catalog.
 *
 * The flat `src/i18n/messages/*.json` files stay as the SOURCE and as the
 * contract the guards / API tests / Chrome extension read. Nothing edits them
 * by hand at runtime; this script only READS them and emits derived assets.
 *
 * Run from `prebuild`/`dev` (before `publish-message-catalogs.mjs`, which still
 * publishes the flat catalogs as the fallback / initial-load path). Output is
 * gitignored for the same reason the flat catalogs' published copies are.
 *
 * `public/_headers` marks `/i18n/*` immutable; that is still correct — every
 * chunk URL is versioned with `NEXT_PUBLIC_APP_VERSION` by `catalog.ts`, so a
 * deploy asks for different paths.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src', 'i18n', 'messages');
const OUT = path.join(ROOT, 'public', 'i18n');

const HEADING = 'The ONE place a message catalog is loaded';

const catalogProbe = path.join(ROOT, 'src', 'i18n', 'catalog.ts');
const catalogFile = fs.existsSync(catalogProbe) ? fs.readFileSync(catalogProbe, 'utf8') : '';
if (!catalogFile.includes(HEADING)) {
  console.error(
    '[i18n:split] refusing to run: src/i18n/catalog.ts is missing the expected heading.\n' +
      'This script reads frontend/src/i18n/messages/* and writes under frontend/public/i18n/;\n' +
      'running it against an installed copy would corrupt the deployed assets.',
  );
  process.exit(1);
}

/**
 * Cloudflare rejects a static asset over 25 MiB. A namespace chunk is nowhere
 * near that today, but the failure would surface as a deploy error far from
 * this file.
 */
const MAX_ASSET_BYTES = 25 * 1024 * 1024;

function fail(message) {
  console.error(`[i18n:split] ${message}`);
  process.exitCode = 1;
}

function main() {
  const locales = fs.readdirSync(SRC).filter((f) => f.endsWith('.json'));
  if (!locales.length) {
    return fail(`no catalogs found in ${SRC} — nothing to split.`);
  }

  const chunksDir = path.join(OUT, 'chunks');
  fs.mkdirSync(chunksDir, { recursive: true });

  /** @type {Record<string, string[]>} locale -> sorted namespace list */
  const manifest = {};
  let chunkCount = 0;
  let bytes = 0;

  for (const file of locales) {
    const locale = file.replace(/\.json$/, '');
    const catalog = JSON.parse(fs.readFileSync(path.join(SRC, file), 'utf8'));

    const namespaces = Object.keys(catalog)
      .filter((k) => catalog[k] && typeof catalog[k] === 'object' && !Array.isArray(catalog[k]))
      .sort();

    if (!namespaces.length) {
      return fail(`${file} has no object namespaces — is it a catalog?`);
    }

    const localeDir = path.join(chunksDir, locale);
    fs.mkdirSync(localeDir, { recursive: true });

    for (const ns of namespaces) {
      // One chunk per namespace, minified. The key IS the namespace name — the
      // runtime merges `{ [ns]: chunk }` back into a flat catalog shape.
      const chunk = JSON.stringify({ [ns]: catalog[ns] });
      if (Buffer.byteLength(chunk) > MAX_ASSET_BYTES) {
        return fail(`${locale}/${ns}.json exceeds the 25 MiB static-asset limit.`);
      }
      const to = path.join(localeDir, `${ns}.json`);
      if (!fs.existsSync(to) || fs.readFileSync(to, 'utf8') !== chunk) {
        fs.writeFileSync(to, chunk, 'utf8');
      }
      chunkCount += 1;
      bytes += Buffer.byteLength(chunk);
    }

    manifest[locale] = namespaces;
  }

  const manifestJson = JSON.stringify(manifest);
  const manifestPath = path.join(OUT, 'manifest.json');
  if (!fs.existsSync(manifestPath) || fs.readFileSync(manifestPath, 'utf8') !== manifestJson) {
    fs.writeFileSync(manifestPath, manifestJson, 'utf8');
  }

  const localesN = Object.keys(manifest).length;
  console.log(
    `[i18n:split] ${chunkCount} chunk(s) across ${localesN} locale(s) → public/i18n/chunks/ ` +
      `(${(bytes / 1024 / 1024).toFixed(2)} MiB) + manifest.json`,
  );
}

main();

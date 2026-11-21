/**
 * Publishes the app manifest's JSON schema at `public/schema/app.v1.json`, so the `$schema`
 * URL every manifest carries (`https://builderforce.ai/schema/app.v1.json` — the kits' and
 * `/manifest init`'s `.builderforce/builderforce.json`) resolves. Without it VS Code's JSON
 * service fetched a 404 page and reported "Unable to load schema" on every manifest.
 *
 * WHY generated: the schema is the runtime's (`APP_MANIFEST_SCHEMA_V1`, re-exported by
 * `@seanhogg/builderforce-webcontainers/app` from `-core/manifest`), so the served file is
 * always the pinned release's — never a copy kept in this repo. The URL is read from the
 * same package (`APP_MANIFEST_SCHEMA_URL`), so a path change there cannot go unnoticed.
 *
 * Run from `prebuild` and `dev`. `public/schema/` is gitignored. A static asset: the Worker's
 * assets binding answers it without running middleware.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_MANIFEST_SCHEMA_URL, APP_MANIFEST_SCHEMA_V1 } from '@seanhogg/builderforce-webcontainers/app';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://builderforce.ai/';

if (!APP_MANIFEST_SCHEMA_URL.startsWith(SITE)) {
  throw new Error(`[manifest-schema] ${APP_MANIFEST_SCHEMA_URL} is not served by this site (${SITE})`);
}
const OUT = path.join(ROOT, 'public', ...APP_MANIFEST_SCHEMA_URL.slice(SITE.length).split('/'));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(APP_MANIFEST_SCHEMA_V1, null, 2)}\n`);
console.log(`[manifest-schema] published ${path.relative(ROOT, OUT)}`);

#!/usr/bin/env node
/**
 * Single-API-transport guard.
 *
 * `lib/apiClient.ts` is THE transport for api.builderforce.ai. Its header
 * contract is load-bearing — the emulation token, the locale header, the
 * 401→login redirect, the typed 402 plan-limit error, and the global error
 * report all live in one place — and duplicating it silently breaks features
 * rather than failing loudly.
 *
 * That is not hypothetical. Before this guard there were six copies:
 *
 *   - `builderforceApi.request` / `webRequest` (imported by 236 modules) sent
 *     NEITHER `X-Emulation-Token` NOR the locale header, so a superadmin
 *     emulating a user saw their own data on nearly every screen, and the API
 *     never learned the user's chosen language;
 *   - `personaCadenceApi` and `emailPreferencesApi` each had a copy that dropped
 *     `dispatchApiError`, so their failures raised no toast at all;
 *   - `freelancerApi` bypassed all of them with 72 raw `fetch()` calls;
 *   - `api.ts` and `adminApi.ts` had their own, justified at the time by a
 *     different origin and a different credential — both now options on the one
 *     transport (`baseUrl`, `auth`).
 *
 * So: no `fetch(` inside `src/lib/**` except in the transport itself and the
 * explicitly-reasoned exceptions below.
 *
 * Run via `npm run check:api-transport`; wired into `npm test`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const libDir = resolve(here, '../src/lib');

/**
 * Files allowed to call `fetch` directly. Every entry needs a REASON that is
 * about the code, not about the effort of changing it.
 */
const ALLOWED = new Map([
  ['apiClient.ts', 'It is the transport.'],
  [
    'auth.ts',
    'Login / register / token-exchange run BEFORE a session exists. Routing them ' +
      'through apiRequest would invoke checkUnauthorizedAndRedirect on a failed ' +
      'login and bounce the user off the login page they are standing on.',
  ],
  [
    'marketplaceSeo.ts',
    'Runs server-side (generateMetadata + sitemap). The transport reads ' +
      'localStorage and document.cookie, neither of which exists there, and these ' +
      'calls carry no credential.',
  ],
  [
    'meshPreviewCache.ts',
    'Reads an artifact\'s own output URL (R2/blob/data) to parse its triangles. ' +
      'Not the Builderforce API — attaching our auth headers to a storage or ' +
      'third-party origin would leak the token, and the transport\'s JSON/redirect ' +
      'handling is wrong for an arrayBuffer read that must degrade to [] silently.',
  ],
  [
    'model-provider.ts',
    'HEAD probes against arbitrary model-asset URLs (tokenizer vocab/merges on a ' +
      'third-party host). Not the Builderforce API at all — sending our auth ' +
      'headers to someone else\'s origin would leak the token.',
  ],
]);

/** `fetch(` that is a real call, not the word inside an identifier or a comment. */
const FETCH_CALL = /(?<![\w.$])fetch\s*\(/;

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const violations = [];

for (const file of collect(libDir)) {
  const rel = relative(libDir, file).split('\\').join('/');
  if (ALLOWED.has(rel)) continue;
  if (rel.endsWith('.test.ts') || rel.endsWith('.test.tsx')) continue;

  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    // Skip comments: `//` trailing, `/* … */` inline, and JSDoc continuation
    // lines (which start with `*` and are pure prose).
    if (/^\s*[*]/.test(line)) return;
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    if (FETCH_CALL.test(code)) violations.push(`${rel}:${i + 1}  ${line.trim()}`);
  });
}

if (violations.length > 0) {
  console.error(`❌  Raw fetch() outside the API transport (${violations.length} site(s)):\n`);
  for (const v of violations) console.error('  - ' + v);
  console.error(
    "\n   Use apiRequest / apiRequestText / apiRequestStream from '@/lib/apiClient'." +
      '\n   The options cover the reasons a separate wrapper used to exist:' +
      "\n     auth: 'tenant' | 'web' | 'none'   which credential to send" +
      '\n     baseUrl                          a different origin (e.g. the worker)' +
      '\n     expectedErrors                   statuses the caller renders itself' +
      '\n     json / FormData bodies           Content-Type is handled for you' +
      '\n   If a call genuinely cannot use the transport, add it to ALLOWED in' +
      '\n   scripts/check-api-transport.mjs WITH a reason.\n',
  );
  process.exit(1);
}

console.log(
  `✅  API transport check passed — fetch() appears only in ${[...ALLOWED.keys()].join(', ')}.`,
);

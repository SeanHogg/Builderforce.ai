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
const srcDir = resolve(here, '../src');

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
    'passkeys.ts',
    'The SIGN-IN half of the same story as auth.ts, and only that half: ' +
      '/api/auth/passkey/options and /verify are the two calls that run before a ' +
      'session token exists, so apiRequest would redirect a failed passkey attempt ' +
      'off the login page instead of showing "that passkey could not be used". ' +
      'Registration DOES have a session and is already on the typed client ' +
      '(`passkeysApi` in builderforceApi.ts); the rest of this file is WebAuthn ' +
      'ceremony code that makes no request at all.',
  ],
  [
    'publicApi.ts',
    'It is the transport for UNCREDENTIALED server reads (generateMetadata, ' +
      'sitemap, public reference pages). apiClient reads localStorage and ' +
      'document.cookie, neither of which exists server-side; these calls carry no ' +
      'credential and are held in Next\'s data cache. Every public server read ' +
      'goes through here — marketplaceSeo and integrationCatalog included.',
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
const cacheViolations = [];

for (const file of collect(libDir)) {
  const rel = relative(libDir, file).split('\\').join('/');
  if (ALLOWED.has(rel)) continue;
  if (rel.endsWith('.test.ts') || rel.endsWith('.test.tsx')) continue;

  // `\r` is stripped, not merely split on. Without it the comment regexes below
  // silently stop working on a CRLF checkout: `.` does not match a carriage return
  // and `$` (unanchored) sits AFTER it, so `//.*$` matches nothing and a prose line
  // is scanned as code. It surfaced as `modelCatalog.ts:132  // Catalog fetch (via
  // our gateway)` — a comment reported as a raw call, on a repo that checks out CRLF
  // on Windows. A guard that fails on a comment is one people learn to route around.
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    // Skip comments: `//` trailing, `/* … */` inline, and JSDoc continuation
    // lines (which start with `*` and are pure prose).
    if (/^\s*[*]/.test(line)) return;
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    if (FETCH_CALL.test(code)) violations.push(`${rel}:${i + 1}  ${line.trim()}`);
  });
}

// A domain request cache belongs in infrastructure/http/readThrough. This
// deliberately targets module-scope cache-shaped declarations, not every Map:
// registries, graph indexes and bounded computational memoization are valid.
const CACHE_ALLOWED = new Map([
  ['infrastructure/http/readThrough.ts', 'It is the shared cache implementation.'],
  ['lib/meshPreviewCache.ts', 'Bounded computational geometry memoization, not an API response cache.'],
  ['lib/pendingWork.ts', 'Single-flight for destructive local-draft claims; it stores no HTTP read result.'],
]);
const CACHE_DECLARATION = /^(?:const|let)\s+\w*(?:cache|cached|inflight|inFlight)\w*\s*=/;
const PROMISE_MAP_DECLARATION = /^(?:const|let)\s+\w+\s*=\s*new Map<[^\n;]*Promise</;

for (const file of collect(srcDir)) {
  const rel = relative(srcDir, file).split('\\').join('/');
  if (CACHE_ALLOWED.has(rel) || rel.endsWith('.test.ts') || rel.endsWith('.test.tsx')) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (CACHE_DECLARATION.test(line) || PROMISE_MAP_DECLARATION.test(line)) {
      cacheViolations.push(`${rel}:${i + 1}  ${line.trim()}`);
    }
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

if (cacheViolations.length > 0) {
  console.error(`❌  Hand-rolled client request cache (${cacheViolations.length} site(s)):\n`);
  for (const violation of cacheViolations) console.error('  - ' + violation);
  console.error(
    "\n   Use getOrSetClientCached / invalidateClientCache from " +
      "'@/infrastructure/http/readThrough'. Add an exception only for a bounded " +
      'computational cache or registry, with its reason.\n',
  );
  process.exit(1);
}

console.log(
  `✅  API transport/cache check passed — fetch() appears only in ${[...ALLOWED.keys()].join(', ')}, and request caches use the shared primitive.`,
);

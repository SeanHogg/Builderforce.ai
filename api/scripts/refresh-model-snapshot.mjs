#!/usr/bin/env node
/**
 * Refresh the committed live-`/models` snapshot the model-drift guard reconciles
 * against (`api/src/application/llm/vendors/liveModels.snapshot.json`).
 *
 * WHY A SNAPSHOT AND NOT A LIVE FETCH IN CI. The guard has to be deterministic and
 * offline — a CI job that reaches out to four vendor APIs on every push is a build
 * that goes red when a vendor has a bad minute, and a guard that goes red for a
 * reason nobody caused gets disabled. So the network call lives here, in a command
 * a human runs, and the *guard* reads what that command committed.
 *
 * The teeth come from the pair: `modelDrift.test.ts` fails when the snapshot is
 * older than {@link MAX_SNAPSHOT_AGE_DAYS}, so the refresh cannot be skipped
 * indefinitely, and the moment it is run a retired vendor id turns the build red
 * instead of turning into a 404 at dispatch weeks later.
 *
 *   npm run models:refresh            # refresh every reachable source
 *   npm run models:refresh -- --check # fetch, diff against the snapshot, write nothing
 *
 * Sources that need a credential this machine does not hold are SKIPPED, and the
 * skip is recorded in the snapshot so the guard knows the difference between "this
 * vendor serves no such id" and "we have never been able to look".
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(import.meta.url), '..');
const snapshotPath = resolve(here, '..', 'src', 'application', 'llm', 'vendors', 'liveModels.snapshot.json');
const envPath = resolve(here, '..', '.env');

/** Read `api/.env` without adding a dependency — only for the optional keys below. */
function readEnvFile() {
  const out = {};
  if (!existsSync(envPath)) return out;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const fileEnv = readEnvFile();
const envVar = (name) => process.env[name] || fileEnv[name] || '';

/**
 * One source per vendor whose `/models` endpoint we can read. `namespaces` is the
 * set of catalog id prefixes this source is AUTHORITATIVE for — the guard only
 * judges an id when some source claims its namespace, so an unreachable vendor
 * (Cloudflare, Anthropic direct) is silently out of scope rather than falsely red.
 */
const SOURCES = [
  {
    id: 'openrouter',
    url: 'https://openrouter.ai/api/v1/models',
    /** OpenRouter ids are `<org>/<slug>`; the catalog carries no other `<org>/` form
     *  for these orgs, so the source is authoritative for the whole vendor module. */
    vendor: 'openrouter',
    headers: () => {
      const key = envVar('OPENROUTER_API_KEY');
      return key ? { Authorization: `Bearer ${key}`, Accept: 'application/json' } : { Accept: 'application/json' };
    },
    parse: (json) => Object.fromEntries(
      (json.data ?? []).map((m) => [m.id, {
        tools: Array.isArray(m.supported_parameters) ? m.supported_parameters.includes('tools') : null,
      }]),
    ),
  },
  {
    id: 'nvidia',
    url: 'https://integrate.api.nvidia.com/v1/models',
    vendor: 'nvidia',
    headers: () => {
      const key = envVar('NVIDIA_API_KEY');
      return key ? { Authorization: `Bearer ${key}`, Accept: 'application/json' } : { Accept: 'application/json' };
    },
    // NIM's list carries no capability metadata — `tools: null` means "unknown",
    // which the guard treats as "do not judge", never as "not tool-capable".
    parse: (json) => Object.fromEntries((json.data ?? []).map((m) => [m.id, { tools: null }])),
  },
];

const checkOnly = process.argv.includes('--check');

const previous = existsSync(snapshotPath) ? JSON.parse(readFileSync(snapshotPath, 'utf8')) : { sources: {} };
const next = { fetchedAt: new Date().toISOString(), sources: {} };
let changed = false;

for (const source of SOURCES) {
  let models = null;
  let error = null;
  try {
    const res = await fetch(source.url, { headers: source.headers() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    models = source.parse(await res.json());
    if (Object.keys(models).length === 0) throw new Error('empty model list');
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (models) {
    next.sources[source.id] = {
      vendor: source.vendor,
      url: source.url,
      reachable: true,
      models: Object.fromEntries(Object.entries(models).sort(([a], [b]) => a.localeCompare(b))),
    };
    const before = new Set(Object.keys(previous.sources?.[source.id]?.models ?? {}));
    const after = new Set(Object.keys(models));
    const gone = [...before].filter((id) => !after.has(id));
    const added = [...after].filter((id) => !before.has(id));
    if (gone.length || added.length) changed = true;
    console.log(`✅  ${source.id}: ${after.size} models (+${added.length} / -${gone.length})`);
    for (const id of gone) console.log(`      retired: ${id}`);
  } else {
    // Keep whatever we last managed to read rather than blanking the source — a
    // temporary outage must not silently widen the guard's blind spot.
    const kept = previous.sources?.[source.id];
    next.sources[source.id] = kept
      ? { ...kept, reachable: false, lastError: error }
      : { vendor: source.vendor, url: source.url, reachable: false, lastError: error, models: {} };
    console.log(`⚠️   ${source.id}: unreachable (${error}) — keeping the previous snapshot`);
  }
}

if (checkOnly) {
  console.log(changed ? '\n❌  Live vendor catalogs differ from the snapshot — run `npm run models:refresh`.' : '\n✅  Snapshot matches live.');
  process.exit(changed ? 1 : 0);
}

writeFileSync(snapshotPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
console.log(`\n📝  Wrote ${snapshotPath}`);

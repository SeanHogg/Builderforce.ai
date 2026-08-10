import { readFile } from 'node:fs/promises';

type StorageState = { cookies?: Array<{ name: string; value: string }>; origins?: Array<{ localStorage?: Array<{ name: string; value: string }> }> };
type Sample = { ok: boolean; status: number; latencyMs: number; revision?: number; error?: string };

const baseUrl = (process.env.BF_API_URL || process.env.BF_BASE_URL || '').replace(/\/$/, '');
const sessionId = process.env.BF_CANVAS_SESSION_ID || '';
const concurrency = Math.max(1, Number(process.env.BF_CANVAS_CONCURRENCY || 25));
const iterations = Math.max(1, Number(process.env.BF_CANVAS_ITERATIONS || 20));
const statePath = process.env.BF_STORAGE_STATE || '.auth/state.json';

if (!baseUrl || !sessionId) {
  throw new Error('Set BF_API_URL (or BF_BASE_URL) and BF_CANVAS_SESSION_ID. The script only exercises the explicitly named disposable Session.');
}

async function authHeaders(): Promise<Record<string, string>> {
  if (process.env.BF_ACCESS_TOKEN) return { authorization: `Bearer ${process.env.BF_ACCESS_TOKEN}` };
  const state = JSON.parse(await readFile(statePath, 'utf8')) as StorageState;
  const cookie = (state.cookies || []).map(({ name, value }) => `${name}=${value}`).join('; ');
  const token = (state.origins || []).flatMap((origin) => origin.localStorage || []).find((item) => /token/i.test(item.name))?.value;
  if (token) return { authorization: `Bearer ${token}` };
  if (cookie) return { cookie };
  throw new Error(`No authentication found in ${statePath}; set BF_ACCESS_TOKEN or BF_STORAGE_STATE.`);
}

const headers = { ...(await authHeaders()), 'content-type': 'application/json' };

async function sample(editor: number, iteration: number): Promise<Sample> {
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}/api/creation-sessions/${encodeURIComponent(sessionId)}/presence`, {
      method: 'POST', headers,
      body: JSON.stringify({ lastSeenRevision: 0, viewport: { x: editor * 8, y: iteration * 4, zoom: 1 }, cursor: { x: iteration, y: editor }, selection: [], typing: iteration % 4 === 0 }),
    });
    const body = await response.json().catch(() => ({})) as { revision?: number; message?: string };
    return { ok: response.ok, status: response.status, latencyMs: performance.now() - started, revision: body.revision, error: body.message };
  } catch (error) {
    return { ok: false, status: 0, latencyMs: performance.now() - started, error: error instanceof Error ? error.message : String(error) };
  }
}

const samples: Sample[] = [];
for (let iteration = 0; iteration < iterations; iteration += 1) {
  samples.push(...await Promise.all(Array.from({ length: concurrency }, (_, editor) => sample(editor, iteration))));
}
const latencies = samples.map((item) => item.latencyMs).sort((a, b) => a - b);
const percentile = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] || 0;
const revisions = samples.flatMap((item) => typeof item.revision === 'number' ? [item.revision] : []);
const failures = samples.filter((item) => !item.ok);
const report = {
  generatedAt: new Date().toISOString(), baseUrl, sessionId, concurrency, iterations,
  requests: samples.length, successes: samples.length - failures.length, failures: failures.length,
  successRate: samples.length ? (samples.length - failures.length) / samples.length : 0,
  latencyMs: { p50: percentile(.5), p95: percentile(.95), p99: percentile(.99), max: latencies.at(-1) || 0 },
  revision: { min: revisions.length ? Math.min(...revisions) : null, max: revisions.length ? Math.max(...revisions) : null },
  errors: failures.slice(0, 20),
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length || revisions.some((revision) => revision < 0)) process.exitCode = 1;


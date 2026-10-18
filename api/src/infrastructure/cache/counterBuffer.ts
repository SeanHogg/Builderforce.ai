import { reportCaughtError } from '../../application/observability/caughtErrorReporter';

/**
 * A write buffer for approximate hit counters, held in KV.
 *
 * WHY: a counter bumped inline (`downloads = downloads + 1` on a public GET) is a
 * Postgres write per view — it wakes the autosuspended Neon compute and spends WAL on
 * a number nobody needs to the unit. Deltas accumulate here instead and ONE sweep
 * applies them per kind in a single statement (see `application/counters/hitCounters`).
 *
 * Shape: one KV key per (kind, key) holding `{ n, t }` (pending delta, last hit time).
 * A bump is a read-modify-write, so two isolates bumping the same key at the same
 * instant can lose one increment. These are display counters, not ledgers — never
 * route a counter that gates billing, quota or money through here.
 *
 * Reads do NOT include pending deltas: the sweep runs every few minutes, so a displayed
 * count lags by that much, which is invisible against a counter that is only ever
 * shown rounded or compared in order of magnitude.
 */
const PREFIX = 'ctr:';
const STATE_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface CounterDelta {
  kind: string;
  key: string;
  /** Pending increments. */
  n: number;
  /** Epoch-ms of the latest hit — for `last_used_at` style columns. */
  t: number;
}

export interface CounterKv {
  AUTH_CACHE_KV?: KVNamespace;
}

const kvKey = (kind: string, key: string): string => `${PREFIX}${kind}|${encodeURIComponent(key)}`;

function parseKvKey(name: string): { kind: string; key: string } | null {
  if (!name.startsWith(PREFIX)) return null;
  const sep = name.indexOf('|');
  if (sep < 0) return null;
  try {
    return { kind: name.slice(PREFIX.length, sep), key: decodeURIComponent(name.slice(sep + 1)) };
  } catch {
    return null;
  }
}

function parseValue(raw: string | null): { n: number; t: number } | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { n?: unknown; t?: unknown };
    return typeof v.n === 'number' && typeof v.t === 'number' ? { n: v.n, t: v.t } : null;
  } catch {
    return null;
  }
}

/** Add `n` to the pending delta. Returns false when there is no KV to buffer in, so the
 *  caller can apply the write directly instead of dropping it. */
export async function bufferCounter(env: CounterKv, kind: string, key: string, n: number, atMs: number): Promise<boolean> {
  const kv = env.AUTH_CACHE_KV;
  if (!kv) return false;
  try {
    const name = kvKey(kind, key);
    const prev = parseValue(await kv.get(name));
    await kv.put(name, JSON.stringify({ n: (prev?.n ?? 0) + n, t: Math.max(prev?.t ?? 0, atMs) }), { expirationTtl: STATE_TTL_SECONDS });
    return true;
  } catch (error) {
    reportCaughtError(error, { source: 'infrastructure/cache/counterBuffer.ts', operation: 'bufferCounter', level: 'warning' });
    return false;
  }
}

/**
 * Claim up to `limit` pending deltas: each key is read then DELETED before it is
 * returned, so a concurrent drain cannot apply it twice. If applying fails, hand the
 * deltas back to {@link requeueCounters}.
 */
export async function drainCounters(env: CounterKv, limit = 500): Promise<CounterDelta[]> {
  const kv = env.AUTH_CACHE_KV;
  if (!kv) return [];
  const out: CounterDelta[] = [];
  try {
    const listed = await kv.list({ prefix: PREFIX, limit });
    await Promise.all(listed.keys.map(async ({ name }) => {
      const id = parseKvKey(name);
      if (!id) return;
      const value = parseValue(await kv.get(name));
      await kv.delete(name);
      if (value && value.n > 0) out.push({ ...id, n: value.n, t: value.t });
    }));
  } catch (error) {
    reportCaughtError(error, { source: 'infrastructure/cache/counterBuffer.ts', operation: 'drainCounters', level: 'warning' });
  }
  return out;
}

/** Put claimed-but-unapplied deltas back, merged with anything bumped meanwhile. */
export async function requeueCounters(env: CounterKv, deltas: readonly CounterDelta[]): Promise<void> {
  await Promise.all(deltas.map((d) => bufferCounter(env, d.kind, d.key, d.n, d.t)));
}

/**
 * The untrusted edge of ingest: the per-IP budget and turning a beacon body into a
 * parsed chunk (PRD 33 §3.3 step 2, §6 abuse ceilings).
 *
 * The recorder gzips with `CompressionStream` and may not be able to say so — a
 * `sendBeacon` cannot set `Content-Encoding` — so gzip is recognised by its magic
 * bytes. Inflation is bounded: a 512 KB body that inflates past
 * {@link MAX_INFLATED_BYTES} is a bomb, not a recording.
 */

import { parseReplayChunk, REPLAY_LIMITS, type ReplayChunk } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
// Gzip detection/inflation is shared with the container-op edge (infrastructure/http).
import { gunzip, isGzip } from '../../infrastructure/http/gzipBody';

/** Chunks one IP may send per UTC day before ingest stops listening (fail-open on KV errors). */
export const REPLAY_IP_DAILY_CHUNKS = 3_000;
/** Largest inflated chunk accepted. */
export const MAX_INFLATED_BYTES = 8 * 1024 * 1024;

const IP_PREFIX = 'replay:ingest:ip:';

/**
 * The per-IP daily ceiling — `VisitorEventService.withinIpBudget`'s shape on its own
 * key prefix, so the two public write paths have separate budgets.
 */
export async function withinReplayIpBudget(env: Env | undefined, ip: string | null): Promise<boolean> {
  const kv = env?.AUTH_CACHE_KV;
  if (!kv || !ip) return true;
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const key = `${IP_PREFIX}${day}:${ip}`;
  try {
    const current = Number((await kv.get(key)) ?? '0');
    if (current >= REPLAY_IP_DAILY_CHUNKS) return false;
    await kv.put(key, String(current + 1), { expirationTtl: 86_400 });
  } catch {
    // KV is unavailable, not hostile. Dropping real telemetry to protect a counter
    // would be the wrong trade.
    return true;
  }
  return true;
}

export interface DecodedChunk {
  chunk: ReplayChunk;
  /** The body as it should be stored: the received gzip, or null when it arrived plain. */
  gzipped: Uint8Array | null;
  /** The plain JSON bytes. */
  plain: Uint8Array;
}

/**
 * Size-check, inflate, parse and validate one beacon body. Null for anything that
 * is not a valid §3.4 chunk — never a throw (a corrupt gzip stream is a null too).
 */
export async function decodeChunkBody(body: ArrayBuffer, _contentEncoding: string | null): Promise<DecodedChunk | null> {
  if (body.byteLength === 0 || body.byteLength > REPLAY_LIMITS.maxChunkBytes) return null;
  const bytes = new Uint8Array(body);
  let plain: Uint8Array | null;
  let gzipped: Uint8Array | null = null;
  try {
    if (isGzip(bytes)) {
      gzipped = bytes;
      plain = await gunzip(bytes, MAX_INFLATED_BYTES);
    } else {
      plain = bytes;
    }
    if (!plain) return null;
    const chunk = parseReplayChunk(JSON.parse(new TextDecoder().decode(plain)));
    return chunk ? { chunk, gzipped, plain } : null;
  } catch {
    // Not gzip after all, or not JSON: an invalid beacon, answered like every other.
    return null;
  }
}

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

/**
 * Gzip is decided by the MAGIC BYTES. `Content-Encoding` is only a hint: a beacon
 * cannot send it, and an edge that already inflated the body leaves it set on JSON —
 * trusting the header would drop a valid chunk.
 */
function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function readBounded(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  const body = new Response(bytes).body;
  if (!body) return null;
  return readBounded(body.pipeThrough(new DecompressionStream('gzip')), MAX_INFLATED_BYTES);
}

/** Gzip `bytes` (a kept chunk that arrived uncompressed is stored compressed). */
export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const body = new Response(bytes).body;
  if (!body) return new Uint8Array(0);
  return new Uint8Array(await new Response(body.pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
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
      plain = await gunzip(bytes);
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

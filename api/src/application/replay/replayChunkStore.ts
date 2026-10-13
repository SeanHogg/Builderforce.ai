/**
 * Recording bytes in R2 (`UPLOADS`), under `replay/` (PRD 33 D2/D18).
 *
 *   replay/t<tenantId>/<siteId>/<yyyy-mm-dd>/<recordingId>/<seq 6-digit>.ndjson.gz
 *   replay/t<tenantId>/<siteId>/<yyyy-mm-dd>/<recordingId>/marks.json
 *
 * Each chunk object is ONE gzip NDJSON line: the parsed-and-accepted chunk exactly as
 * the recorder sent it (header, marks and rrweb `events`), stored compressed so the
 * stored size is the billed size. The day is the recording's START day, so every
 * chunk of a recording sits under one prefix even when the visit crosses midnight —
 * and the retention sweep can drop a whole day per site by prefix.
 */

import type { ReplayMark } from '@builderforce/interaction-contract';
import type { Env } from '../../env';

export const REPLAY_PREFIX = 'replay/';

/** Where one recording's objects live. */
export interface RecordingLocation {
  tenantId: number;
  siteId: string;
  recordingId: string;
  startedAt: Date;
}

function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function sitePrefix(tenantId: number, siteId: string): string {
  return `${REPLAY_PREFIX}t${tenantId}/${siteId}/`;
}

export function recordingPrefix(loc: RecordingLocation): string {
  return `${sitePrefix(loc.tenantId, loc.siteId)}${utcDay(loc.startedAt)}/${loc.recordingId}/`;
}

export function chunkKey(loc: RecordingLocation, seq: number): string {
  return `${recordingPrefix(loc)}${String(Math.max(0, Math.trunc(seq))).padStart(6, '0')}.ndjson.gz`;
}

export function marksKey(loc: RecordingLocation): string {
  return `${recordingPrefix(loc)}marks.json`;
}

function bucket(env: Env | undefined): R2Bucket | null {
  return env?.UPLOADS ?? null;
}

function requireBucket(env: Env | undefined): R2Bucket {
  const found = bucket(env);
  if (!found) throw new Error('UPLOADS bucket is not bound; replay recordings cannot be stored');
  return found;
}

/** Store one compressed chunk (idempotent: the key is the recording + seq). */
export async function putChunk(env: Env, loc: RecordingLocation, seq: number, gzipBytes: ArrayBuffer | Uint8Array): Promise<void> {
  await requireBucket(env).put(chunkKey(loc, seq), gzipBytes, {
    httpMetadata: { contentType: 'application/gzip' },
  });
}

/** Whether this chunk was already stored — how a retried chunk is recognised. */
export async function chunkExists(env: Env, loc: RecordingLocation, seq: number): Promise<boolean> {
  const head = await requireBucket(env).head(chunkKey(loc, seq));
  return head !== null;
}

/** The stored gzip bytes, or null when absent (never decompressed here). */
export async function getChunk(env: Env, loc: RecordingLocation, seq: number): Promise<ArrayBuffer | null> {
  const found = bucket(env);
  if (!found) return null;
  const object = await found.get(chunkKey(loc, seq));
  return object ? object.arrayBuffer() : null;
}

/** The recording's timeline; empty when none was written yet. */
export async function getMarks(env: Env, loc: RecordingLocation): Promise<ReplayMark[]> {
  const found = bucket(env);
  if (!found) return [];
  const object = await found.get(marksKey(loc));
  if (!object) return [];
  try {
    const parsed: unknown = JSON.parse(await object.text());
    return Array.isArray(parsed) ? (parsed as ReplayMark[]) : [];
  } catch {
    // A torn write reads as an empty timeline; the next chunk rewrites it whole.
    return [];
  }
}

export async function putMarks(env: Env, loc: RecordingLocation, marks: readonly ReplayMark[]): Promise<void> {
  await requireBucket(env).put(marksKey(loc), JSON.stringify(marks), {
    httpMetadata: { contentType: 'application/json' },
  });
}

/** Every key under `prefix`, page by page (R2 lists at most 1,000 per call). */
async function listKeys(store: R2Bucket, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const listed = await store.list({ prefix, cursor });
    for (const object of listed.objects) keys.push(object.key);
    cursor = listed.truncated ? (listed as { cursor?: string }).cursor : undefined;
  } while (cursor);
  return keys;
}

/** The immediate "directories" under `prefix`. */
async function listPrefixes(store: R2Bucket, prefix: string): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const listed = await store.list({ prefix, delimiter: '/', cursor });
    out.push(...listed.delimitedPrefixes);
    cursor = listed.truncated ? (listed as { cursor?: string }).cursor : undefined;
  } while (cursor);
  return out;
}

async function deletePrefix(store: R2Bucket, prefix: string): Promise<number> {
  const keys = await listKeys(store, prefix);
  for (let i = 0; i < keys.length; i += 1_000) await store.delete(keys.slice(i, i + 1_000));
  return keys.length;
}

/** Delete one recording's chunks and timeline. Returns objects removed. */
export async function deleteRecording(env: Env, loc: RecordingLocation): Promise<number> {
  const found = bucket(env);
  if (!found) return 0;
  return deletePrefix(found, recordingPrefix(loc));
}

/** A site's retention cutoff; recordings STARTED before it are deleted. */
export type CutoffFor = (tenantId: number, siteId: string) => Date;

/**
 * The R2 half of retention: drop every day-prefix older than its site's cutoff.
 * Walks `replay/t<tenant>/<site>/<day>/` and deletes whole days, so the sweep costs
 * list calls per site and day rather than per object. Returns objects removed.
 */
export async function deleteOlderThan(env: Env, cutoff: Date | CutoffFor): Promise<number> {
  const found = bucket(env);
  if (!found) return 0;
  const cutoffFor: CutoffFor = typeof cutoff === 'function' ? cutoff : () => cutoff;
  let removed = 0;
  for (const tenantPrefix of await listPrefixes(found, REPLAY_PREFIX)) {
    const tenantId = Number(/\/t(\d+)\/$/.exec(tenantPrefix)?.[1]);
    if (!Number.isInteger(tenantId) || tenantId <= 0) continue;
    for (const sitePrefixKey of await listPrefixes(found, tenantPrefix)) {
      const siteId = sitePrefixKey.slice(tenantPrefix.length, -1);
      const cutoffDay = utcDay(cutoffFor(tenantId, siteId));
      for (const dayPrefix of await listPrefixes(found, sitePrefixKey)) {
        const day = dayPrefix.slice(sitePrefixKey.length, -1);
        // Lexical compare is a date compare for YYYY-MM-DD.
        if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day < cutoffDay) removed += await deletePrefix(found, dayPrefix);
      }
    }
  }
  return removed;
}

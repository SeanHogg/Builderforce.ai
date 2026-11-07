/**
 * knowledgeBundles — extracted bodies stored as ONE content-addressed R2 object per pack (PRD 41 A11 rule 4a).
 *
 *   knowledge/{tenant}/extracted-bundles/{sha256 of the bytes}
 *
 * The object is the bodies' JSON laid end to end; `knowledge_extracted_index` records each body's byte range. The
 * key is the content, so a retried pack writes the same object and an orphan left by a failed transaction is
 * harmless (swept by age, see `knowledgeSweep.ts`). A read is a ranged GET: ranges of one bundle that sit close
 * together are fetched as one window, so reading thousands of bodies costs a handful of subrequests.
 */
import { sha256Hex, type Extracted } from '@seanhogg/builderforce-memory/knowledge';
import type { ExtractedLoc } from './knowledgeLedger';

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();
/** Ranges of one bundle closer than this are one GET. */
const WINDOW_GAP = 64 * 1024;
/** A window never grows past this. */
const WINDOW_MAX = 4 * 1024 * 1024;
const PARALLEL_WINDOWS = 4;

export const bundlePrefix = (tenantId: number): string => `knowledge/${tenantId}/extracted-bundles/`;
export const bundleKey = (tenantId: number, digest: string): string => `${bundlePrefix(tenantId)}${digest}`;

/**
 * A hash's stored body is the UNION by `sourceRef` of what is stored and what arrived (the arrival wins for the same
 * ref), so two roots that share a content hash never evict each other's entries. The ONE merge: pack sync and the
 * legacy per-hash upload both use it.
 */
export function mergeBodies(stored: readonly Extracted[] | undefined, arrival: readonly Extracted[]): Extracted[] {
  const arrived = new Set(arrival.map((e) => e.sourceRef));
  return [...(stored ?? []).filter((e) => !arrived.has(e.sourceRef)), ...arrival];
}

export interface Bundle {
  key: string;
  bytes: Uint8Array;
  locs: ExtractedLoc[];
}

export function buildBundle(tenantId: number, bodies: ReadonlyArray<{ hash: string; entries: readonly Extracted[] }>): Bundle {
  const parts = bodies.map((b) => ENCODER.encode(JSON.stringify(b.entries)));
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  const locs: ExtractedLoc[] = [];
  let at = 0;
  parts.forEach((p, i) => {
    bytes.set(p, at);
    locs.push({ hash: bodies[i]!.hash, bundleKey: '', byteOffset: at, byteLength: p.length, sourceRefs: bodies[i]!.entries.map((e) => e.sourceRef) });
    at += p.length;
  });
  const key = bundleKey(tenantId, sha256Hex(bytes));
  for (const l of locs) l.bundleKey = key;
  return { key, bytes, locs };
}

/** The bodies at `locs`, by hash. A range that cannot be read or parsed is left out (the caller falls back or treats it as absent). */
export async function readBundled(bucket: R2Bucket, locs: readonly ExtractedLoc[]): Promise<Map<string, Extracted[]>> {
  const out = new Map<string, Extracted[]>();
  const byBundle = new Map<string, ExtractedLoc[]>();
  for (const l of locs) {
    const list = byBundle.get(l.bundleKey);
    if (list) list.push(l); else byBundle.set(l.bundleKey, [l]);
  }
  const windows: Array<{ key: string; start: number; end: number; locs: ExtractedLoc[] }> = [];
  for (const [key, list] of byBundle) {
    list.sort((a, b) => a.byteOffset - b.byteOffset);
    let cur: (typeof windows)[number] | undefined;
    for (const l of list) {
      const end = l.byteOffset + l.byteLength;
      if (cur && l.byteOffset - cur.end <= WINDOW_GAP && end - cur.start <= WINDOW_MAX) { cur.end = Math.max(cur.end, end); cur.locs.push(l); }
      else { cur = { key, start: l.byteOffset, end, locs: [l] }; windows.push(cur); }
    }
  }
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < windows.length) {
      const w = windows[next++]!;
      const obj = await bucket.get(w.key, { range: { offset: w.start, length: w.end - w.start } });
      if (!obj) continue;
      const buf = new Uint8Array(await obj.arrayBuffer());
      for (const l of w.locs) {
        try {
          const slice = buf.subarray(l.byteOffset - w.start, l.byteOffset - w.start + l.byteLength);
          out.set(l.hash, JSON.parse(DECODER.decode(slice)) as Extracted[]);
        } catch { /* an unreadable range is absent */ }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_WINDOWS, windows.length) }, lane));
  return out;
}

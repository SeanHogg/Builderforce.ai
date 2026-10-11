/**
 * Replay visit / chunk wire types and the ingest parser.
 *
 * The recorder, the API ingest and the Insights player all speak this
 * shape. `parseReplayChunk` is the gate: invalid input is null, never a
 * throw, so a bad beacon cannot take the Worker down.
 */

export const REPLAY_LIMITS = {
  /** Bytes of JSON the ingest will accept for one chunk. */
  maxChunkBytes: 64 * 1024,
  /** Events inside one chunk. */
  maxEventsPerChunk: 500,
  /** How often the recorder flushes a chunk. */
  flushIntervalMs: 5_000,
  /** A visit longer than this is split. */
  maxVisitMs: 30 * 60 * 1_000,
  /** Per-visit cap on timeline marks. Clicks drop first once this is hit. */
  maxMarksPerVisit: 300,
  /** Per-visit cap on custom tag keys. Last write wins. */
  maxTagsPerVisit: 20,
} as const;

/**
 * A meaningful moment the recorder already derived. Ingest copies these;
 * it does not re-detect rage / dead / quick-back / error.
 *
 * `kind` is wider than the frustration `MarkKind` set: page, click and custom
 * `event` sit beside rage/dead/quickback/error so filters and the player share
 * one list.
 */
export interface ReplayMark {
  kind: string;
  key: string;
  label?: string;
  /** Offset in ms from visit start. */
  atMs: number;
}

export interface ReplayViewport {
  w: number;
  h: number;
}

export interface ReplayVisitMeta {
  visitId: string;
  siteId: string;
  startedAt: number;
  releaseKey: string;
  path: string;
  viewport: ReplayViewport;
  dpr?: number;
  locale?: string;
  ua?: string;
}

export interface ReplayChunkEvent {
  t: number;
  kind: string;
  [extra: string]: unknown;
}

export interface ReplayChunk {
  visitId: string;
  seq: number;
  events: ReplayChunkEvent[];
  /** Recorder-derived timeline marks, copied by ingest. */
  marks?: ReplayMark[];
  /** Custom tags; last write wins per key, capped at {@link REPLAY_LIMITS.maxTagsPerVisit}. */
  tags?: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseMarks(raw: unknown): ReplayMark[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ReplayMark[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return null;
    if (typeof item.kind !== 'string' || item.kind.length === 0) return null;
    if (typeof item.key !== 'string') return null;
    if (typeof item.atMs !== 'number' || !Number.isFinite(item.atMs) || item.atMs < 0) return null;
    const mark: ReplayMark = { kind: item.kind, key: item.key, atMs: item.atMs };
    if (typeof item.label === 'string') mark.label = item.label;
    out.push(mark);
  }
  return out;
}

function parseTags(raw: unknown): Record<string, string> | null {
  if (!isRecord(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length > REPLAY_LIMITS.maxTagsPerVisit) return null;
  const out: Record<string, string> = {};
  for (const key of keys) {
    if (key.length === 0 || key.length > 64) return null;
    const value = raw[key];
    if (typeof value !== 'string' || value.length > 200) return null;
    out[key] = value;
  }
  return out;
}

function parseViewport(raw: unknown): ReplayViewport | null {
  if (!isRecord(raw)) return null;
  const w = raw.w;
  const h = raw.h;
  if (typeof w !== 'number' || typeof h !== 'number' || !Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (w <= 0 || h <= 0) return null;
  return { w, h };
}

export function parseReplayVisitMeta(raw: unknown): ReplayVisitMeta | null {
  if (!isRecord(raw)) return null;
  const visitId = raw.visitId;
  const siteId = raw.siteId;
  const startedAt = raw.startedAt;
  const releaseKey = raw.releaseKey;
  const path = raw.path;
  const viewport = parseViewport(raw.viewport);
  if (typeof visitId !== 'string' || visitId.length === 0) return null;
  if (typeof siteId !== 'string' || siteId.length === 0) return null;
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt) || startedAt < 0) return null;
  if (typeof releaseKey !== 'string' || releaseKey.length === 0) return null;
  if (typeof path !== 'string') return null;
  if (!viewport) return null;
  const meta: ReplayVisitMeta = { visitId, siteId, startedAt, releaseKey, path, viewport };
  if (typeof raw.dpr === 'number' && Number.isFinite(raw.dpr)) meta.dpr = raw.dpr;
  if (typeof raw.locale === 'string') meta.locale = raw.locale;
  if (typeof raw.ua === 'string') meta.ua = raw.ua;
  return meta;
}

export function parseReplayChunk(raw: unknown): ReplayChunk | null {
  if (!isRecord(raw)) return null;
  const visitId = raw.visitId;
  const seq = raw.seq;
  const events = raw.events;
  if (typeof visitId !== 'string' || visitId.length === 0) return null;
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) return null;
  if (!Array.isArray(events)) return null;
  if (events.length > REPLAY_LIMITS.maxEventsPerChunk) return null;
  const parsed: ReplayChunkEvent[] = [];
  for (const item of events) {
    if (!isRecord(item)) return null;
    if (typeof item.t !== 'number' || !Number.isFinite(item.t) || item.t < 0) return null;
    if (typeof item.kind !== 'string' || item.kind.length === 0) return null;
    parsed.push(item as ReplayChunkEvent);
  }
  const chunk: ReplayChunk = { visitId, seq, events: parsed };
  if (raw.marks !== undefined) {
    const marks = parseMarks(raw.marks);
    if (!marks) return null;
    chunk.marks = marks;
  }
  if (raw.tags !== undefined) {
    const tags = parseTags(raw.tags);
    if (!tags) return null;
    chunk.tags = tags;
  }
  return chunk;
}

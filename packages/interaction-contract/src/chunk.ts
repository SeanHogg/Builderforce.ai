/**
 * The replay chunk — the one wire shape between the recorder and ingest (PRD 33 §3.4).
 *
 * Every session sends chunks: the header and the marks always, the rrweb
 * `events` only while the session is KEPT. `parseReplayChunk` is the gate:
 * anything invalid is null, never a throw, so a bad beacon cannot take the
 * Worker down.
 */

import type { ReplayDeviceClass, ReplayKeepReason } from './api';
import { GRID, isMarkKind, type MarkKind } from './kinds';

export const REPLAY_LIMITS = {
  /** Bytes the ingest accepts for one chunk body. */
  maxChunkBytes: 512_000,
  /** rrweb events inside one chunk. */
  maxEventsPerChunk: 5_000,
  /** How often the recorder flushes while the page is visible. */
  flushMs: 5_000,
  /** Marks per visit; the recorder stops adding marks past this. */
  maxMarksPerVisit: 300,
  /** Custom tag keys per visit. */
  maxTagsPerVisit: 20,
  /** The in-memory ring buffer an unkept session holds, flushed when it becomes kept. */
  bufferMs: 60_000,
} as const;

/**
 * Idle gap after which the next event starts a NEW visit. The recorder, the
 * hosted `visitorJourney` and ingest all pin this so "came back" means the
 * same thing everywhere.
 */
export const VISIT_IDLE_MS = 30 * 60 * 1_000;

/** Visitor / visit id alphabet the recorder mints and ingest accepts. */
export const VISITOR_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** Why a session's recording is kept. One definition: `ReplayKeepReason` in `api.ts`. */
export type KeepReason = ReplayKeepReason;

export const KEEP_REASONS: readonly KeepReason[] = ['sample', 'frustration', 'error', 'goal', 'tag', 'manual'];

/** String caps the parser enforces (and the recorder truncates to). */
export const REPLAY_STRING_LIMITS = {
  markKey: 400,
  markLabel: 120,
  markHref: 200,
  release: 64,
  recorderVersion: 32,
  browser: 32,
  os: 32,
  referrer: 200,
  variant: 64,
  tagKey: 64,
  tagValue: 200,
  identifyId: 128,
  traitKey: 64,
  traitValue: 200,
  maxTraits: 20,
} as const;

/**
 * A meaningful moment the recorder already derived. Ingest copies these; it
 * never re-detects rage / dead / quick back / error.
 *
 * - `page`: `key` = route template (`routeTemplate`).
 * - `click` / `rage` / `dead`: `key` = selector (`deriveSelector`), `label`,
 *   `gx`/`gy` = grid cell (`toGridCell`), `href` = the sanitised link target
 *   (path only; `mailto:` / `tel:` without the address).
 * - `quickback`, `excessive_scroll`: `key` = route template.
 * - `error`: `key` = error fingerprint, `label` = message (≤120 chars).
 * - `event`: `key` = the custom event name.
 * - `scroll`: `key` = route template, `value` = max depth decile 0..9.
 * - `vital`: `key` = `LCP` | `CLS` | `INP`, `value` in the `VITAL_BUCKETS`
 *   unit (ms; CLS × 1000).
 */
export interface ReplayMark {
  kind: MarkKind;
  key: string;
  label?: string;
  /** Offset in ms from the visit start. */
  atMs: number;
  gx?: number;
  gy?: number;
  value?: number;
  href?: string;
}

export interface ReplayDevice {
  class: ReplayDeviceClass;
  /** Viewport size in CSS px. */
  w: number;
  h: number;
  /** Document scroll size, when known. */
  docW?: number;
  docH?: number;
}

export interface ReplayIdentify {
  id: string;
  traits?: Record<string, string>;
}

export interface ReplayChunk {
  v: 1;
  visitorId: string;
  visitId: string;
  /** Per visit, from 0; continues across page loads of the same visit. */
  seq: number;
  /** Visit start, epoch ms. */
  startedAt: number;
  /** Release key (`data-release`, hosted token, app version or asset fingerprint); '' when unknown. */
  release: string;
  recorderVersion: string;
  device: ReplayDevice;
  browser?: string;
  os?: string;
  /** Referrer host (never the full URL). */
  referrer?: string;
  /** The visitor id was minted on this visit. */
  newVisitor: boolean;
  /** Null while the session is not kept; then `events` is absent. */
  keep: KeepReason | null;
  /** 1 / keepRate for a sampled recording, 1 for a triggered one. */
  sampleWeight: number;
  marks: ReplayMark[];
  /** Sticky custom tags, last write wins. */
  tags?: Record<string, string>;
  identify?: ReplayIdentify;
  variant?: string;
  /** rrweb events — only on a kept session. */
  events?: unknown[];
  /** The visit ended (`BFReplay.stop()`). */
  end?: boolean;
  /** Active time so far in the visit (idle gaps > 30 s excluded), cumulative. */
  activeMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function boundedString(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= max && (allowEmpty || value.length > 0);
}

function isGridIndex(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < GRID;
}

const DEVICE_CLASSES: readonly ReplayDeviceClass[] = ['desktop', 'tablet', 'phone'];

const L = REPLAY_STRING_LIMITS;

function parseMark(raw: unknown): ReplayMark | null {
  if (!isRecord(raw)) return null;
  if (!isMarkKind(raw.kind)) return null;
  if (!boundedString(raw.key, L.markKey, true)) return null;
  if (!isFiniteNumber(raw.atMs) || raw.atMs < 0) return null;
  const mark: ReplayMark = { kind: raw.kind, key: raw.key, atMs: raw.atMs };
  if (raw.label !== undefined) {
    if (!boundedString(raw.label, L.markLabel, true)) return null;
    mark.label = raw.label;
  }
  if (raw.gx !== undefined || raw.gy !== undefined) {
    if (!isGridIndex(raw.gx) || !isGridIndex(raw.gy)) return null;
    mark.gx = raw.gx;
    mark.gy = raw.gy;
  }
  if (raw.value !== undefined) {
    if (!isFiniteNumber(raw.value)) return null;
    mark.value = raw.value;
  }
  if (raw.href !== undefined) {
    if (!boundedString(raw.href, L.markHref, true)) return null;
    mark.href = raw.href;
  }
  return mark;
}

function parseStringMap(raw: unknown, maxKeys: number, maxKey: number, maxValue: number): Record<string, string> | null {
  if (!isRecord(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length > maxKeys) return null;
  const out: Record<string, string> = {};
  for (const key of keys) {
    if (key.length === 0 || key.length > maxKey) return null;
    const value = raw[key];
    if (!boundedString(value, maxValue, true)) return null;
    out[key] = value;
  }
  return out;
}

function parseDevice(raw: unknown): ReplayDevice | null {
  if (!isRecord(raw)) return null;
  const cls = raw.class;
  if (typeof cls !== 'string' || !(DEVICE_CLASSES as readonly string[]).includes(cls)) return null;
  if (!isFiniteNumber(raw.w) || raw.w < 0 || !isFiniteNumber(raw.h) || raw.h < 0) return null;
  const device: ReplayDevice = { class: cls as ReplayDeviceClass, w: raw.w, h: raw.h };
  if (raw.docW !== undefined) {
    if (!isFiniteNumber(raw.docW) || raw.docW < 0) return null;
    device.docW = raw.docW;
  }
  if (raw.docH !== undefined) {
    if (!isFiniteNumber(raw.docH) || raw.docH < 0) return null;
    device.docH = raw.docH;
  }
  return device;
}

function parseIdentify(raw: unknown): ReplayIdentify | null {
  if (!isRecord(raw)) return null;
  if (!boundedString(raw.id, L.identifyId)) return null;
  const identify: ReplayIdentify = { id: raw.id };
  if (raw.traits !== undefined) {
    const traits = parseStringMap(raw.traits, L.maxTraits, L.traitKey, L.traitValue);
    if (!traits) return null;
    identify.traits = traits;
  }
  return identify;
}

/** Optional bounded string fields of the header, copied when valid. */
const OPTIONAL_STRINGS = [
  ['browser', L.browser],
  ['os', L.os],
  ['referrer', L.referrer],
  ['variant', L.variant],
] as const;

/**
 * Validate an untrusted chunk. Null on anything invalid: wrong version, ids
 * outside `VISITOR_ID_PATTERN`, negative or fractional `seq`, too many events
 * / marks / tags, over-long strings, unknown mark kinds or keep reasons.
 */
export function parseReplayChunk(raw: unknown): ReplayChunk | null {
  if (!isRecord(raw)) return null;
  if (raw.v !== 1) return null;
  if (typeof raw.visitorId !== 'string' || !VISITOR_ID_PATTERN.test(raw.visitorId)) return null;
  if (typeof raw.visitId !== 'string' || !VISITOR_ID_PATTERN.test(raw.visitId)) return null;
  if (!Number.isInteger(raw.seq) || (raw.seq as number) < 0) return null;
  if (!isFiniteNumber(raw.startedAt) || raw.startedAt < 0) return null;
  if (!boundedString(raw.release, L.release, true)) return null;
  if (!boundedString(raw.recorderVersion, L.recorderVersion, true)) return null;
  const device = parseDevice(raw.device);
  if (!device) return null;
  if (typeof raw.newVisitor !== 'boolean') return null;
  const keep = raw.keep;
  if (keep !== null && !(typeof keep === 'string' && (KEEP_REASONS as readonly string[]).includes(keep))) return null;
  if (!isFiniteNumber(raw.sampleWeight) || raw.sampleWeight <= 0) return null;
  if (!Array.isArray(raw.marks) || raw.marks.length > REPLAY_LIMITS.maxMarksPerVisit) return null;
  const marks: ReplayMark[] = [];
  for (const item of raw.marks) {
    const mark = parseMark(item);
    if (!mark) return null;
    marks.push(mark);
  }

  const chunk: ReplayChunk = {
    v: 1,
    visitorId: raw.visitorId,
    visitId: raw.visitId,
    seq: raw.seq as number,
    startedAt: raw.startedAt,
    release: raw.release,
    recorderVersion: raw.recorderVersion,
    device,
    newVisitor: raw.newVisitor,
    keep: keep as KeepReason | null,
    sampleWeight: raw.sampleWeight,
    marks,
  };

  for (const [field, max] of OPTIONAL_STRINGS) {
    const value = raw[field];
    if (value === undefined) continue;
    if (!boundedString(value, max, true)) return null;
    chunk[field] = value;
  }
  if (raw.tags !== undefined) {
    const tags = parseStringMap(raw.tags, REPLAY_LIMITS.maxTagsPerVisit, L.tagKey, L.tagValue);
    if (!tags) return null;
    chunk.tags = tags;
  }
  if (raw.identify !== undefined) {
    const identify = parseIdentify(raw.identify);
    if (!identify) return null;
    chunk.identify = identify;
  }
  if (raw.events !== undefined) {
    if (!Array.isArray(raw.events) || raw.events.length > REPLAY_LIMITS.maxEventsPerChunk) return null;
    // Events of an unkept session are never accepted (they would be billed).
    if (chunk.keep === null) return null;
    chunk.events = raw.events;
  }
  if (raw.end !== undefined) {
    if (typeof raw.end !== 'boolean') return null;
    chunk.end = raw.end;
  }
  if (raw.activeMs !== undefined) {
    if (!isFiniteNumber(raw.activeMs) || raw.activeMs < 0) return null;
    chunk.activeMs = raw.activeMs;
  }
  return chunk;
}

/** The Core Web Vitals the recorder reports as `vital` marks. */
export const VITAL_METRICS = ['LCP', 'CLS', 'INP'] as const;

export type VitalMetric = (typeof VITAL_METRICS)[number];

/**
 * Ascending histogram upper bounds per metric (`replay_vitals_daily.bucket`).
 * LCP / INP in ms, CLS × 1000. A value above the last bound falls in the
 * overflow bucket `bounds.length`.
 */
export const VITAL_BUCKETS: Readonly<Record<VitalMetric, readonly number[]>> = {
  LCP: [100, 200, 500, 1_000, 1_500, 2_000, 2_500, 3_000, 4_000, 5_000, 7_500, 10_000],
  INP: [50, 100, 150, 200, 300, 500, 750, 1_000, 2_000, 5_000, 10_000],
  CLS: [10, 25, 50, 100, 150, 250, 500, 1_000],
};

/** Bucket index of a value: the first bound ≥ value, else the overflow bucket. */
export function vitalBucket(bounds: readonly number[], value: number): number {
  for (let i = 0; i < bounds.length; i++) {
    if (value <= bounds[i]!) return i;
  }
  return bounds.length;
}

/**
 * p75 from a histogram: the upper bound of the bucket holding the 75th
 * percentile sample. `counts[i]` is the count of bucket `i`; an overflow
 * count at `counts[bounds.length]` reads as the last bound. Null when empty.
 */
export function p75FromHistogram(buckets: readonly number[], counts: readonly number[]): number | null {
  let total = 0;
  for (const n of counts) total += n > 0 ? n : 0;
  if (total === 0 || buckets.length === 0) return null;
  const target = total * 0.75;
  let seen = 0;
  for (let i = 0; i < counts.length; i++) {
    const n = counts[i]!;
    seen += n > 0 ? n : 0;
    if (seen >= target) return buckets[Math.min(i, buckets.length - 1)]!;
  }
  return buckets[buckets.length - 1]!;
}

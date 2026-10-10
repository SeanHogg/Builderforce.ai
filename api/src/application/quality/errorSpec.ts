import { sha256Hex } from '../../domain/shared/hash';
/**
 * The canonical error-event spec — Builderforce's own product-quality wire format.
 *
 * Every ingest path (native SDK, server POST, OTLP, and the Sentry/PostHog/
 * LogRocket adapters) translates INTO this one shape so the rest of the Quality
 * pillar (grouping, dashboard, fix loop) is source-agnostic. We own the spec;
 * adapters are the structural translation seam (see adapters.ts).
 *
 * Pure module — no IO, no DB. Safe to unit-test and to share with the browser SDK
 * (the SDK posts exactly `NormalizedErrorEvent`s via the `native` adapter).
 */

/** Severity levels, normalized across every source. */
export type ErrorLevel = 'fatal' | 'error' | 'warning' | 'info';

/** One parsed stack frame (best-effort — sources vary in what they provide). */
export interface StackFrame {
  function?: string | null;
  file?: string | null;
  line?: number | null;
  column?: number | null;
}

/** The canonical, source-agnostic error event. */
export interface NormalizedErrorEvent {
  /** Pre-computed grouping key; when absent the engine derives one (computeFingerprint). */
  fingerprint?: string;
  /** Exception class / error type, e.g. "TypeError". */
  type: string;
  /** Human-readable message / first line. */
  message: string;
  /** Parsed frames (preferred) or a raw stack string. */
  stack?: StackFrame[] | string | null;
  level: ErrorLevel;
  /** ISO 8601 timestamp of the event. */
  timestamp: string;
  release?: string | null;
  environment?: string | null;
  /** Page URL / transaction / culprit the error occurred in. */
  url?: string | null;
  /** Anonymized stable user key (for affected-user counts) — never PII. */
  userKey?: string | null;
  tags?: Record<string, string>;
  context?: Record<string, unknown>;
  /** Adapter id that produced this event ('native' | 'otlp' | 'sentry' | …). */
  source: string;
}

const LEVEL_ALIASES: Record<string, ErrorLevel> = {
  fatal: 'fatal', critical: 'fatal', crit: 'fatal', emergency: 'fatal', alert: 'fatal',
  error: 'error', err: 'error', severe: 'error', exception: 'error',
  warning: 'warning', warn: 'warning',
  info: 'info', information: 'info', notice: 'info', debug: 'info', log: 'info', trace: 'info',
};

/** Normalize any source's severity token to one of the four canonical levels. */
export function normalizeLevel(raw: unknown): ErrorLevel {
  if (typeof raw !== 'string') return 'error';
  return LEVEL_ALIASES[raw.trim().toLowerCase()] ?? 'error';
}

/** Chrome `at fn (file:l:c)` / `at file:l:c` and Firefox/Safari `fn@file:l:c`. */
const STACK_LINE_PATTERNS: ReadonlyArray<RegExp> = [
  /^at\s+(.+?)\s+\((.+?):\d+(?::\d+)?\)$/,
  /^at\s+()(.+?):\d+(?::\d+)?$/,
  /^(.*?)@(.+?):\d+(?::\d+)?$/,
];

/** Parse a raw stack string into frames (function + file only — positions are not kept). */
function framesFromString(stack: string): StackFrame[] {
  const frames: StackFrame[] = [];
  for (const raw of stack.split('\n')) {
    const line = raw.trim();
    for (const re of STACK_LINE_PATTERNS) {
      const m = line.match(re);
      if (m) { frames.push({ function: m[1] || null, file: m[2] || null }); break; }
    }
  }
  return frames;
}

/**
 * A build-stable name for a frame's file: its basename, without query/fragment
 * and without a content-hash segment (`page-3f2a9c1b7d4e.js` → `page.js`). A
 * chunk's directory and hash are per-deploy facts, not per-bug ones.
 */
export function stableFrameFile(file: string | null | undefined): string {
  if (!file) return '';
  const base = file.split(/[?#]/)[0]!.split(/[\\/]/).pop() ?? '';
  return base.replace(/[-.~](?=[A-Za-z0-9_]*\d)[A-Za-z0-9_]{8,}(?=\.[cm]?js$)/, '');
}

/** A real function name — not anonymous, not a minifier's one/two-letter rename. */
function isMeaningfulFunction(name: string | null | undefined): name is string {
  if (!name) return false;
  const bare = name.replace(/^(?:async|new)\s+/, '').trim();
  return bare.length > 2 && !/^<?anonymous>?$/i.test(bare);
}

/**
 * The top frame of a stack, as a key that is STABLE ACROSS DEPLOYS.
 *
 * Line and column are deliberately excluded. Every ingest source ships bundled
 * code (the Worker's single `index.js`, Next's hashed chunks), so a frame's
 * position moves with every unrelated edit: the identical Cerebras 404 kept
 * landing at `index.js:40196`, `:40262`, `:40277` … and every deploy opened a
 * fresh error group for it — which read as "the same error forms a new group per
 * release", though `release` itself was never part of the basis. The key is the
 * first frame with a meaningful function name plus its hash-stripped file;
 * anonymous / minified frames are skipped. With none, the frame contributes
 * nothing and the group is keyed by type + normalized message alone.
 */
function topFrameKey(stack: NormalizedErrorEvent['stack']): string {
  if (!stack) return '';
  const frames = typeof stack === 'string' ? framesFromString(stack) : stack;
  const frame = frames.find((f) => isMeaningfulFunction(f?.function));
  if (!frame) return '';
  const fn = frame.function!.replace(/^(?:async|new)\s+/, '').trim();
  return `${fn}@${stableFrameFile(frame.file)}`;
}

/**
 * Strip the volatile parts of a message so two occurrences of the same bug group
 * together: drop quoted literals, hex/uuids, and standalone numbers (object ids,
 * timestamps, addresses) that differ event-to-event but not bug-to-bug.
 *
 * Exported because "same cause, different counters" is not a Quality-pillar problem
 * — it is the general one. The ticket lifecycle ledger groups repeated RUN failures
 * with this exact function so 134 dispatches that all died on
 * `allowance reached (30/25 …)` collapse to ONE line, and so the two subsystems can
 * never drift into two different definitions of "the same error".
 */
export function normalizeErrorMessage(message: string): string {
  return message
    .replace(/0x[0-9a-f]+/gi, '0x?')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/["'`][^"'`]*["'`]/g, '<str>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

/** SHA-256 hex of a string (Web Crypto — Worker-compatible). */
/**
 * Stable grouping fingerprint for an event. Honors an explicit `fingerprint` when
 * the source supplied one (e.g. Sentry issue id); otherwise derives a stable hash
 * from `type + normalizedMessage + topFrame` so the same bug recurs into one group.
 * `release` is NOT part of the basis, and `topFrameKey` excludes positions, so a
 * group spans deploys; the release stays a field on the group and each event.
 */
export async function computeFingerprint(e: NormalizedErrorEvent): Promise<string> {
  if (e.fingerprint && e.fingerprint.trim()) return e.fingerprint.trim().slice(0, 128);
  const basis = `${e.type}|${normalizeErrorMessage(e.message)}|${topFrameKey(e.stack)}`;
  return sha256Hex(basis);
}

/** A short human title for an error group (type + first message line). */
export function eventTitle(e: NormalizedErrorEvent): string {
  const msg = e.message.split('\n')[0]?.trim() ?? '';
  const type = e.type?.trim();
  if (type && msg && !msg.startsWith(type)) return `${type}: ${msg}`.slice(0, 300);
  return (msg || type || 'Unknown error').slice(0, 300);
}

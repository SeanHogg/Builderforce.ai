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

/** The first frame of a parsed/raw stack, as a stable string for fingerprinting. */
function topFrameKey(stack: NormalizedErrorEvent['stack']): string {
  if (!stack) return '';
  if (typeof stack === 'string') {
    // First non-empty line that looks like a frame.
    const line = stack.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
    return line ?? '';
  }
  const f = stack[0];
  if (!f) return '';
  return `${f.function ?? ''}@${f.file ?? ''}:${f.line ?? ''}`;
}

/**
 * Strip the volatile parts of a message so two occurrences of the same bug group
 * together: drop quoted literals, hex/uuids, and standalone numbers (object ids,
 * timestamps, addresses) that differ event-to-event but not bug-to-bug.
 */
function normalizeMessage(message: string): string {
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
async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Stable grouping fingerprint for an event. Honors an explicit `fingerprint` when
 * the source supplied one (e.g. Sentry issue id); otherwise derives a stable hash
 * from `type + normalizedMessage + topFrame` so the same bug recurs into one group.
 */
export async function computeFingerprint(e: NormalizedErrorEvent): Promise<string> {
  if (e.fingerprint && e.fingerprint.trim()) return e.fingerprint.trim().slice(0, 128);
  const basis = `${e.type}|${normalizeMessage(e.message)}|${topFrameKey(e.stack)}`;
  return sha256Hex(basis);
}

/** A short human title for an error group (type + first message line). */
export function eventTitle(e: NormalizedErrorEvent): string {
  const msg = e.message.split('\n')[0]?.trim() ?? '';
  const type = e.type?.trim();
  if (type && msg && !msg.startsWith(type)) return `${type}: ${msg}`.slice(0, 300);
  return (msg || type || 'Unknown error').slice(0, 300);
}

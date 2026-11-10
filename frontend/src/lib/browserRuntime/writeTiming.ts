/**
 * ONE timing helper for every build-file write (preview `rm` + `writeTree`, the site
 * support probe, per-file tool writes). A build-file write once took 35.7 s against a
 * 38 ms median and could not be profiled live; this records the context an outlier needs
 * (phase, file count, bytes, whether a dev server was running) at the moment it happens.
 *
 * Reports go to the API's existing span ingest (`POST /api/telemetry/spans`) through
 * the shared `apiRequest` client, BUFFERED: at most one array POST per flush window
 * (and one on `pagehide`), carrying the worst outliers plus one baseline sample. They
 * are mirrored to the console. The reporter is injectable and a no-op under test.
 */
import { apiRequest } from '../apiClient';
import { getStoredTenantToken } from '../auth';

export type WritePhase = 'rm' | 'writeTree' | 'perFile';

export interface WriteSample {
  phase: WritePhase;
  fileCount: number;
  totalBytes: number;
  durationMs: number;
  /** Whether a preview/dev-server process was running; `null` when unknown (runtime not booted). */
  previewRunning: boolean | null;
  /** The file, for a per-file write. */
  path?: string;
}

/** What a write touched, and whom it belongs to (all attribution optional). */
export interface WriteSize {
  fileCount: number;
  totalBytes: number;
  path?: string;
  /** The workspace the write landed in. */
  workflowId?: string;
  /** The canvas object (build turn target) that asked for it. */
  taskId?: string;
}

/** A write slower than this is always reported. */
export const SLOW_WRITE_MS = 1000;
/** One in this many ordinary writes is a baseline candidate, so an outlier has a median to sit against. */
export const BASELINE_SAMPLE_EVERY = 50;
/** At most one POST per window. */
export const FLUSH_WINDOW_MS = 10_000;
/** Spans per POST: the worst outliers (cap - 1) plus one baseline. */
export const MAX_SPANS_PER_FLUSH = 20;

/** Decide whether a finished write is reported. Pure. */
export function shouldReportWrite(durationMs: number, random: number = Math.random()): 'slow' | 'baseline' | null {
  if (durationMs > SLOW_WRITE_MS) return 'slow';
  return random < 1 / BASELINE_SAMPLE_EVERY ? 'baseline' : null;
}

/** A file's content as the runtime holds it: text or raw bytes. */
export type MeasurableContent = string | Uint8Array;

const encoder = new TextEncoder();

/** Bytes of one file: UTF-8 length of text, `byteLength` of binary. */
export function contentBytes(content: MeasurableContent): number {
  return typeof content === 'string' ? encoder.encode(content).byteLength : content.byteLength;
}

/** Count and size in bytes of a file map. */
export function measureFiles(files: Record<string, MeasurableContent>): WriteSize {
  let totalBytes = 0;
  const paths = Object.keys(files);
  for (const path of paths) {
    const content = files[path];
    if (content !== undefined) totalBytes += contentBytes(content);
  }
  return { fileCount: paths.length, totalBytes };
}

let previewProbe: (() => boolean) | null = null;

/** The preview runtime registers how to ask "is a process running?" once it boots. */
export function setPreviewRunningProbe(probe: (() => boolean) | null): void {
  previewProbe = probe;
}

function previewRunning(): boolean | null {
  try {
    return previewProbe ? previewProbe() : null;
  } catch {
    return null;
  }
}

// ── Span shape + reporter ───────────────────────────────────────────────────

/** The API's existing span ingest (tenant JWT). */
const SPAN_INGEST_PATH = '/api/telemetry/spans';
export const WRITE_SPAN_KIND = 'client.build_file_write';
/** Statuses a fire-and-forget report may get (offline, signed out, throttled, outage) without the global error toast. */
const QUIET_STATUSES = [0, 400, 401, 403, 404, 413, 429, 500, 502, 503, 504];

export type WriteSpan = Record<string, unknown>;
/** Sends a batch of spans. May reject; the caller swallows it. */
export type WriteReporter = (spans: WriteSpan[]) => Promise<unknown> | void;

interface Pending {
  report: 'slow' | 'baseline';
  sample: WriteSample;
  target: WriteSize;
}

/** The span the ingest stores: `description` carries the context as JSON; ids attribute it. */
export function writeSpan(report: 'slow' | 'baseline', sample: WriteSample, target: WriteSize = sample): WriteSpan {
  return {
    kind: WRITE_SPAN_KIND,
    traceId: 'client-build-file-write',
    ...(target.workflowId ? { workflowId: target.workflowId } : {}),
    ...(target.taskId ? { taskId: target.taskId } : {}),
    description: JSON.stringify({ report, ...sample }),
    durationMs: sample.durationMs,
    ts: new Date().toISOString(),
  };
}

/** The production reporter: one array POST, skipped entirely when signed out (a 401 would trip the guest wall). */
export function createApiReporter(): WriteReporter {
  return (spans) => {
    if (!getStoredTenantToken()) return;
    return apiRequest(SPAN_INGEST_PATH, {
      method: 'POST',
      body: JSON.stringify(spans),
      expectedErrors: QUIET_STATUSES,
      // A flush runs on `pagehide` too: without `keepalive` the browser cancels the POST as the
      // page unloads, losing exactly the reports collected last. The batch is capped at
      // MAX_SPANS_PER_FLUSH small spans, well inside the 64 KiB keepalive body quota.
      keepalive: true,
    });
  };
}

// Tests must never reach the network through a write path; they inject a reporter.
let reporter: WriteReporter | null = process.env.NODE_ENV === 'test' ? null : createApiReporter();

/** Replace the reporter (`null` disables reporting). */
export function setWriteReporter(next: WriteReporter | null): void {
  reporter = next;
}

// ── Buffer ──────────────────────────────────────────────────────────────────

let slowBuffer: Pending[] = [];
let baselineSlot: Pending | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let pagehideBound = false;
let droppedReports = 0;

/** Send what the window collected as ONE array POST. Safe to call with nothing buffered. */
export function flushWriteReports(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const pending = [...slowBuffer, ...(baselineSlot ? [baselineSlot] : [])];
  slowBuffer = [];
  baselineSlot = null;
  if (!pending.length || !reporter) return;
  const spans = pending.map((p) => writeSpan(p.report, p.sample, p.target));
  try {
    // Telemetry must never disturb a write: a sync throw or a rejection is dropped.
    void Promise.resolve(reporter(spans)).catch(() => { droppedReports += spans.length; });
  } catch {
    droppedReports += spans.length;
  }
}

/** Reports lost to a throwing reporter this tab: telemetry never disturbs a write, but the loss is countable. */
export function droppedWriteReportCount(): number {
  return droppedReports;
}

function enqueue(item: Pending): void {
  if (item.report === 'slow') {
    // Keep the worst outliers when the window overflows.
    slowBuffer.push(item);
    if (slowBuffer.length > MAX_SPANS_PER_FLUSH - 1) {
      slowBuffer.sort((a, b) => b.sample.durationMs - a.sample.durationMs);
      slowBuffer.length = MAX_SPANS_PER_FLUSH - 1;
    }
  } else {
    baselineSlot ??= item; // one baseline sample per window
  }
  if (!pagehideBound && typeof window !== 'undefined') {
    pagehideBound = true;
    window.addEventListener('pagehide', flushWriteReports);
  }
  flushTimer ??= setTimeout(flushWriteReports, FLUSH_WINDOW_MS);
}

function emit(report: 'slow' | 'baseline', sample: WriteSample, target: WriteSize): void {
  if (report === 'slow') console.warn('[build-file-write] slow write', sample);
  else console.debug('[build-file-write] baseline', sample);
  enqueue({ report, sample, target });
}

/**
 * What a write touched, given either up front or as a thunk. A thunk is only called when the
 * write is reported (an outlier or the ~2% baseline), so a caller whose size is costly to
 * compute (`measureFiles` UTF-8-encodes every file) pays for it only on the writes that need it.
 */
export type WriteTarget = WriteSize | (() => WriteSize);

/** Time `run` (sync or async) as one write phase and report it when it is an outlier or sampled. */
export function timeWrite<T>(phase: WritePhase, targetOrThunk: WriteTarget, run: () => T): T {
  const started = performance.now();
  const finish = (): void => {
    const durationMs = Math.round(performance.now() - started);
    const report = shouldReportWrite(durationMs);
    if (!report) return;
    const target = typeof targetOrThunk === 'function' ? targetOrThunk() : targetOrThunk;
    const sample: WriteSample = {
      phase,
      fileCount: target.fileCount,
      totalBytes: target.totalBytes,
      durationMs,
      previewRunning: previewRunning(),
      ...(target.path ? { path: target.path } : {}),
    };
    emit(report, sample, target);
  };
  let result: T;
  try {
    result = run();
  } catch (error) {
    finish();
    throw error;
  }
  if (result instanceof Promise) {
    return result.then(
      (value) => { finish(); return value; },
      (error: unknown) => { finish(); throw error; },
    ) as T;
  }
  finish();
  return result;
}

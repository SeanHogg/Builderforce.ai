import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  shouldReportWrite, measureFiles, timeWrite, setPreviewRunningProbe, setWriteReporter, flushWriteReports,
  createApiReporter, writeSpan, WRITE_SPAN_KIND, SLOW_WRITE_MS, FLUSH_WINDOW_MS, MAX_SPANS_PER_FLUSH,
  type WriteSpan,
} from './writeTiming';

const apiRequest = vi.hoisted(() => vi.fn((..._args: unknown[]) => Promise.resolve({ inserted: 1 })));
const storedToken = vi.hoisted(() => ({ value: 'jwt' as string | null }));
vi.mock('../apiClient', () => ({ apiRequest }));
vi.mock('../auth', () => ({ getStoredTenantToken: () => storedToken.value }));

/** Make the next `timeWrite` take `ms`. */
function takes(ms: number): void {
  vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(ms);
}

let sent: WriteSpan[][];

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  setWriteReporter((spans) => { sent.push(spans); });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  flushWriteReports();
  setWriteReporter(null);
  setPreviewRunningProbe(null);
  storedToken.value = 'jwt';
  apiRequest.mockClear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('shouldReportWrite', () => {
  it('always reports a write over the threshold', () => {
    expect(shouldReportWrite(SLOW_WRITE_MS + 1, 0.99)).toBe('slow');
  });
  it('samples a baseline of fast writes only', () => {
    expect(shouldReportWrite(10, 0.001)).toBe('baseline');
    expect(shouldReportWrite(10, 0.5)).toBeNull();
    expect(shouldReportWrite(SLOW_WRITE_MS, 0.5)).toBeNull();
  });
});

describe('measureFiles', () => {
  it('counts files and bytes', () => {
    expect(measureFiles({ 'a.ts': 'abc', 'b.ts': 'de' })).toEqual({ fileCount: 2, totalBytes: 5 });
  });
  it('measures binary files by byteLength and text as UTF-8', () => {
    expect(measureFiles({ 'logo.png': new Uint8Array(7), 'a.txt': 'é' })).toEqual({ fileCount: 2, totalBytes: 9 });
  });
});

describe('writeSpan', () => {
  it('maps a sample onto the span ingest shape, with attribution', () => {
    const sample = { phase: 'perFile' as const, fileCount: 1, totalBytes: 4, durationMs: 1500, previewRunning: false, path: 'src/a.ts' };
    const span = writeSpan('slow', sample, { fileCount: 1, totalBytes: 4, workflowId: 'ws1', taskId: 'obj1' });
    expect(span).toMatchObject({ kind: WRITE_SPAN_KIND, durationMs: 1500, workflowId: 'ws1', taskId: 'obj1' });
    expect(JSON.parse(span.description as string)).toMatchObject({ report: 'slow', phase: 'perFile', path: 'src/a.ts', previewRunning: false });
  });
});

describe('timeWrite', () => {
  it('returns the sync result and buffers a slow write with preview context', () => {
    setPreviewRunningProbe(() => true);
    takes(SLOW_WRITE_MS + 500);
    expect(timeWrite('writeTree', { fileCount: 3, totalBytes: 30 }, () => 'ok')).toBe('ok');
    expect(console.warn).toHaveBeenCalledWith('[build-file-write] slow write', expect.objectContaining({ phase: 'writeTree', previewRunning: true }));
    expect(sent).toHaveLength(0); // buffered, not sent per call
    vi.advanceTimersByTime(FLUSH_WINDOW_MS);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]![0]!.description as string)).toMatchObject({ phase: 'writeTree', fileCount: 3, totalBytes: 30, durationMs: SLOW_WRITE_MS + 500, previewRunning: true });
  });

  it('reports the baseline branch when the sample draw hits, once per window', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    takes(5);
    timeWrite('rm', { fileCount: 1, totalBytes: 0 }, () => undefined);
    takes(6);
    timeWrite('rm', { fileCount: 1, totalBytes: 0 }, () => undefined);
    expect(console.debug).toHaveBeenCalledTimes(2);
    flushWriteReports();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(1);
    expect(JSON.parse(sent[0]![0]!.description as string)).toMatchObject({ report: 'baseline', durationMs: 5 });
  });

  it('does not report a fast write when the draw misses', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    takes(5);
    timeWrite('rm', { fileCount: 1, totalBytes: 0 }, () => undefined);
    flushWriteReports();
    expect(sent).toHaveLength(0);
  });

  it('times a sync throw and rethrows it', () => {
    takes(SLOW_WRITE_MS + 1);
    expect(() => timeWrite('writeTree', { fileCount: 1, totalBytes: 1 }, () => { throw new Error('boom'); })).toThrow('boom');
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it('times an async write and rethrows its failure', async () => {
    takes(SLOW_WRITE_MS + 1);
    await expect(timeWrite('perFile', { fileCount: 1, totalBytes: 1 }, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it('regression: a lazy size is never computed for a write that is not reported', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const measure = vi.fn(() => ({ fileCount: 2, totalBytes: 9 }));
    takes(5);
    timeWrite('writeTree', measure, () => undefined);
    expect(measure).not.toHaveBeenCalled();
  });

  it('computes a lazy size once for a reported write and reports it', () => {
    const measure = vi.fn(() => ({ fileCount: 2, totalBytes: 9 }));
    takes(SLOW_WRITE_MS + 1);
    timeWrite('writeTree', measure, () => undefined);
    expect(measure).toHaveBeenCalledOnce();
    flushWriteReports();
    expect(JSON.parse(sent[0]![0]!.description as string)).toMatchObject({ fileCount: 2, totalBytes: 9 });
  });
});

describe('buffer', () => {
  it('caps a flush and keeps the worst outliers plus the baseline', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    takes(5);
    timeWrite('rm', { fileCount: 1, totalBytes: 0 }, () => undefined); // baseline
    for (let i = 0; i < MAX_SPANS_PER_FLUSH + 10; i += 1) {
      takes(SLOW_WRITE_MS + 1 + i);
      timeWrite('writeTree', { fileCount: 1, totalBytes: 0 }, () => undefined);
    }
    flushWriteReports();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(MAX_SPANS_PER_FLUSH);
    const durations = sent[0]!.map((s) => s.durationMs as number);
    expect(durations).toContain(SLOW_WRITE_MS + 1 + MAX_SPANS_PER_FLUSH + 9); // the worst survived
    expect(durations).not.toContain(SLOW_WRITE_MS + 1); // the mildest was dropped
    expect(durations).toContain(5);
  });

  it('flushes at most once per window and starts a new window after', () => {
    takes(SLOW_WRITE_MS + 1);
    timeWrite('rm', { fileCount: 1, totalBytes: 0 }, () => undefined);
    takes(SLOW_WRITE_MS + 2);
    timeWrite('rm', { fileCount: 1, totalBytes: 0 }, () => undefined);
    vi.advanceTimersByTime(FLUSH_WINDOW_MS);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(2);
    takes(SLOW_WRITE_MS + 3);
    timeWrite('rm', { fileCount: 1, totalBytes: 0 }, () => undefined);
    vi.advanceTimersByTime(FLUSH_WINDOW_MS);
    expect(sent).toHaveLength(2);
  });

  it('swallows a rejecting or throwing reporter', async () => {
    setWriteReporter(() => Promise.reject(new Error('offline')));
    takes(SLOW_WRITE_MS + 1);
    timeWrite('rm', { fileCount: 1, totalBytes: 0 }, () => undefined);
    expect(() => flushWriteReports()).not.toThrow();
    setWriteReporter(() => { throw new Error('sync'); });
    takes(SLOW_WRITE_MS + 1);
    timeWrite('rm', { fileCount: 1, totalBytes: 0 }, () => undefined);
    expect(() => flushWriteReports()).not.toThrow();
    await Promise.resolve();
  });
});

describe('createApiReporter', () => {
  it('posts ONE array to the span ingest, quietly', () => {
    createApiReporter()([{ kind: WRITE_SPAN_KIND }, { kind: WRITE_SPAN_KIND }]);
    expect(apiRequest).toHaveBeenCalledOnce();
    const [path, opts] = apiRequest.mock.calls[0] as [string, { method: string; body: string; expectedErrors: number[] }];
    expect(path).toBe('/api/telemetry/spans');
    expect(JSON.parse(opts.body)).toHaveLength(2);
    expect(opts.expectedErrors).toContain(0);
    expect(opts.expectedErrors).toContain(401);
  });

  it('regression: sends with keepalive so the pagehide flush survives unload', () => {
    createApiReporter()([{ kind: WRITE_SPAN_KIND }]);
    const [, opts] = apiRequest.mock.calls[0] as [string, { keepalive?: boolean }];
    expect(opts.keepalive).toBe(true);
  });

  it('sends nothing when signed out', () => {
    storedToken.value = null;
    createApiReporter()([{ kind: WRITE_SPAN_KIND }]);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});

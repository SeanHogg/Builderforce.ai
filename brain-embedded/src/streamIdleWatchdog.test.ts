import { describe, it, expect, vi, afterEach } from 'vitest';
import { readWithIdleWatchdog, StreamIdleError, STREAM_IDLE_MS } from './streamIdleWatchdog';

afterEach(() => {
  vi.useRealTimers();
});

/** A reader whose chunk is resolved by the test, so silence is a first-class state. */
function fakeReader<T>() {
  let settle: ((value: T) => void) | undefined;
  let rejectRead: ((e: unknown) => void) | undefined;
  const cancels: unknown[] = [];
  return {
    cancels,
    speak: (value: T) => settle?.(value),
    fail: (e: unknown) => rejectRead?.(e),
    read: () => new Promise<T>((resolve, reject) => { settle = resolve; rejectRead = reject; }),
    cancel: (reason?: unknown) => { cancels.push(reason); return Promise.resolve(); },
  };
}

describe('readWithIdleWatchdog', () => {
  it('returns the chunk when the stream speaks before the idle window closes', async () => {
    vi.useFakeTimers();
    const reader = fakeReader<string>();
    const read = readWithIdleWatchdog(reader, { idleMs: 1_000 });
    vi.advanceTimersByTime(900);
    reader.speak('chunk');
    await expect(read).resolves.toBe('chunk');
    expect(reader.cancels).toEqual([]);
  });

  it('cancels the reader and throws once the stream has been silent for idleMs', async () => {
    vi.useFakeTimers();
    const reader = fakeReader<string>();
    const idle: number[] = [];
    const read = readWithIdleWatchdog(reader, { idleMs: 1_000, onIdle: (ms) => idle.push(ms) });
    const settled = expect(read).rejects.toBeInstanceOf(StreamIdleError);
    await vi.advanceTimersByTimeAsync(1_000);
    await settled;
    expect(reader.cancels).toHaveLength(1);
    expect(idle).toEqual([1_000]);
  });

  it('names the silence in the error so the caller can report the number', async () => {
    vi.useFakeTimers();
    const reader = fakeReader<string>();
    const read = readWithIdleWatchdog(reader, { idleMs: 240_000 });
    const settled = read.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(240_000);
    const error = await settled;
    expect(error).toBeInstanceOf(StreamIdleError);
    expect((error as StreamIdleError).idleMs).toBe(240_000);
    expect((error as Error).message).toContain('240s');
  });

  it('does not leave the losing read as an unhandled rejection', async () => {
    vi.useFakeTimers();
    const reader = fakeReader<string>();
    const read = readWithIdleWatchdog(reader, { idleMs: 1_000 });
    const settled = read.catch(() => 'idle');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await settled).toBe('idle');
    // The socket rejects AFTER the cancel — nobody is listening any more, and that
    // must not become an unhandled rejection.
    reader.fail(new Error('aborted'));
    await Promise.resolve();
  });

  it('passes a read failure straight through — a dropped stream is not an idle stream', async () => {
    const reader = fakeReader<string>();
    const read = readWithIdleWatchdog(reader, { idleMs: 10_000 });
    reader.fail(new Error('socket closed'));
    await expect(read).rejects.toThrow('socket closed');
  });

  it('is generous by default — a reasoning model may be silent for a while', () => {
    // A false trip costs a wasted turn on another model, so the default is minutes.
    expect(STREAM_IDLE_MS).toBe(240_000);
    expect(STREAM_IDLE_MS).toBeGreaterThan(120_000);
  });

  it('is a plain read when the watchdog is disabled', async () => {
    const reader = fakeReader<string>();
    const read = readWithIdleWatchdog(reader, { idleMs: 0 });
    reader.speak('chunk');
    await expect(read).resolves.toBe('chunk');
  });

  it('throws even when cancel settles the pending read as done (WHATWG streams)', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
    });
    const reader = body.getReader();
    await reader.read();
    await expect(readWithIdleWatchdog(reader, { idleMs: 30 })).rejects.toBeInstanceOf(StreamIdleError);
  });
});

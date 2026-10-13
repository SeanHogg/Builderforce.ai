import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReplayChunk, ReplayClientConfig } from '@builderforce/interaction-contract';
import type { BatchSink } from './batch';
import type { QueuedCall } from './handoff';
import { startRecorder, type RecorderHandle } from './recorder';
import { recordCalls } from './rrweb.mock';

let handle: RecorderHandle | null = null;

function start(
  config: Partial<ReplayClientConfig> & Record<string, unknown> = {},
  opts: { random?: number; queue?: QueuedCall[]; record?: () => never } = {},
) {
  const chunks: ReplayChunk[] = [];
  const urls: string[] = [];
  const sink: BatchSink = {
    async post(url, body) {
      urls.push(url);
      chunks.push(JSON.parse(body as string) as ReplayChunk);
      return { status: 202 };
    },
    sleep: async () => {},
  };
  handle = startRecorder(
    {
      config: { enabled: true, recorderUrl: 'https://cdn.test/replay/r/recorder.abc.js', keepRate: 0.5, ...config } as ReplayClientConfig,
      site: 'bfr_test',
      release: 'r-test',
      api: 'https://api.test',
      queue: opts.queue ?? [],
    },
    {
      random: () => opts.random ?? 0.99,
      sink,
      compress: async () => null,
      watchQuiet: (_ms, done) => done(false),
      ...(opts.record ? { record: opts.record as never } : {}),
    },
  );
  return { chunks, urls };
}

function lastOptions() {
  return recordCalls[recordCalls.length - 1]!.options;
}

function emitBuffered(): void {
  const { emit } = lastOptions();
  emit({ type: 4, n: 1 }, true);
  emit({ type: 2, n: 2 }, true);
  emit({ type: 3, n: 3 }, false);
}

function clickButton(times: number): void {
  const button = document.createElement('button');
  button.textContent = 'Go';
  document.body.appendChild(button);
  for (let i = 0; i < times; i++) {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
  }
}

afterEach(() => {
  handle?.stop();
  handle = null;
  recordCalls.length = 0;
  window.localStorage.clear();
  document.body.innerHTML = '';
  delete window.BFReplay;
  vi.restoreAllMocks();
});

describe('rrweb privacy options', () => {
  it('hard-codes maskAllInputs and passes block/mask selectors, even when config says otherwise', () => {
    start({ maskAllText: true, recordCanvas: true, maskAllInputs: false });
    const options = lastOptions();
    expect(options.maskAllInputs).toBe(true);
    expect(options.blockSelector).toBe('[data-bf-block]');
    expect(options.maskTextSelector).toBe('*');
    expect(options.recordCanvas).toBe(true);
    expect(options.sampling).toMatchObject({ mousemove: 50, scroll: 150, input: 'last', canvas: 2 });
    expect(options.dataURLOptions).toEqual({ type: 'image/jpeg', quality: 0.4 });
  });

  it('masks only [data-bf-mask] text by default and never records canvas', () => {
    start();
    expect(lastOptions().maskTextSelector).toBe('[data-bf-mask]');
    expect(lastOptions().recordCanvas).toBe(false);
  });
});

describe('buffer mode', () => {
  it('an unkept session sends marks but no events, and posts to the chunk endpoint', async () => {
    const { chunks, urls } = start({}, { random: 0.99 });
    expect(lastOptions().checkoutEveryNms).toBe(60_000);
    emitBuffered();
    await handle!.flush(false);
    expect(urls[0]).toBe('https://api.test/api/replay-ingest/v1/chunks?site=bfr_test');
    expect(chunks[0]).toMatchObject({ v: 1, seq: 0, keep: null, sampleWeight: 1, release: 'r-test' });
    expect(chunks[0]!.events).toBeUndefined();
    expect(chunks[0]!.marks[0]).toMatchObject({ kind: 'page' });
  });

  it('a head-sampled session is kept with weight 1/keepRate and streams events', async () => {
    const { chunks } = start({ keepRate: 0.5 }, { random: 0.1 });
    expect(lastOptions().checkoutEveryNms).toBeUndefined();
    lastOptions().emit({ type: 2 }, false);
    await handle!.flush(false);
    expect(chunks[0]).toMatchObject({ keep: 'sample', sampleWeight: 2, events: [{ type: 2 }] });
  });

  it('BFReplay.keep() flushes the buffer and restarts rrweb without checkouts', async () => {
    const { chunks } = start();
    emitBuffered();
    window.BFReplay!.keep();
    expect(recordCalls[0]!.stopped).toBe(true);
    expect(recordCalls).toHaveLength(2);
    expect(lastOptions().checkoutEveryNms).toBeUndefined();
    await handle!.flush(false);
    expect(chunks[0]).toMatchObject({ keep: 'manual', sampleWeight: 1 });
    expect(chunks[0]!.events).toEqual([{ type: 4, n: 1 }, { type: 2, n: 2 }, { type: 3, n: 3 }]);
  });

  it('a rage click keeps the session for frustration', async () => {
    const { chunks } = start();
    emitBuffered();
    clickButton(3);
    await handle!.flush(false);
    expect(chunks[0]!.keep).toBe('frustration');
    expect(chunks[0]!.marks.map((m) => m.kind)).toEqual(expect.arrayContaining(['click', 'rage']));
    expect(chunks[0]!.events).toHaveLength(3);
  });

  it('a page error keeps the session for error', async () => {
    const { chunks } = start();
    window.dispatchEvent(new ErrorEvent('error', { message: 'Boom 42', error: new Error('Boom 42') }));
    await handle!.flush(false);
    expect(chunks[0]!.keep).toBe('error');
    expect(chunks[0]!.marks.find((m) => m.kind === 'error')).toMatchObject({ label: 'Boom 42' });
  });

  it('a tag keeps the session and rides on the header', async () => {
    const { chunks } = start();
    window.BFReplay!.tag('plan', 'pro');
    await handle!.flush(false);
    expect(chunks[0]).toMatchObject({ keep: 'tag', tags: { plan: 'pro' } });
  });
});

describe('public API', () => {
  it('replays the loader queue in order on start', async () => {
    const { chunks } = start({}, { queue: [['event', ['trial started']], ['tag', ['plan', 'pro']]] });
    await handle!.flush(false);
    const kinds = chunks[0]!.marks.map((m) => `${m.kind}:${m.key}`);
    expect(kinds).toContain('event:trial started');
    expect(chunks[0]!.tags).toEqual({ plan: 'pro' });
  });

  it('ignores identify when the site does not allow it', async () => {
    const { chunks } = start({ identify: false });
    window.BFReplay!.identify('user-1', { tier: 'gold' });
    window.BFReplay!.event('x');
    await handle!.flush(false);
    expect(chunks[0]!.identify).toBeUndefined();
  });

  it('carries identify when the site allows it', async () => {
    const { chunks } = start({ identify: true });
    window.BFReplay!.identify('user-1', { tier: 'gold' });
    window.BFReplay!.event('x');
    await handle!.flush(false);
    expect(chunks[0]!.identify).toEqual({ id: 'user-1', traits: { tier: 'gold' } });
  });

  it('stop() ends the visit and leaves an inert API', async () => {
    const { chunks } = start();
    window.BFReplay!.stop();
    await vi.waitFor(() => expect(chunks.some((c) => c.end === true)).toBe(true));
    expect(() => window.BFReplay!.keep()).not.toThrow();
    handle = null;
  });
});

describe('self-disable', () => {
  it('a recorder failure warns once and never throws into the page', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = () => {
      throw new Error('rrweb exploded');
    };
    expect(() => start({}, { record: failing })).not.toThrow();
    expect(handle).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(() => window.BFReplay?.tag('a', 'b')).not.toThrow();
  });
});

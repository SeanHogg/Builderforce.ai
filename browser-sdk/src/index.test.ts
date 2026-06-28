import { describe, it, expect, vi } from 'vitest';
import { QualityClient } from './index';
import { createServerCapture } from './server';
import { parseStack, toEvent } from './core';

const opts = { key: 'bfq_test', endpoint: 'https://api.example.com/api/quality-ingest', autoCapture: false as const };

describe('parseStack', () => {
  it('parses V8 frames', () => {
    const frames = parseStack('Error: boom\n    at foo (app.js:10:5)\n    at bar (lib.js:2:1)');
    expect(frames).toEqual([
      { function: 'foo', file: 'app.js', line: 10, column: 5 },
      { function: 'bar', file: 'lib.js', line: 2, column: 1 },
    ]);
  });
  it('parses Firefox frames', () => {
    const frames = parseStack('foo@app.js:10:5');
    expect(frames?.[0]).toEqual({ function: 'foo', file: 'app.js', line: 10, column: 5 });
  });
});

describe('toEvent', () => {
  it('maps an Error to the canonical shape', () => {
    const ev = toEvent(new TypeError('x is not a function'), { ...opts, release: 'v1', environment: 'production' });
    expect(ev.type).toBe('TypeError');
    expect(ev.message).toBe('x is not a function');
    expect(ev.level).toBe('error');
    expect(ev.source).toBe('native');
    expect(ev.release).toBe('v1');
    expect(ev.environment).toBe('production');
    expect(typeof ev.timestamp).toBe('string');
  });
  it('handles non-Error throws and context overrides', () => {
    const ev = toEvent('boom', opts, { level: 'fatal', userKey: 'u1', tags: { area: 'checkout' } });
    expect(ev.message).toBe('boom');
    expect(ev.level).toBe('fatal');
    expect(ev.userKey).toBe('u1');
    expect(ev.tags).toEqual({ area: 'checkout' });
  });
});

describe('QualityClient', () => {
  it('flushes a batch to <endpoint>/events with the bearer key', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    const client = new QualityClient({ ...opts, maxBatch: 100, fetchFn });
    client.captureException(new Error('one'));
    client.captureMessage('two');
    await client.flush();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.example.com/api/quality-ingest/events');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer bfq_test');
    const body = JSON.parse(init.body as string);
    expect(body).toHaveLength(2);
    expect(body[0].source).toBe('native');
    client.close();
  });

  it('auto-flushes when maxBatch is reached', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    const client = new QualityClient({ ...opts, maxBatch: 2, fetchFn });
    client.captureException(new Error('a'));
    client.captureException(new Error('b'));
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    client.close();
  });
});

describe('createServerCapture', () => {
  it('posts a single event and returns the transport result', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    const cap = createServerCapture({ ...opts, fetchFn });
    const ok = await cap.captureException(new Error('server boom'));
    expect(ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

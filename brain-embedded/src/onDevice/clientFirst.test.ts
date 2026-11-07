import { describe, expect, it, vi } from 'vitest';
import { isInvalidClientResult, jsonClientResult, textClientResult, withClientResult, type ClientFirstHost, type ClientResultPayload } from './clientFirst';
import { onDeviceJudgement } from './clientFirstJudgement';
import { onDeviceTranscriptSummary } from './clientFirstSummary';
import type { OnDeviceTaskKind, OnDeviceTasks } from './onDeviceTasks';

const provenance = { engine: 'browser', model: 'gemini-nano' } as const;
const payload: ClientResultPayload = { text: 'device summary', provenance };

const hostOf = (over: Partial<OnDeviceTasks>, kinds: OnDeviceTaskKind[] = ['summarize', 'json']): ClientFirstHost => ({
  tasks: {
    available: async () => new Set(kinds),
    summarize: async () => null, rewrite: async () => null, write: async () => null, proofread: async () => null,
    detectLanguage: async () => null, translate: async () => null, json: async () => null,
    ...over,
  } as OnDeviceTasks,
  provenance: () => provenance,
});

describe('withClientResult', () => {
  it('attaches the on-device result', async () => {
    const send = vi.fn(async (cr?: ClientResultPayload) => cr?.text);
    expect(await withClientResult(async () => payload, send)).toBe('device summary');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(payload);
  });

  it('sends without clientResult when the device declines (null) or fails', async () => {
    const send = vi.fn(async (cr?: ClientResultPayload) => cr);
    expect(await withClientResult(async () => null, send)).toBeUndefined();
    expect(await withClientResult(async () => { throw new Error('boom'); }, send)).toBeUndefined();
    expect(send).toHaveBeenNthCalledWith(1);
    expect(send).toHaveBeenNthCalledWith(2);
  });

  it('retries ONCE without it on 400 invalid_client_result', async () => {
    const send = vi.fn(async (cr?: ClientResultPayload) => {
      if (cr) throw Object.assign(new Error('invalid_client_result'), { status: 400 });
      return 'server';
    });
    expect(await withClientResult(async () => payload, send)).toBe('server');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]).toEqual([]);
  });

  it('propagates other errors, and a second failure after the retry', async () => {
    const other = vi.fn(async () => { throw Object.assign(new Error('nope'), { status: 500 }); });
    await expect(withClientResult(async () => payload, other)).rejects.toThrow('nope');
    expect(other).toHaveBeenCalledTimes(1);
    const always = vi.fn(async () => { throw Object.assign(new Error('invalid_client_result'), { status: 400 }); });
    await expect(withClientResult(async () => payload, always)).rejects.toThrow('invalid_client_result');
    expect(always).toHaveBeenCalledTimes(2);
  });

  it('rethrows an abort from the device', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    await expect(withClientResult(async () => { throw abort; }, async () => 1)).rejects.toBe(abort);
  });
});

describe('isInvalidClientResult', () => {
  it('reads the rejection from each host error shape', () => {
    expect(isInvalidClientResult({ status: 400, code: 'http_400', message: 'invalid_client_result' })).toBe(true);
    expect(isInvalidClientResult({ status: 400, body: { error: 'invalid_client_result' } })).toBe(true);
    expect(isInvalidClientResult({ status: 422, message: 'invalid_client_result' })).toBe(false);
    expect(isInvalidClientResult({ status: 400, message: 'prompt is required' })).toBe(false);
  });
});

describe('result builders', () => {
  it('stamp provenance and map empty to null', () => {
    const host = hostOf({});
    expect(textClientResult('hi', host)).toEqual({ text: 'hi', provenance });
    expect(textClientResult('  ', host)).toBeNull();
    expect(textClientResult(null, host)).toBeNull();
    expect(jsonClientResult({ a: 1 }, host)).toEqual({ json: { a: 1 }, provenance });
    expect(jsonClientResult(null, host)).toBeNull();
  });
});

describe('onDeviceJudgement', () => {
  const req = { kind: 'extract' as const, items: [{ ref: 'r1', text: 'The system stores data.' }] };

  it('judges with the shared core and returns the judgement as clientResult.json', async () => {
    const json = vi.fn(async () => ({ extract: [{ ref: 'r1', claims: [{ subject: 'system', predicate: 'stores', object: 'data', quote: 'The system stores data.' }], entities: [] }] }));
    const out = await onDeviceJudgement(hostOf({ json: json as never }), req);
    expect(out?.provenance).toEqual(provenance);
    const result = out?.json as { extract: Array<{ ref: string; claims: unknown[] }> };
    expect(result.extract[0]?.ref).toBe('r1');
    expect(result.extract[0]?.claims).toHaveLength(1);
    expect(json).toHaveBeenCalledTimes(1);
  });

  it('is null when the device declines any question, or cannot run json', async () => {
    expect(await onDeviceJudgement(hostOf({ json: async () => null }), req)).toBeNull();
    const json = vi.fn();
    expect(await onDeviceJudgement(hostOf({ json: json as never }, ['summarize']), req)).toBeNull();
    expect(json).not.toHaveBeenCalled();
  });
});

describe('onDeviceTranscriptSummary', () => {
  const seed = [{ role: 'user' as const, content: 'hello' }, { role: 'assistant' as const, content: 'hi there' }];

  it('summarizes the transcript on the device into a text clientResult', async () => {
    const summarize = vi.fn(async () => 'The user greeted the assistant.');
    const out = await onDeviceTranscriptSummary(hostOf({ summarize }), seed);
    expect(out).toEqual({ text: 'The user greeted the assistant.', provenance });
    expect(summarize.mock.calls[0]?.[1]).toMatchObject({ kind: 'transcript' });
  });

  it('is null under two turns, and when the device declines', async () => {
    const summarize = vi.fn(async () => 'x');
    expect(await onDeviceTranscriptSummary(hostOf({ summarize }), seed.slice(0, 1))).toBeNull();
    expect(summarize).not.toHaveBeenCalled();
    expect(await onDeviceTranscriptSummary(hostOf({ summarize: async () => null }), seed)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { MAX_PULL_RECORDS, readPullRequest, readPushBatch, readSyncBody } from './syncEnvelope';

describe('readSyncBody', () => {
  it('parses JSON and hands anything else back unparsed for the reader to refuse', () => {
    expect(readSyncBody('{"a":1}')).toEqual({ a: 1 });
    expect(readSyncBody('nope')).toBe('nope');
    expect(readSyncBody('{not json')).toBe('{not json');
    expect(readPushBatch(readSyncBody('{not json'))).toEqual({ ok: false, code: 'invalid_batch' });
  });
});

describe('readPushBatch', () => {
  const base = { protocolVersion: 1, batchId: 'b', deviceId: 'd', destination: { kind: 'bound' }, events: [] };

  it('refuses an oversized batch, a cycle, and a duplicate event id', () => {
    expect(readPushBatch({ ...base, events: Array.from({ length: 101 }, () => ({ eventId: 'x' })) }))
      .toEqual({ ok: false, code: 'batch_too_large' });
    const e = (eventId: string, dependsOn: string[]) => ({ eventId, dependsOn });
    expect(readPushBatch({ ...base, events: [e('a', ['b']), e('b', ['a'])] })).toEqual({ ok: false, code: 'cycle' });
    expect(readPushBatch({ ...base, events: [e('a', []), e('a', [])] })).toEqual({ ok: false, code: 'duplicate_event' });
  });

  it('trims dependency ids and drops blanks', () => {
    const read = readPushBatch({ ...base, events: [{ eventId: 'a', dependsOn: [' x ', '  '] }] });
    expect(read.ok && read.batch.events[0]?.dependsOn).toEqual(['x']);
  });
});

describe('readPullRequest', () => {
  it('bounds the page with the import bound and refuses a non-positive limit', () => {
    const destination = { kind: 'bound' };
    expect(readPullRequest({ destination })).toMatchObject({ ok: true, request: { limit: MAX_PULL_RECORDS, cursor: null } });
    expect(readPullRequest({ destination, limit: 10_000 })).toMatchObject({ ok: true, request: { limit: MAX_PULL_RECORDS } });
    expect(readPullRequest({ destination, limit: 0 })).toEqual({ ok: false, code: 'invalid_limit' });
    expect(readPullRequest({ destination, limit: 1.5 })).toEqual({ ok: false, code: 'invalid_limit' });
    expect(readPullRequest({ destination, cursor: '  ' })).toMatchObject({ ok: true, request: { cursor: null, cursorMalformed: false } });
    expect(readPullRequest({ destination, cursor: 7 })).toMatchObject({ ok: true, request: { cursor: null, cursorMalformed: true } });
    expect(readPullRequest({ limit: 5 })).toEqual({ ok: false, code: 'invalid_batch' });
  });
});

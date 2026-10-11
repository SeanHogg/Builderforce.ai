import { describe, expect, it } from 'vitest';
import { parseReplayChunk, parseReplayVisitMeta, REPLAY_LIMITS } from './chunk';

describe('parseReplayChunk', () => {
  it('accepts a well-formed chunk', () => {
    expect(parseReplayChunk({
      visitId: 'v1',
      seq: 0,
      events: [{ t: 0, kind: 'click', x: 10 }],
    })).toEqual({
      visitId: 'v1',
      seq: 0,
      events: [{ t: 0, kind: 'click', x: 10 }],
    });
  });

  it('rejects missing visitId, negative seq, or a non-array events', () => {
    expect(parseReplayChunk({ seq: 0, events: [] })).toBeNull();
    expect(parseReplayChunk({ visitId: 'v1', seq: -1, events: [] })).toBeNull();
    expect(parseReplayChunk({ visitId: 'v1', seq: 0, events: {} })).toBeNull();
  });

  it('rejects a chunk over the event ceiling', () => {
    const events = Array.from({ length: REPLAY_LIMITS.maxEventsPerChunk + 1 }, (_, i) => ({
      t: i,
      kind: 'scroll',
    }));
    expect(parseReplayChunk({ visitId: 'v1', seq: 0, events })).toBeNull();
  });

  it('copies well-formed marks and tags', () => {
    expect(parseReplayChunk({
      visitId: 'v1',
      seq: 0,
      events: [],
      marks: [{ kind: 'rage', key: 'button.buy', label: 'Buy', atMs: 40 }],
      tags: { plan: 'pro' },
    })).toEqual({
      visitId: 'v1',
      seq: 0,
      events: [],
      marks: [{ kind: 'rage', key: 'button.buy', label: 'Buy', atMs: 40 }],
      tags: { plan: 'pro' },
    });
  });

  it('rejects malformed marks or too many tags', () => {
    expect(parseReplayChunk({
      visitId: 'v1',
      seq: 0,
      events: [],
      marks: [{ kind: 'rage', atMs: 40 }],
    })).toBeNull();
    const tags: Record<string, string> = {};
    for (let i = 0; i < REPLAY_LIMITS.maxTagsPerVisit + 1; i++) tags[`k${i}`] = 'v';
    expect(parseReplayChunk({ visitId: 'v1', seq: 0, events: [], tags })).toBeNull();
  });
});

describe('parseReplayVisitMeta', () => {
  it('accepts a well-formed visit', () => {
    const meta = parseReplayVisitMeta({
      visitId: 'v1',
      siteId: 's1',
      startedAt: 1,
      releaseKey: 'abc',
      path: '/',
      viewport: { w: 1280, h: 720 },
    });
    expect(meta?.visitId).toBe('v1');
    expect(meta?.viewport).toEqual({ w: 1280, h: 720 });
  });

  it('rejects a zero viewport', () => {
    expect(parseReplayVisitMeta({
      visitId: 'v1',
      siteId: 's1',
      startedAt: 1,
      releaseKey: 'abc',
      path: '/',
      viewport: { w: 0, h: 720 },
    })).toBeNull();
  });
});

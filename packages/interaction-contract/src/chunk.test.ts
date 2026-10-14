import { describe, expect, it } from 'vitest';
import {
  REPLAY_LIMITS,
  VISIT_IDLE_MS,
  VISITOR_ID_PATTERN,
  VITAL_BUCKETS,
  p75FromHistogram,
  parseReplayChunk,
  vitalBucket,
  type ReplayChunk,
} from './chunk';

function chunk(over: Partial<Record<keyof ReplayChunk, unknown>> = {}): Record<string, unknown> {
  return {
    v: 1,
    visitorId: 'visitor_abc123',
    visitId: 'visit_abc123',
    seq: 0,
    startedAt: 1_700_000_000_000,
    release: 'a1b2c3d4e5f6',
    recorderVersion: '2026.10.1',
    device: { class: 'desktop', w: 1280, h: 720, docW: 1280, docH: 4000 },
    newVisitor: true,
    keep: null,
    sampleWeight: 1,
    marks: [],
    ...over,
  };
}

describe('constants', () => {
  it('pins REPLAY_LIMITS to §3.4', () => {
    expect(REPLAY_LIMITS).toEqual({
      maxChunkBytes: 512_000,
      maxEventsPerChunk: 5_000,
      flushMs: 5_000,
      maxMarksPerVisit: 300,
      maxTagsPerVisit: 20,
      bufferMs: 60_000,
    });
  });

  it('pins the visit idle gap at 30 minutes', () => {
    expect(VISIT_IDLE_MS).toBe(30 * 60 * 1000);
  });

  it('accepts minted ids and rejects short or punctuated ones', () => {
    expect(VISITOR_ID_PATTERN.test('abcdEFGH')).toBe(true);
    expect(VISITOR_ID_PATTERN.test('short')).toBe(false);
    expect(VISITOR_ID_PATTERN.test('bad id!!')).toBe(false);
  });
});

describe('parseReplayChunk', () => {
  it('accepts a minimal unkept chunk', () => {
    const parsed = parseReplayChunk(chunk());
    expect(parsed).toMatchObject({ v: 1, seq: 0, keep: null, marks: [] });
    expect(parsed?.events).toBeUndefined();
  });

  it('copies marks, tags, identify, events and the optional header fields', () => {
    const parsed = parseReplayChunk(chunk({
      keep: 'frustration',
      browser: 'Chrome',
      os: 'macOS',
      referrer: 'google.com',
      variant: 'B',
      activeMs: 1200,
      end: true,
      marks: [
        { kind: 'click', key: 'getByRole("button")', label: 'Buy', atMs: 40, gx: 3, gy: 7, href: '/checkout' },
        { kind: 'vital', key: 'LCP', atMs: 900, value: 1800 },
      ],
      tags: { plan: 'pro' },
      identify: { id: 'user-1', traits: { tier: 'gold' } },
      events: [{ type: 2 }],
    }));
    expect(parsed).toMatchObject({
      keep: 'frustration',
      browser: 'Chrome',
      os: 'macOS',
      referrer: 'google.com',
      variant: 'B',
      activeMs: 1200,
      end: true,
      tags: { plan: 'pro' },
      identify: { id: 'user-1', traits: { tier: 'gold' } },
      events: [{ type: 2 }],
    });
    expect(parsed?.marks).toHaveLength(2);
    expect(parsed?.marks[0]).toEqual({
      kind: 'click', key: 'getByRole("button")', label: 'Buy', atMs: 40, gx: 3, gy: 7, href: '/checkout',
    });
  });

  it('rejects a wrong version, bad ids and a bad seq', () => {
    expect(parseReplayChunk(chunk({ v: 2 }))).toBeNull();
    expect(parseReplayChunk(chunk({ visitorId: 'short' }))).toBeNull();
    expect(parseReplayChunk(chunk({ visitId: 'bad id!!!' }))).toBeNull();
    expect(parseReplayChunk(chunk({ seq: -1 }))).toBeNull();
    expect(parseReplayChunk(chunk({ seq: 1.5 }))).toBeNull();
    expect(parseReplayChunk(null)).toBeNull();
    expect(parseReplayChunk('x')).toBeNull();
  });

  it('rejects an unknown keep reason, device class or a non-positive weight', () => {
    expect(parseReplayChunk(chunk({ keep: 'because' }))).toBeNull();
    expect(parseReplayChunk(chunk({ device: { class: 'watch', w: 1, h: 1 } }))).toBeNull();
    expect(parseReplayChunk(chunk({ sampleWeight: 0 }))).toBeNull();
  });

  it('rejects events on an unkept session and over the event ceiling', () => {
    expect(parseReplayChunk(chunk({ events: [] }))).toBeNull();
    const events = Array.from({ length: REPLAY_LIMITS.maxEventsPerChunk + 1 }, () => ({}));
    expect(parseReplayChunk(chunk({ keep: 'sample', events }))).toBeNull();
  });

  it('rejects unknown mark kinds, bad grid cells and over-long strings', () => {
    expect(parseReplayChunk(chunk({ marks: [{ kind: 'pageview', key: '/', atMs: 0 }] }))).toBeNull();
    expect(parseReplayChunk(chunk({ marks: [{ kind: 'click', key: 'a', atMs: 0, gx: 50, gy: 0 }] }))).toBeNull();
    expect(parseReplayChunk(chunk({ marks: [{ kind: 'click', key: 'a', atMs: 0, gx: 1 }] }))).toBeNull();
    expect(parseReplayChunk(chunk({ marks: [{ kind: 'error', key: 'k', atMs: 0, label: 'x'.repeat(121) }] }))).toBeNull();
    expect(parseReplayChunk(chunk({ release: 'r'.repeat(65) }))).toBeNull();
  });

  it('rejects too many marks or tags', () => {
    const marks = Array.from({ length: REPLAY_LIMITS.maxMarksPerVisit + 1 }, (_, i) => ({ kind: 'click', key: 'a', atMs: i }));
    expect(parseReplayChunk(chunk({ marks }))).toBeNull();
    const tags: Record<string, string> = {};
    for (let i = 0; i <= REPLAY_LIMITS.maxTagsPerVisit; i++) tags[`k${i}`] = 'v';
    expect(parseReplayChunk(chunk({ tags }))).toBeNull();
    expect(parseReplayChunk(chunk({ tags: { k: 'v'.repeat(201) } }))).toBeNull();
  });
});

describe('vitals histogram', () => {
  it('declares ascending bounds per metric', () => {
    for (const bounds of Object.values(VITAL_BUCKETS)) {
      for (let i = 1; i < bounds.length; i++) expect(bounds[i]!).toBeGreaterThan(bounds[i - 1]!);
    }
    expect(VITAL_BUCKETS.CLS).toEqual([10, 25, 50, 100, 150, 250, 500, 1000]);
  });

  it('buckets a value at the first bound that holds it', () => {
    expect(vitalBucket([100, 200], 50)).toBe(0);
    expect(vitalBucket([100, 200], 100)).toBe(0);
    expect(vitalBucket([100, 200], 150)).toBe(1);
    expect(vitalBucket([100, 200], 999)).toBe(2);
  });

  it('reads p75 as the upper bound of the 75th-percentile bucket', () => {
    expect(p75FromHistogram([100, 200, 500], [10, 10, 10, 10])).toBe(500);
    expect(p75FromHistogram([100, 200, 500], [80, 10, 10])).toBe(100);
    expect(p75FromHistogram([100, 200, 500], [0, 0, 0, 4])).toBe(500);
    expect(p75FromHistogram([100, 200], [0, 0])).toBeNull();
  });
});

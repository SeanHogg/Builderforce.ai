import { describe, it, expect } from 'vitest';
import { mergeTranscript } from './mergeTranscript';
import type { BrainMessage } from './types';

function msg(id: number, seq: number, content = `m${id}`): BrainMessage {
  return { id, seq, role: 'assistant', content, metadata: null, createdAt: new Date(0).toISOString() } as BrainMessage;
}

describe('mergeTranscript', () => {
  it('keeps a run-appended reply the server response did not carry', () => {
    // The reported bug: switch away mid-run, switch back, the fetch resolves after
    // the splice and the last reply is replaced out of existence.
    const fetched = [msg(1, 1), msg(2, 2)];
    const appended = [msg(3, 3, 'the last reply')];
    const got = mergeTranscript(fetched, appended);
    expect(got.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(got[2]!.content).toBe('the last reply');
  });

  it('orders by seq, so a spliced-in turn lands in its place, not at the end', () => {
    const got = mergeTranscript([msg(1, 1), msg(4, 4)], [msg(2, 2), msg(3, 3)]);
    expect(got.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
  });

  it('never duplicates a message present in both', () => {
    const got = mergeTranscript([msg(1, 1), msg(2, 2)], [msg(2, 2), msg(3, 3)]);
    expect(got.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it('prefers the base copy for an id in both — the fetched row is authoritative', () => {
    const got = mergeTranscript([msg(1, 1, 'server')], [msg(1, 1, 'stale')]);
    expect(got).toHaveLength(1);
    expect(got[0]!.content).toBe('server');
  });

  it('returns the base unchanged when there is nothing to add', () => {
    const base = [msg(1, 1)];
    expect(mergeTranscript(base, [])).toBe(base);
    expect(mergeTranscript(base, [msg(1, 1)])).toBe(base);
  });

  it('commutes: merge order does not change the result', () => {
    const a = [msg(1, 1), msg(3, 3)];
    const b = [msg(2, 2), msg(3, 3)];
    expect(mergeTranscript(a, b).map((m) => m.id)).toEqual(mergeTranscript(b, a).map((m) => m.id));
  });
});

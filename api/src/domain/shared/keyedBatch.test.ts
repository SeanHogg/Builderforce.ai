import { describe, expect, it } from 'vitest';
import { reconcileKeyedBatch, unwrittenKeys } from './keyedBatch';

const row = (id: number, eventKey: string | null) => ({ id, eventKey, content: `m${id}` });
const req = (eventKey?: string | null) => ({ eventKey: eventKey ?? null });

describe('unwrittenKeys', () => {
  it('names the keys the insert skipped', () => {
    expect(unwrittenKeys([req('a'), req('b'), req('c')], [row(1, 'a')])).toEqual(['b', 'c']);
  });

  it('is empty when everything was written, or when nothing was keyed', () => {
    expect(unwrittenKeys([req('a')], [row(1, 'a')])).toEqual([]);
    expect(unwrittenKeys([req(), req()], [])).toEqual([]);
  });

  it('asks for a repeated key once', () => {
    expect(unwrittenKeys([req('a'), req('a')], [])).toEqual(['a']);
  });
});

describe('reconcileKeyedBatch', () => {
  it('answers a full retry with the ORIGINAL rows — the point of the whole thing', () => {
    // Second attempt at the same two messages: the insert wrote nothing.
    const got = reconcileKeyedBatch([req('a'), req('b')], [], [row(7, 'a'), row(8, 'b')]);
    expect(got).toEqual([{ id: 7, content: 'm7' }, { id: 8, content: 'm8' }]);
  });

  it('keeps request order when a batch is half new and half already there', () => {
    const got = reconcileKeyedBatch(
      [req('a'), req('b'), req('c')],
      [row(9, 'c')],            // only 'c' was new
      [row(7, 'a'), row(8, 'b')],
    );
    expect(got.map((r) => r.id)).toEqual([7, 8, 9]);
  });

  it('strips the key — it is a write concern, not part of the transcript', () => {
    const [only] = reconcileKeyedBatch([req('a')], [row(1, 'a')]);
    expect(only).toEqual({ id: 1, content: 'm1' });
    expect(only).not.toHaveProperty('eventKey');
  });

  it('consumes keyless rows in order, since nothing else identifies them', () => {
    const got = reconcileKeyedBatch([req(), req()], [row(1, null), row(2, null)]);
    expect(got.map((r) => r.id)).toEqual([1, 2]);
  });

  it('handles a batch mixing keyed and keyless entries', () => {
    const got = reconcileKeyedBatch(
      [req(), req('a'), req()],
      [row(1, null), row(3, null)],
      [row(2, 'a')],
    );
    expect(got.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('drops an entry that was neither written nor found, rather than inventing one', () => {
    const got = reconcileKeyedBatch([req('a'), req('gone')], [row(1, 'a')]);
    expect(got.map((r) => r.id)).toEqual([1]);
  });

  it('is idempotent: reconciling the same request twice gives the same rows', () => {
    const first = reconcileKeyedBatch([req('a'), req('b')], [row(1, 'a'), row(2, 'b')]);
    const second = reconcileKeyedBatch([req('a'), req('b')], [], [row(1, 'a'), row(2, 'b')]);
    expect(second).toEqual(first);
  });

  it('prefers the freshly written row when a key somehow appears in both', () => {
    const got = reconcileKeyedBatch([req('a')], [row(1, 'a')], [row(99, 'a')]);
    expect(got.map((r) => r.id)).toEqual([1]);
  });
});

import { describe, it, expect } from 'vitest';
import { createPayloadBudget } from './transcriptBudget';

describe('createPayloadBudget', () => {
  it('passes a payload through untouched while the pool is healthy', () => {
    const b = createPayloadBudget({ total: 10_000, perPayload: 1_000 });
    const payload = 'x'.repeat(500);
    expect(b.cap(payload, 'read_file Output')).toBe(payload);
    expect(b.stats().trimmed).toBe(0);
    expect(b.note()).toBeNull();
  });

  it('caps a single oversized payload and says how much it dropped', () => {
    const b = createPayloadBudget({ total: 10_000, perPayload: 100 });
    const out = b.cap('y'.repeat(1_000), 'read_file Output');
    expect(out.startsWith('y'.repeat(100))).toBe(true);
    expect(out).toContain('900 chars truncated');
    expect(b.stats().trimmed).toBe(1);
  });

  it('leaves budget for the TAIL — an early dump cannot starve the last payload', () => {
    // The failure this exists for: the head of a report is complete and the end is
    // simply gone. With a shared pool the last call still gets a real (if shorter)
    // block instead of nothing.
    const b = createPayloadBudget({ total: 1_200, perPayload: 1_000, minPayload: 100 });
    b.cap('a'.repeat(5_000), 'first Output');
    const tail = b.cap('b'.repeat(5_000), 'last Output');
    expect(tail.length).toBeGreaterThan(100);
    expect(tail).toContain('truncated');
  });

  it('charges nothing for a byte-identical repeat and points at the original', () => {
    const b = createPayloadBudget({ total: 10_000, perPayload: 10_000 });
    const payload = 'z'.repeat(3_000);
    b.cap(payload, 'read_file Output');
    const spentAfterFirst = b.stats().spent;
    const repeat = b.cap(payload, 'read_file Output');
    expect(repeat).toContain('identical to the 1st payload');
    expect(repeat).toContain('read_file Output');
    expect(b.stats().spent).toBe(spentAfterFirst);
    expect(b.stats().deduped).toBe(1);
    expect(b.stats().dedupedChars).toBe(3_000);
  });

  it('never drops a payload silently — the note says the budget bit', () => {
    const b = createPayloadBudget({ total: 200, perPayload: 100 });
    b.cap('a'.repeat(1_000), 'one Output');
    b.cap('b'.repeat(1_000), 'two Output');
    b.cap('a'.repeat(1_000), 'three Output');
    const note = b.note()!;
    expect(note).toContain('size-budgeted');
    expect(note).toContain('shortened');
    expect(note).toContain('back references');
    expect(note).toContain('Every turn, tool call and error is still present');
  });

  it('leaves an empty payload alone and does not charge for it', () => {
    const b = createPayloadBudget({ total: 100, perPayload: 100 });
    expect(b.cap('', 'empty')).toBe('');
    expect(b.stats().spent).toBe(0);
  });

  it('elides rather than emitting a useless sliver once the pool is spent', () => {
    const b = createPayloadBudget({ total: 120, perPayload: 100, minPayload: 100 });
    b.cap('a'.repeat(1_000), 'one Output');
    const second = b.cap('b'.repeat(1_000), 'two Output');
    expect(second).toContain('omitted');
    expect(second).toContain('size budget');
    expect(second).toContain('live timeline');
  });
});

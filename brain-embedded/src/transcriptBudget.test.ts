import { describe, it, expect } from 'vitest';
import { createPayloadBudget, cutMiddleToFit, truncateMiddle, PASTE_SAFE_REPORT_CHARS } from './transcriptBudget';

describe('createPayloadBudget per-call cap', () => {
  it('lets one payload take a lower ceiling from the same pool', () => {
    const b = createPayloadBudget({ total: 10_000, perPayload: 1_000, minPayload: 50 });
    const out = b.cap('z'.repeat(800), 'model reasoning', 100);
    expect(out.startsWith('z'.repeat(100))).toBe(true);
    expect(out).toContain('700 chars truncated');
    // The next payload sees the normal ceiling and the pool minus what was spent.
    expect(b.cap('q'.repeat(800), 'Output')).toBe('q'.repeat(800));
    expect(b.stats().spent).toBe(900);
  });

  it('still dedupes under an override', () => {
    const b = createPayloadBudget({ total: 10_000, perPayload: 1_000 });
    b.cap('same'.repeat(100), 'assistant reply', 500);
    expect(b.cap('same'.repeat(100), 'assistant reply', 500)).toContain('identical to the 1st payload');
  });
});

describe('truncateMiddle', () => {
  it('passes short text through and bounds long text, keeping both ends', () => {
    expect(truncateMiddle('short', 100)).toBe('short');
    const out = truncateMiddle(`START${'m'.repeat(10_000)}END`, 500);
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out.startsWith('START')).toBe(true);
    expect(out.endsWith('END')).toBe(true);
    expect(out).toContain('chars omitted from the middle');
  });
});

describe('cutMiddleToFit', () => {
  const timeline = Array.from({ length: 200 }, (_, i) => `turn ${i} ${'x'.repeat(40)}`).join('\n');

  it('returns the joined parts untouched when they fit', () => {
    expect(cutMiddleToFit('HEAD', 'mid', 'TAIL', 1_000)).toBe('HEAD\nmid\nTAIL');
  });

  it('cuts the middle of the timeline, keeping head, tail and the ends of the timeline', () => {
    const out = cutMiddleToFit('HEAD', timeline, 'TAIL-JSON', 3_000);
    expect(out.length).toBeLessThanOrEqual(3_000);
    expect(out.startsWith('HEAD\nturn 0 ')).toBe(true);
    expect(out.endsWith('turn 199 ' + 'x'.repeat(40) + '\nTAIL-JSON')).toBe(true);
    expect(out).toMatch(/…\([\d,]+ chars of the middle of the timeline omitted to keep this report under the 50,000-character paste limit\)/);
  });

  it('holds the ceiling even when head and tail alone exceed it: head truncated, tail survives', () => {
    const head = Array.from({ length: 50 }, (_, i) => `head line ${i}`).join('\n');
    const tail = `## Diagnostics (JSON)\n${'T'.repeat(300)}`;
    const out = cutMiddleToFit(head, timeline, tail, 700);
    expect(out.length).toBeLessThanOrEqual(700);
    expect(out.startsWith('head line 0\nhead line 1')).toBe(true);
    expect(out.endsWith(tail)).toBe(true);
    expect(out).toContain('omitted');
  });

  it('cuts one very long line with no newline, landing near the ceiling', () => {
    const out = cutMiddleToFit('HEAD', 'a'.repeat(100_000), 'TAIL', 5_000);
    expect(out.length).toBeLessThanOrEqual(5_000);
    expect(out.length).toBeGreaterThan(4_800);
    expect(out.startsWith('HEAD\naaa')).toBe(true);
    expect(out.endsWith('aaa\nTAIL')).toBe(true);
  });

  it('never leaves a lone surrogate at either cut', () => {
    const emoji = '😀'.repeat(20_000);
    for (const ceiling of [3_001, 3_002, 3_003, 3_004]) {
      const out = cutMiddleToFit('HEAD', emoji, 'TAIL', ceiling);
      expect(out.length).toBeLessThanOrEqual(ceiling);
      expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(out)).toBe(false);
    }
  });

  it('names the paste limit, not the ceiling, in the marker', () => {
    expect(cutMiddleToFit('H', timeline, 'T', 1_000)).toContain('under the 50,000-character paste limit');
  });

  it('exposes a ceiling safely below the 50,000 limit', () => {
    expect(PASTE_SAFE_REPORT_CHARS).toBe(48_000);
  });
});

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

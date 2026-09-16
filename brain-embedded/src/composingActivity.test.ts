import { describe, it, expect } from 'vitest';
import { createComposingActivity, toolCallArgBytes, utf8ByteLength, type ComposingSink } from './composingActivity';
import type { BrainRunActivity } from './runActivity';

/** A sink that records what was published and how it was drawn. */
function recorder(): ComposingSink & { published: BrainRunActivity[]; immediate: number; coalesced: number } {
  const published: BrainRunActivity[] = [];
  const sink = {
    published,
    immediate: 0,
    coalesced: 0,
    set(a: BrainRunActivity) { published.push({ ...a }); },
    repaint() { sink.immediate += 1; },
    coalescedRepaint() { sink.coalesced += 1; },
  };
  return sink;
}

describe('utf8ByteLength', () => {
  it('counts the bytes the wire carried, not the characters', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('→')).toBe(3);
    expect(utf8ByteLength('🙂')).toBe(4);
    expect(utf8ByteLength('')).toBe(0);
  });
});

describe('toolCallArgBytes', () => {
  it('totals the arguments of every call in the turn', () => {
    expect(toolCallArgBytes([{ args: '{"a":1}' }, { args: '{"b":22}' }])).toBe(7 + 8);
    expect(toolCallArgBytes([])).toBe(0);
    expect(toolCallArgBytes([{}])).toBe(0);
  });
});

describe('createComposingActivity', () => {
  it('publishes the composing phase on the FIRST fragment and draws it immediately', () => {
    const sink = recorder();
    const c = createComposingActivity(sink, { step: 4, now: () => 1_000 });
    c.onDelta(0, { id: 'call_1', name: 'write_file', argsFragment: '{"path":' });
    expect(sink.published).toEqual([
      { phase: 'composing', startedAt: 1_000, step: 4, bytes: 8, label: 'write_file' },
    ]);
    // A phase change must not wait for a frame — it is the thing the user is waiting on.
    expect(sink.immediate).toBe(1);
    expect(sink.coalesced).toBe(0);
  });

  it('accumulates argument bytes and coalesces every later fragment', () => {
    const sink = recorder();
    const c = createComposingActivity(sink, { step: 1, now: () => 5 });
    c.onDelta(0, { name: 'write_file', argsFragment: 'ab' });
    c.onDelta(0, { argsFragment: 'cde' });
    c.onDelta(0, { argsFragment: '🙂' });
    expect(sink.published.map((a) => a.bytes)).toEqual([2, 5, 9]);
    expect(sink.immediate).toBe(1);
    expect(sink.coalesced).toBe(2);
  });

  it('keeps startedAt STABLE — re-stamping it would reset the elapsed clock every delta', () => {
    let t = 1_000;
    const sink = recorder();
    const c = createComposingActivity(sink, { step: 2, now: () => t });
    c.onDelta(0, { name: 'write_file', argsFragment: 'a' });
    t = 204_000;
    c.onDelta(0, { argsFragment: 'b' });
    expect(sink.published.every((a) => a.startedAt === 1_000)).toBe(true);
  });

  it('holds the tool name across the bare argument fragments that follow it', () => {
    const sink = recorder();
    const c = createComposingActivity(sink, { step: 1, now: () => 0 });
    c.onDelta(0, { name: 'edit_file', argsFragment: '{' });
    c.onDelta(0, { argsFragment: '"path":"a.ts"}' });
    expect(sink.published.map((a) => a.label)).toEqual(['edit_file', 'edit_file']);
  });

  it('names the call as soon as the name arrives, even after a nameless opening fragment', () => {
    const sink = recorder();
    const c = createComposingActivity(sink, { step: 1, now: () => 0 });
    c.onDelta(0, { id: 'call_1' });
    expect(sink.published[0].label).toBeUndefined();
    c.onDelta(0, { name: 'search_code', argsFragment: '{}' });
    expect(sink.published[1].label).toBe('search_code');
    // The name completes the phase announcement, so it draws now, not next frame.
    expect(sink.immediate).toBe(2);
  });

  it('switches the label when a LATER index composes a different tool', () => {
    const sink = recorder();
    const c = createComposingActivity(sink, { step: 1, now: () => 0 });
    c.onDelta(0, { name: 'read_file', argsFragment: '{}' });
    c.onDelta(1, { name: 'write_file', argsFragment: '{"p":1}' });
    expect(sink.published.map((a) => a.label)).toEqual(['read_file', 'write_file']);
    expect(c.bytes()).toBe(2 + 7);
  });

  it('starts over on reset — a retried turn re-streams its whole call', () => {
    let t = 10;
    const sink = recorder();
    const c = createComposingActivity(sink, { step: 1, now: () => t });
    c.onDelta(0, { name: 'write_file', argsFragment: 'abcd' });
    expect(c.bytes()).toBe(4);
    c.reset();
    expect(c.bytes()).toBe(0);
    t = 99;
    c.onDelta(0, { name: 'write_file', argsFragment: 'xy' });
    const last = sink.published[sink.published.length - 1];
    expect(last).toMatchObject({ bytes: 2, startedAt: 99 });
  });
});

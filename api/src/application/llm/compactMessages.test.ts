import { describe, expect, it, vi } from 'vitest';
import { compactMessages, CLOUD_COMPACT_DEFAULTS, type CompactionSummarizer } from './compactMessages';

type Msg = Record<string, unknown>;

const SYS: Msg = { role: 'system', content: 'You are a coding agent. '.repeat(20) };
const TASK: Msg = { role: 'user', content: 'Implement the avatar filter feature.' };

/** A round of: assistant(tool_call) + its tool result with a big payload. */
function round(i: number, payloadChars: number): Msg[] {
  return [
    { role: 'assistant', content: '', tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: `c${i}`, content: 'X'.repeat(payloadChars) },
  ];
}

const opts = { ...CLOUD_COMPACT_DEFAULTS, maxTokens: 5_000, recentMessages: 4 };

// Every `tool` message must have its `tool_call_id` introduced by a PRECEDING
// assistant `tool_calls[].id`, or the upstream rejects the request. This asserts
// compaction never orphans a tool message.
function assertPairingValid(messages: Msg[]): void {
  const announced = new Set<string>();
  for (const m of messages) {
    if (Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls as Array<{ id?: string }>) if (tc.id) announced.add(tc.id);
    }
    if (m.role === 'tool') {
      expect(announced.has(String(m.tool_call_id)), `orphan tool message ${String(m.tool_call_id)}`).toBe(true);
    }
  }
}

describe('compactMessages', () => {
  it('is a no-op when under budget', async () => {
    const msgs = [SYS, TASK, ...round(0, 50)];
    const r = await compactMessages(msgs, opts);
    expect(r.compacted).toBe(false);
    expect(r.messages).toEqual(msgs);
  });

  it('elides the bulky middle when over budget (no summarizer), keeping head + tail + pairing', async () => {
    const big = [SYS, TASK, ...round(1, 8_000), ...round(2, 8_000), ...round(3, 8_000), ...round(4, 200), ...round(5, 200)];
    const r = await compactMessages(big, opts);
    expect(r.compacted).toBe(true);
    expect(r.summarized).toBe(false);
    expect(r.afterTokens).toBeLessThan(r.beforeTokens);
    // Anchor preserved.
    expect(r.messages[0]).toEqual(SYS);
    expect(r.messages[1]).toEqual(TASK);
    assertPairingValid(r.messages);
  });

  it('compresses the middle into ONE builder-memory note when a summarizer is given', async () => {
    const summarize: CompactionSummarizer = vi.fn(async () => '- read TaskBoard.tsx; filter bar lives at line 42\n- decided to add a chip row');
    const big = [SYS, TASK, ...round(1, 8_000), ...round(2, 8_000), ...round(3, 8_000), ...round(4, 200), ...round(5, 200)];
    const r = await compactMessages(big, opts, summarize);
    expect(summarize).toHaveBeenCalledOnce();
    expect(r.compacted).toBe(true);
    expect(r.summarized).toBe(true);
    expect(r.afterTokens).toBeLessThan(r.beforeTokens);
    // The memory note is present and carries the summary.
    const note = r.messages.find((m) => typeof m.content === 'string' && (m.content as string).includes('Compressed memory'));
    expect(note).toBeTruthy();
    expect((note!.content as string)).toContain('filter bar lives at line 42');
    expect(r.messages[0]).toEqual(SYS);
    expect(r.messages[1]).toEqual(TASK);
    assertPairingValid(r.messages);
  });

  it('falls back to elision when the summarizer fails (returns null)', async () => {
    const summarize: CompactionSummarizer = vi.fn(async () => null);
    const big = [SYS, TASK, ...round(1, 8_000), ...round(2, 8_000), ...round(3, 8_000), ...round(4, 200)];
    const r = await compactMessages(big, opts, summarize);
    expect(r.compacted).toBe(true);
    expect(r.summarized).toBe(false); // fell back
    assertPairingValid(r.messages);
  });

  it('never orphans a tool message even when the recent window starts mid-round', async () => {
    // recentMessages cuts the tail so it would start on a `tool` message — the tail
    // must back up to include its assistant parent.
    const big = [SYS, TASK, ...round(1, 9_000), ...round(2, 9_000), ...round(3, 9_000)];
    const r = await compactMessages(big, { ...opts, recentMessages: 1 });
    expect(r.compacted).toBe(true);
    assertPairingValid(r.messages);
  });
});

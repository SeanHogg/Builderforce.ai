import { describe, expect, it, vi } from 'vitest';
import { compactMessages, compactionBudget, CLOUD_COMPACT_DEFAULTS, type CompactionSummarizer } from './compactMessages';

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

const opts = { ...CLOUD_COMPACT_DEFAULTS, maxTokens: 5_000 };

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

/**
 * The anchor: the system prompt leads, and the task (the latest user directive) is kept
 * verbatim. Since compaction became `packHandoff`, the task sits AFTER the memory note
 * when it fell in the dropped middle (intentional — the packer pins the latest directive
 * immediately before the tail), so it is asserted by presence, not index 1.
 */
function assertAnchored(messages: Msg[]): void {
  expect(messages[0]).toEqual(SYS);
  expect(messages).toContainEqual(TASK);
}

describe('compactMessages', () => {
  it('is a no-op when under budget', async () => {
    const msgs = [SYS, TASK, ...round(0, 50)];
    const r = await compactMessages(msgs, opts);
    expect(r.compacted).toBe(false);
    expect(r.messages).toEqual(msgs);
  });

  it('drops the bulky middle when over budget (no summarizer), keeping head + tail + pairing', async () => {
    const big = [SYS, TASK, ...round(1, 8_000), ...round(2, 8_000), ...round(3, 8_000), ...round(4, 200), ...round(5, 200)];
    const r = await compactMessages(big, opts);
    expect(r.compacted).toBe(true);
    expect(r.summarized).toBe(false);
    expect(r.afterTokens).toBeLessThan(r.beforeTokens);
    expect(r.droppedMessages).toBeGreaterThan(0);
    assertAnchored(r.messages);
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
    const notes = r.messages.filter((m) => typeof m.content === 'string' && (m.content as string).includes('Compressed memory'));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.content as string).toContain('filter bar lives at line 42');
    assertAnchored(r.messages);
    assertPairingValid(r.messages);
  });

  it('falls back to the elision marker when the summarizer fails (returns null)', async () => {
    const summarize: CompactionSummarizer = vi.fn(async () => null);
    const big = [SYS, TASK, ...round(1, 8_000), ...round(2, 8_000), ...round(3, 8_000), ...round(4, 200)];
    const r = await compactMessages(big, opts, summarize);
    expect(r.compacted).toBe(true);
    expect(r.summarized).toBe(false); // fell back
    expect(r.messages.some((m) => typeof m.content === 'string' && /earlier messages omitted/.test(m.content as string))).toBe(true);
    assertPairingValid(r.messages);
  });

  it('uses the memory recall for the note when the summarizer is absent', async () => {
    const recall = vi.fn(async (_query: string, _budgetChars: number) => '[Evermind Memory] the filter bar lives in TaskBoard.tsx');
    const big = [SYS, TASK, ...round(1, 8_000), ...round(2, 8_000), ...round(3, 8_000), ...round(4, 200)];
    const r = await compactMessages(big, { ...opts, recall });
    expect(recall).toHaveBeenCalledOnce();
    expect(recall.mock.calls[0]![0]).toBe(TASK.content);
    expect(r.messages.some((m) => typeof m.content === 'string' && (m.content as string).includes('TaskBoard.tsx'))).toBe(true);
    assertPairingValid(r.messages);
  });

  it('never orphans a tool message when the budget cuts mid-round', async () => {
    const big = [SYS, TASK, ...round(1, 9_000), ...round(2, 9_000), ...round(3, 9_000)];
    const r = await compactMessages(big, opts);
    expect(r.compacted).toBe(true);
    assertPairingValid(r.messages);
  });

  it('sizes the budget to the serving model only when its window is smaller than the cap', () => {
    expect(compactionBudget({ maxTokens: 40_000 })).toBe(40_000);
    expect(compactionBudget({ maxTokens: 40_000, targetModel: 'no-such-model-in-the-catalog' })).toBe(40_000);
    // A 131k catalog window leaves the 40k cost cap in charge.
    expect(compactionBudget({ maxTokens: 40_000, targetModel: '@cf/zai-org/glm-4.7-flash', reserveOutputTokens: 4_096 })).toBe(40_000);
    expect(compactionBudget({ maxTokens: 200_000, targetModel: '@cf/zai-org/glm-4.7-flash', reserveOutputTokens: 4_096 })).toBe(131_072 - 4_096);
  });
});

/**
 * The cloud compaction tests, brought along from
 * `api/src/application/llm/compactMessages.test.ts` (WS2a) with the import retargeted
 * to the ported module and nothing else changed.
 *
 * One source case is NOT carried: "sizes the budget to the serving model only when its
 * window is smaller than the cap" reads the serving model's window out of the API's
 * vendor registry (`catalogEntry('@cf/zai-org/glm-4.7-flash').contextWindow`), data
 * this package does not hold — here the window comes from `ModelTransport.window()`
 * (`CompactOptions.contextWindow`), proven by the window case at the end of the file.
 */
import { describe, expect, it, vi } from 'vitest';
import { compactMessages, compactionBudget, elideToFit, maskOldObservations, toolsTokensOf, CLOUD_COMPACT_DEFAULTS, type CompactionSummarizer } from '../../src/policy/compaction/index.js';

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

  it('C9: caps the budget at the target model\'s long-context price-tier boundary while the lever is on', () => {
    // Gemini 2.5 Pro steps up above 200K input tokens; the family matches through any route prefix.
    const target = 'openrouter/google/gemini-2.5-pro';
    expect(compactionBudget({ maxTokens: 500_000, targetModel: target, env: {}, tenantId: 7 })).toBe(200_000);
    expect(compactionBudget({ maxTokens: 500_000, targetModel: target, env: { COST_LEVER_C9_PRICE_TIER_BUDGET: 'off' }, tenantId: 7 })).toBe(500_000);
    // No env = the caller did not opt in: no tier cap.
    expect(compactionBudget({ maxTokens: 500_000, targetModel: target })).toBe(500_000);
    // A flat-priced model is never capped by a tier.
    expect(compactionBudget({ maxTokens: 40_000, targetModel: 'no-such-model-in-the-catalog', env: {}, tenantId: 7 })).toBe(40_000);
  });

  it('charges the advertised tool schemas against the budget (no 413 on tool-heavy requests)', async () => {
    // ~3.3K tokens of messages: under the 5K cap alone, over it once ~2.5K of tool schemas ride along.
    const msgs = [SYS, TASK, ...round(1, 6_000), ...round(2, 6_000), ...round(3, 200)];
    const tools = [{ type: 'function', function: { name: 'read_file', description: 'D'.repeat(10_000), parameters: {} } }];
    expect((await compactMessages(msgs, opts)).compacted).toBe(false);

    const r = await compactMessages(msgs, { ...opts, tools });
    expect(r.compacted).toBe(true);
    expect(r.beforeTokens).toBeGreaterThan(opts.maxTokens);
    expect(r.afterTokens).toBeLessThanOrEqual(opts.maxTokens);
    expect(r.afterTokens - toolsTokensOf(tools)).toBeGreaterThan(0);
    assertAnchored(r.messages);
    assertPairingValid(r.messages);
  });

  it('reports before/after with the SAME estimator the packer used (after never exceeds the budget)', async () => {
    const big = [SYS, TASK, ...round(1, 8_000), ...round(2, 8_000), ...round(3, 8_000), ...round(4, 200)];
    const r = await compactMessages(big, opts);
    expect(r.afterTokens).toBeLessThanOrEqual(opts.maxTokens);
  });

  it('elideToFit truncates the largest tool results first, keeps the directive verbatim and never removes a message', () => {
    const msgs = [SYS, TASK, ...round(1, 20_000), ...round(2, 2_000)];
    const out = elideToFit(msgs, 2_000);
    expect(out).toHaveLength(msgs.length);
    assertAnchored(out);
    assertPairingValid(out);
    const [first, second] = [out[3]!.content as string, out[5]!.content as string];
    expect(first).toMatch(/chars elided to fit the context budget/);
    expect(first.length).toBeLessThan(20_000);
    // The small, recent result survives when the big one alone frees enough room.
    expect(second).toBe('X'.repeat(2_000));
  });

  it('elideToFit returns the input untouched when it already fits', () => {
    const msgs = [SYS, TASK, ...round(1, 100)];
    const out = elideToFit(msgs, 100_000);
    expect(out.every((m, i) => m === msgs[i])).toBe(true);
  });
});

describe('observation masking (C2) + task-brief pin', () => {
  const history = (rounds: number, payloadChars: number): Msg[] => {
    const out: Msg[] = [SYS, TASK];
    for (let i = 0; i < rounds; i++) out.push(...round(i, payloadChars));
    return out;
  };

  it('masks nothing until the run is 12 assistant turns in, then masks the oldest 6 in one step', () => {
    expect(maskOldObservations(history(11, 1_000)).masked).toBe(0);
    const r = maskOldObservations(history(12, 1_000));
    expect(r.masked).toBe(6);
    const tools = r.messages.filter((m) => m.role === 'tool');
    expect(String(tools[0]!.content)).toMatch(/^\[masked tool output: read_file\(\{\}\) — 1000 chars; re-run the tool to see it again\]$/);
    expect(tools[6]!.content).toBe('X'.repeat(1_000));
    assertPairingValid(r.messages);
  });

  it('is stable between steps (same boundary for 12..17 turns) and idempotent', () => {
    const at12 = maskOldObservations(history(12, 1_000)).messages;
    const at17 = maskOldObservations(history(17, 1_000)).messages;
    expect(at17.slice(0, at12.length)).toEqual(at12);
    expect(maskOldObservations(at12).masked).toBe(0);
  });

  it('masks before packing — and needs no summary when masking alone fits', async () => {
    const summarize = vi.fn<CompactionSummarizer>(async () => 'S');
    const r = await compactMessages(history(12, 2_000), { ...opts, maxTokens: 6_000, maskObservationsAfterTurns: 6 }, summarize);
    expect(r.compacted).toBe(true);
    expect(r.maskedObservations).toBe(6);
    expect(r.droppedMessages).toBe(0);
    expect(summarize).not.toHaveBeenCalled();
  });

  it('keeps the task brief through packing when a later nudge is the latest directive', async () => {
    const nudge: Msg = { role: 'user', content: 'Keep going — use the tools.' };
    const messages = [...history(10, 4_000), nudge, ...round(99, 4_000)];
    const pinned = await compactMessages(messages, { ...opts, pinTaskBrief: true });
    expect(pinned.compacted).toBe(true);
    expect(pinned.messages).toContain(TASK);
    expect(pinned.messages).toContain(nudge);
    assertPairingValid(pinned.messages);
    const unpinned = await compactMessages(messages, opts);
    expect(unpinned.messages).not.toContain(TASK);
  });
});

describe('the window and tier bounds, from the run's own ports', () => {
  it("sizes the budget to the serving model's window only when the window is smaller than the cap", () => {
    expect(compactionBudget({ maxTokens: 40_000 })).toBe(40_000);
    // A 40k cap against a 131k window leaves the cap in charge…
    expect(compactionBudget({ maxTokens: 40_000, contextWindow: 131_072, reserveOutputTokens: 4_096 })).toBe(40_000);
    // …a 200k cap yields to the 131k window less the reserve.
    expect(compactionBudget({ maxTokens: 200_000, contextWindow: 131_072, reserveOutputTokens: 4_096 })).toBe(131_072 - 4_096);
  });

  it("C9: caps the budget at the price-tier boundary only when the caller passes one (lever on)", () => {
    expect(compactionBudget({ maxTokens: 500_000 })).toBe(500_000);
    expect(compactionBudget({ maxTokens: 500_000, priceTierBoundary: 200_000, reserveOutputTokens: 4_096 })).toBe(200_000);
    expect(compactionBudget({ maxTokens: 40_000, priceTierBoundary: 200_000 })).toBe(40_000);
  });
});

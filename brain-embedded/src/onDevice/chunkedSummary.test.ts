import { describe, expect, it, vi } from 'vitest';
import { chunkedSummary } from './chunkedSummary';
import { MAX_SUMMARY_CHUNKS } from './taskRoutes';

/** 1 char = 1 token, a 100-token window: chunks must stay under 80. */
const budget = { limit: 100, measure: async (t: string) => t.length };
const paragraphs = (n: number, size = 20) => Array.from({ length: n }, (_, i) => `${i}`.padEnd(size, 'x')).join('\n\n');

describe('chunkedSummary', () => {
  it('summarizes an in-window text in one call', async () => {
    const summarizeChunk = vi.fn(async () => 'S');
    expect(await chunkedSummary({ text: 'short', budget, summarizeChunk })).toBe('S');
    expect(summarizeChunk).toHaveBeenCalledTimes(1);
  });

  it('splits a 5x-window transcript on paragraph boundaries, then merges', async () => {
    const seen: string[] = [];
    const summarizeChunk = vi.fn(async (c: string) => { seen.push(c); return 'sum'; });
    const text = paragraphs(20, 22); // ~ 20*24 = 480 chars ≈ 5x the window
    expect(await chunkedSummary({ text, budget, summarizeChunk })).toBe('sum');
    const leaves = seen.filter((c) => /^\d/.test(c)); // the merge call starts with 'sum'
    expect(leaves.length).toBeGreaterThan(1);
    for (const chunk of seen) expect(chunk.length).toBeLessThanOrEqual(80);
    // Each leaf ends on a paragraph boundary: nothing is cut mid-paragraph.
    expect(leaves.every((c) => c.split('\n\n').every((p) => p.trim().length === 22 || p.trim() === ''))).toBe(true);
  });

  it('recurses while the merged summaries are still over budget', async () => {
    const summarizeChunk = vi.fn(async (c: string) => c.slice(0, Math.ceil(c.length / 2)));
    const out = await chunkedSummary({ text: paragraphs(20, 22), budget, summarizeChunk });
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(80);
  });

  it('returns null past MAX_SUMMARY_CHUNKS leaf chunks without summarizing any', async () => {
    const summarizeChunk = vi.fn(async () => 'S');
    const text = paragraphs(MAX_SUMMARY_CHUNKS * 4 + 4, 40); // > 8 chunks of <= 80
    expect(await chunkedSummary({ text, budget, summarizeChunk })).toBeNull();
    expect(summarizeChunk).not.toHaveBeenCalled();
  });

  it('is null when the device declines a chunk', async () => {
    expect(await chunkedSummary({ text: paragraphs(6, 40), budget, summarizeChunk: async () => null })).toBeNull();
  });

  it('is null when a merge does not shrink the text', async () => {
    expect(await chunkedSummary({ text: paragraphs(6, 40), budget, summarizeChunk: async (c) => c })).toBeNull();
  });

  it('terminates on a paragraph longer than the window followed by a short one, preserving content', async () => {
    const seen: string[] = [];
    const text = `${'a'.repeat(300)}

short`;
    const out = await chunkedSummary({ text, budget, summarizeChunk: async (c) => { seen.push(c); return 'S'; } });
    expect(out).toBe('S');
    const leaves = seen.slice(0, -1); // the last call merges the summaries
    expect(leaves.length).toBeGreaterThan(1);
    for (const c of leaves) expect(c.length).toBeLessThanOrEqual(80);
    expect(leaves.join('')).toBe(text);
  });

  it('reserves output tokens out of the window', async () => {
    const seen: string[] = [];
    const text = paragraphs(10, 22);
    await chunkedSummary({ text, budget, reserveTokens: 50, summarizeChunk: async (c) => { seen.push(c); return 's'; } });
    for (const c of seen.filter((c) => /^\d/.test(c))) expect(c.length).toBeLessThanOrEqual(40);
  });

  it('re-measures a chunk and splits again when the estimate under-cut', async () => {
    const seen: string[] = [];
    // Tokens are 2x chars for digit-leading text, so the first char-ratio estimate is too generous.
    const lumpy = { limit: 100, measure: async (t: string) => (t.includes('9') ? t.length * 2 : t.length) };
    await chunkedSummary({ text: paragraphs(12, 22), budget: lumpy, summarizeChunk: async (c) => { seen.push(c); return 's'; } });
    for (const c of seen.filter((c) => /^\d/.test(c))) expect(await lumpy.measure(c)).toBeLessThanOrEqual(80);
  });

  it('throws only AbortError', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(chunkedSummary({ text: 'x', budget, summarizeChunk: async () => 'S', signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
  });
});

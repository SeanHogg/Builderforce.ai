import { describe, expect, it, vi } from 'vitest';
import { streamSummaryCompletion, summarizeMiddle, type SummaryStreamFn } from './transcriptSummarizer';
import { localFirstApplies } from './localFirstTransport';
import type { OnDeviceTasks } from './onDevice/onDeviceTasks';

const replying = (text: string): SummaryStreamFn => async () => ({ text });
const request = { system: 's', user: 'u', maxTokens: 100 };

describe('streamSummaryCompletion', () => {
  it('keeps the note and drops the inline reasoning a model ignored `reasoning: off` with', async () => {
    const note = await streamSummaryCompletion(replying('<think>We need produce memory…</think>\n\nTask: remove the header title. Files: VsCodeChatHeader.tsx:57.'), undefined)(request);
    expect(note).toBe('Task: remove the header title. Files: VsCodeChatHeader.tsx:57.');
  });

  it('keeps a reasoning-only reply as plain text — no markup, and never an empty note that re-runs every turn', async () => {
    const note = await streamSummaryCompletion(replying('<think>Task: remove the title. Read VsCodeChatHeader.tsx: InlineChatTitle at line 57'), undefined)(request);
    expect(note).toBe('Task: remove the title. Read VsCodeChatHeader.tsx: InlineChatTitle at line 57');
    expect(note).not.toContain('<think>');
  });

  it('passes a plain note through untouched', async () => {
    expect(await streamSummaryCompletion(replying('Task: X. Done: Y.'), undefined)(request)).toBe('Task: X. Done: Y.');
  });
});

describe('utility role and on-device first (PRD 42 · C)', () => {
  const tasksReturning = (summary: string | null): OnDeviceTasks => ({ summarize: vi.fn(async () => summary) }) as unknown as OnDeviceTasks;
  const counting = (text: string) => {
    const calls: Array<Parameters<SummaryStreamFn>[0]> = [];
    const stream: SummaryStreamFn = async (opts) => { calls.push(opts); return { text }; };
    return { stream, calls };
  };

  it('stamps role "utility" on the stream request', async () => {
    const { stream, calls } = counting('note');
    await streamSummaryCompletion(stream, undefined)(request);
    expect(calls[0]!.role).toBe('utility');
  });

  it('a fold under a pinned paid model never streams when the device summarizes', async () => {
    const { stream, calls } = counting('PAID');
    const tasks = tasksReturning('device note');
    const out = await summarizeMiddle(stream, 'anthropic/claude-sonnet', [{ role: 'user', content: 'hi' }], undefined, tasks);
    expect(out).toBe('device note');
    expect(calls).toHaveLength(0);
    expect(tasks.summarize).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ kind: 'transcript' }));
  });

  it('streams exactly as before when the device declines', async () => {
    const { stream, calls } = counting('streamed note');
    const out = await summarizeMiddle(stream, 'anthropic/claude-sonnet', [{ role: 'user', content: 'hi' }], undefined, tasksReturning(null));
    expect(out).toBe('streamed note');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.model).toBe('anthropic/claude-sonnet');
  });
});

describe('localFirstApplies', () => {
  it('is true for a utility call even with a pinned model, and unchanged otherwise', () => {
    expect(localFirstApplies({ model: 'anthropic/claude-sonnet', role: 'utility' })).toBe(true);
    expect(localFirstApplies({ model: 'anthropic/claude-sonnet' })).toBe(false);
    expect(localFirstApplies({ routingMode: 'byo_pool' })).toBe(false);
    expect(localFirstApplies({})).toBe(true);
  });
});

describe('summarizeMiddle', () => {
  it('folds onto the untagged note, never the <think> markup chat #5739 persisted', async () => {
    const out = await summarizeMiddle(replying('<think>Files read: runSteering.ts'), undefined, [{ role: 'user', content: 'hi' }], undefined);
    expect(out).toBe('Files read: runSteering.ts');
  });

  it('is null (the caller falls back) only for a reply with no text at all', async () => {
    expect(await summarizeMiddle(replying('<think></think>'), undefined, [{ role: 'user', content: 'hi' }], undefined)).toBeNull();
  });
});

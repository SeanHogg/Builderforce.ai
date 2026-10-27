import { describe, expect, it } from 'vitest';
import { streamSummaryCompletion, summarizeMiddle, type SummaryStreamFn } from './transcriptSummarizer';

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

describe('summarizeMiddle', () => {
  it('folds onto the untagged note, never the <think> markup chat #5739 persisted', async () => {
    const out = await summarizeMiddle(replying('<think>Files read: runSteering.ts'), undefined, [{ role: 'user', content: 'hi' }], undefined);
    expect(out).toBe('Files read: runSteering.ts');
  });

  it('is null (the caller falls back) only for a reply with no text at all', async () => {
    expect(await summarizeMiddle(replying('<think></think>'), undefined, [{ role: 'user', content: 'hi' }], undefined)).toBeNull();
  });
});

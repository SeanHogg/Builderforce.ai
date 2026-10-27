import { describe, expect, it, vi } from 'vitest';
import { MODEL_TEXT_META_KEY, attachmentTurn, recordedModelText, userTurnContentOf, userTurnTextOf, withoutBlobLinks } from './attachmentTranscript';
import { attachmentLink } from './attachmentContent';
import { transcriptSeedOf } from './transcriptSeed';
import type { BrainMessage, ChatInputAttachment } from './types';

const preview = (key: string) => `blob:vscode-webview://abc/${key}`;
const doc: ChatInputAttachment = { key: 'k1', name: 'notes.md', type: 'text/markdown' };
const img: ChatInputAttachment = { key: 'k2', name: 'shot.png', type: 'image/png', imageUrl: 'data:image/png;base64,AAA' };
const BLOCK = 'Attached file: notes.md\n```\nthe notes\n```';

const row = (id: number, role: string, content: string, metadata: Record<string, unknown> | null = null): BrainMessage =>
  ({ id, role, content, metadata: metadata ? JSON.stringify(metadata) : null, seq: id, createdAt: '' });

/** What `useBrainConversation.send` persists for `attachments` (display + metadata). */
async function sent(attachments: ChatInputAttachment[], inlineAttachments?: () => Promise<{ text: string; keys: string[] } | null>) {
  const display = `look\n\n${attachments.map((a) => attachmentLink(a, preview)).join('\n')}`;
  const turn = await attachmentTurn('look', display, attachments, { uploadUrl: preview, ...(inlineAttachments ? { inlineAttachments } : {}) });
  return { turn, persisted: row(1, 'user', display, turn.meta ?? null) };
}

describe('withoutBlobLinks / recordedModelText', () => {
  it('reduces a blob: link to its label and leaves real links', () => {
    expect(withoutBlobLinks('[Attached: a.png](blob:vscode-webview://x/1) [doc](https://x/k)')).toBe('[Attached: a.png] [doc](https://x/k)');
  });

  it('records only the text of vision content', () => {
    expect(recordedModelText([{ type: 'text', text: 'hi' }, { type: 'image_url', image_url: { url: 'data:x' } }])).toBe('hi');
  });
});

describe('a turn with an inlined attachment survives the next run, a retry and a reload', () => {
  it('records the text the model read, and the transcript re-sends it — not the dead preview link', async () => {
    const { turn, persisted } = await sent([doc], vi.fn(async () => ({ text: BLOCK, keys: ['k1'] })));
    expect(turn.content).toBe(`look\n\n${BLOCK}`);
    expect(JSON.parse(persisted.metadata!)[MODEL_TEXT_META_KEY]).toBe(`look\n\n${BLOCK}`);
    const seed = transcriptSeedOf([persisted, row(2, 'assistant', 'done')]).messages;
    expect(seed[0]).toEqual({ role: 'user', content: `look\n\n${BLOCK}` });
    expect(JSON.stringify(seed)).not.toContain('blob:');
    // The same prefix the turn was sent with: the next run hits the prompt cache.
    expect(seed[0]!.content).toBe(turn.content);
  });

  it('re-runs a retried or reloaded turn with its recorded text and its inline pictures', async () => {
    const { persisted } = await sent([doc, img], vi.fn(async () => ({ text: BLOCK, keys: ['k1'] })));
    expect(userTurnContentOf(persisted)).toEqual([
      { type: 'text', text: `look\n\n${BLOCK}` },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
    ]);
  });

  it('never records or re-sends a blob: link, even for an attachment that stayed a link', async () => {
    const { persisted } = await sent([{ key: 'k3', name: 'a.zip', type: 'application/zip' }]);
    expect(persisted.metadata).not.toContain('blob:');
    expect(userTurnTextOf(persisted)).toBe('look\n\n[Attached: a.zip]');
  });

  it("records nothing extra when the model read exactly what is displayed (the web's links)", async () => {
    const turn = await attachmentTurn('hi', 'hi\n\n[Attached: a.pdf](https://x/k)', [{ key: 'k', name: 'a.pdf', type: 'application/pdf' }], { uploadUrl: (k) => `https://x/${k}` });
    expect(turn.meta).not.toHaveProperty(MODEL_TEXT_META_KEY);
    expect(turn.meta).toHaveProperty('attachments');
  });

  it('reads an older row (no recorded text) without its blob links, and a plain row as it is', () => {
    expect(userTurnContentOf(row(1, 'user', 'see [Attached: a.md](blob:vscode-webview://x/1)'))).toBe('see [Attached: a.md]');
    expect(userTurnContentOf(row(2, 'user', 'plain'))).toBe('plain');
    expect(userTurnContentOf(row(3, 'user', 'x', { attachments: [{ key: 's', imageUrl: 'https://signed/expired' }] }))).toBe('x');
  });
});

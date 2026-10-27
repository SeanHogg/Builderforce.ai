import { beforeEach, describe, expect, it, vi } from 'vitest';

const prep = vi.hoisted(() => ({ next: null as unknown }));
vi.mock('./imagePrep', () => ({ prepareImageDataUrl: vi.fn(async () => prep.next) }));

import { AttachmentRefusedError, attachmentTurnContent, prepareAttachment } from './attachmentContent';
import { prepareImageDataUrl } from './imagePrep';
import type { ChatInputAttachment } from './types';

const uploadUrl = (key: string) => `https://x/${key}`;

describe('attachmentTurnContent', () => {
  const doc: ChatInputAttachment = { key: 'k1', name: 'notes.md', type: 'text/markdown' };
  const bin: ChatInputAttachment = { key: 'k2', name: 'a.pdf', type: 'application/pdf' };
  const img: ChatInputAttachment = { key: 'k3', name: 'shot.png', type: 'image/png', imageUrl: 'data:image/png;base64,AAA' };

  it('is the text itself with no attachments', async () => {
    expect(await attachmentTurnContent('hi', [], { uploadUrl })).toBe('hi');
  });

  it('keeps every attachment a link when the host cannot read them (the web)', async () => {
    expect(await attachmentTurnContent('hi', [doc, bin], { uploadUrl })).toBe(
      'hi\n\n[Attached: notes.md](https://x/k1)\n[Attached: a.pdf](https://x/k2)',
    );
  });

  it('inlines what the host read and links only the rest', async () => {
    const inlineAttachments = vi.fn(async () => ({ text: 'Attached file: notes.md\n```\nbody\n```', keys: ['k1'] }));
    const out = await attachmentTurnContent('hi', [doc, bin], { uploadUrl, inlineAttachments });
    expect(inlineAttachments).toHaveBeenCalledWith([doc, bin]);
    expect(out).toBe('hi\n\n[Attached: a.pdf](https://x/k2)\n\nAttached file: notes.md\n```\nbody\n```');
  });

  it('puts the inlined text in the text part beside the vision parts, never sending pictures to be read', async () => {
    const inlineAttachments = vi.fn(async () => ({ text: 'BLOCK', keys: ['k1'] }));
    const out = await attachmentTurnContent('look', [doc, img], { uploadUrl, inlineAttachments });
    expect(inlineAttachments).toHaveBeenCalledWith([doc]);
    expect(out).toEqual([
      { type: 'text', text: 'look\n\nBLOCK' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
    ]);
  });

  it('falls back to links when the host fails or answers nothing', async () => {
    const failing = { uploadUrl, inlineAttachments: vi.fn(async () => { throw new Error('host gone'); }) };
    expect(await attachmentTurnContent('hi', [doc], failing)).toBe('hi\n\n[Attached: notes.md](https://x/k1)');
    const empty = { uploadUrl, inlineAttachments: vi.fn(async () => null) };
    expect(await attachmentTurnContent('hi', [doc], empty)).toBe('hi\n\n[Attached: notes.md](https://x/k1)');
  });
});

describe('prepareAttachment', () => {
  beforeEach(() => {
    prep.next = null;
    vi.mocked(prepareImageDataUrl).mockClear();
  });

  it('uploads a non-picture as it is', async () => {
    const file = new File(['x'], 'a.txt', { type: 'text/plain' });
    const upload = vi.fn(async () => ({ key: 'k', name: 'a.txt', type: 'text/plain' }));
    expect(await prepareAttachment(file, { upload })).toEqual({ key: 'k', name: 'a.txt', type: 'text/plain' });
    expect(upload).toHaveBeenCalledWith(file);
  });

  it('uploads the prepared picture, not the original, and keeps the name the person attached', async () => {
    const original = new File(['big'], 'shot.png', { type: 'image/png' });
    const small = new File(['s'], 'shot.jpg', { type: 'image/jpeg' });
    prep.next = { dataUrl: 'data:image/jpeg;base64,BBB', file: small };
    const upload = vi.fn(async () => ({ key: 'k', name: 'shot.jpg', type: 'image/jpeg' }));
    const a = await prepareAttachment(original, { upload }, { maxEdge: 1024, jpegQuality: 0.8 });
    expect(prepareImageDataUrl).toHaveBeenCalledWith(original, { maxEdge: 1024, jpegQuality: 0.8 });
    expect(upload).toHaveBeenCalledWith(small);
    expect(a).toEqual({ key: 'k', name: 'shot.png', type: 'image/jpeg', imageUrl: 'data:image/jpeg;base64,BBB' });
  });

  it('signs a URL for a picture too large to inline', async () => {
    prep.next = { tooLarge: true };
    const upload = vi.fn(async () => ({ key: 'k', name: 'huge.png', type: 'image/png' }));
    const signedUploadUrl = vi.fn(async () => 'https://signed/k');
    const a = await prepareAttachment(new File(['x'], 'huge.png', { type: 'image/png' }), { upload, signedUploadUrl });
    expect(a.imageUrl).toBe('https://signed/k');
  });

  it("surfaces a host's refusal instead of leaving a dead link, and swallows any other signing failure", async () => {
    prep.next = { tooLarge: true };
    const upload = vi.fn(async () => ({ key: 'k', name: 'huge.png', type: 'image/png' }));
    const refused = vi.fn(async () => { throw new AttachmentRefusedError('Sign in to attach large pictures.'); });
    await expect(prepareAttachment(new File(['x'], 'huge.png', { type: 'image/png' }), { upload, signedUploadUrl: refused }))
      .rejects.toThrow('Sign in to attach large pictures.');
    const flaky = vi.fn(async () => { throw new Error('network'); });
    const a = await prepareAttachment(new File(['x'], 'huge.png', { type: 'image/png' }), { upload, signedUploadUrl: flaky });
    expect(a.imageUrl).toBeUndefined();
  });

  it('keeps an inline picture local when the host can, and still uploads one that must be signed', async () => {
    const small = new File(['s'], 'shot.jpg', { type: 'image/jpeg' });
    prep.next = { dataUrl: 'data:image/jpeg;base64,BBB', file: small };
    const upload = vi.fn(async () => ({ key: 'up', name: 'shot.jpg', type: 'image/jpeg' }));
    const keepLocal = vi.fn(async () => ({ key: 'local', name: 'shot.jpg', type: 'image/jpeg' }));
    const a = await prepareAttachment(new File(['big'], 'shot.png', { type: 'image/png' }), { upload, keepLocal });
    expect(keepLocal).toHaveBeenCalledWith(small);
    expect(upload).not.toHaveBeenCalled();
    expect(a).toEqual({ key: 'local', name: 'shot.png', type: 'image/jpeg', imageUrl: 'data:image/jpeg;base64,BBB' });

    prep.next = { tooLarge: true };
    keepLocal.mockClear();
    const signedUploadUrl = vi.fn(async () => 'https://signed/up');
    const huge = await prepareAttachment(new File(['x'], 'huge.png', { type: 'image/png' }), { upload, keepLocal, signedUploadUrl });
    expect(keepLocal).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(huge.imageUrl).toBe('https://signed/up');
  });
});

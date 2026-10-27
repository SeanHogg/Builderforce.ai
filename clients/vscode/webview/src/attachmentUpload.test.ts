import { beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({
  calls: [] as Array<{ type: string; payload: Record<string, unknown> }>,
  answer: (_type: string, _payload: Record<string, unknown>): unknown => undefined,
}));
vi.mock('./bridgeTransport', () => ({
  request: vi.fn(async (type: string, payload: Record<string, unknown>) => {
    host.calls.push({ type, payload });
    return host.answer(type, payload);
  }),
}));

import { AttachmentRefusedError, MAX_INLINE_TEXT_BYTES } from '@seanhogg/builderforce-brain-embedded';
import { base64Of, readAttachmentText } from './attachmentUpload';
import { createHostPersistence } from './hostPersistence';

const ingressOps = () => host.calls.filter((c) => c.type === 'attachment.ingress').map((c) => c.payload.op);

beforeEach(() => {
  host.calls = [];
  host.answer = () => undefined;
});

describe('readAttachmentText', () => {
  it('reads text by type, and sniffs an untyped file', async () => {
    expect(await readAttachmentText(new File(['# Notes'], 'notes.md', { type: 'text/markdown' }))).toBe('# Notes');
    expect(await readAttachmentText(new File(['export const a = 1;'], 'a.ts', { type: '' }))).toBe('export const a = 1;');
    expect(await readAttachmentText(new File(['{"a":1}'], 'a.json', { type: 'application/json' }))).toBe('{"a":1}');
  });

  it('refuses binaries, NUL-bearing bytes, invalid UTF-8 and oversized files', async () => {
    expect(await readAttachmentText(new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }))).toBeNull();
    expect(await readAttachmentText(new File([new Uint8Array([65, 0, 66])], 'a.bin', { type: '' }))).toBeNull();
    expect(await readAttachmentText(new File([new Uint8Array([0xc3, 0x28])], 'bad.txt', { type: '' }))).toBeNull();
    expect(await readAttachmentText(new File(['x'.repeat(MAX_INLINE_TEXT_BYTES + 1)], 'big.txt', { type: 'text/plain' }))).toBeNull();
  });

  it('encodes bytes as base64', async () => {
    expect(await base64Of(new File(['hello'], 'h.bin'))).toBe(btoa('hello'));
  });
});

describe('the VS Code persistence adapter, against a mocked host', () => {
  it('records a text attachment locally and hands its text to the host to inline', async () => {
    host.answer = (type) => (type === 'local.persistence' ? { key: 'k1', name: 'notes.md', type: 'text/markdown' } : { key: 'k1' });
    const p = createHostPersistence();
    const saved = await p.upload(new File(['# Notes'], 'notes.md', { type: 'text/markdown' }));
    expect(saved).toEqual({ key: 'k1', name: 'notes.md', type: 'text/markdown' });
    expect(host.calls[0]).toMatchObject({ type: 'local.persistence', payload: { method: 'upload' } });
    expect(host.calls[1]).toMatchObject({ type: 'attachment.ingress', payload: { op: 'store', key: 'k1', name: 'notes.md', text: '# Notes' } });
    // Its link is the local preview — the model gets the text, not this.
    expect(p.uploadUrl('k1')).toMatch(/^blob:/);
  });

  it('uploads a binary through the host and names the platform URL', async () => {
    host.answer = () => ({ key: '7/u/a.pdf', name: 'a.pdf', type: 'application/pdf', url: 'https://api/api/brain/uploads/7/u/a.pdf' });
    const p = createHostPersistence();
    const saved = await p.upload(new File([new Uint8Array([37, 80, 68, 70, 0])], 'a.pdf', { type: 'application/pdf' }));
    expect(saved).toEqual({ key: '7/u/a.pdf', name: 'a.pdf', type: 'application/pdf' });
    // Admitted (Local only, the platform's ceiling) before the bytes are encoded and posted.
    expect(ingressOps()).toEqual(['admit', 'upload']);
    expect(host.calls[0]!.payload).toEqual({ op: 'admit', name: 'a.pdf', mime: 'application/pdf', size: 5 });
    expect(host.calls[1]!.payload.data).toBe(btoa(String.fromCharCode(37, 80, 68, 70, 0)));
    expect(p.uploadUrl('7/u/a.pdf')).toBe('https://api/api/brain/uploads/7/u/a.pdf');
  });

  it('fails a binary that cannot be uploaded with the host sentence, never a dead link', async () => {
    host.answer = () => { throw new Error('Sign in to BuilderForce to attach a.pdf'); };
    const p = createHostPersistence();
    await expect(p.upload(new File([new Uint8Array([0, 1])], 'a.pdf', { type: 'application/pdf' }))).rejects.toThrow('Sign in to BuilderForce to attach a.pdf');
    expect(host.calls.some((c) => c.type === 'local.persistence')).toBe(false);
  });

  it('keeps a picture that could not be uploaded, and refuses to sign it with the reason', async () => {
    host.answer = (type) => {
      if (type === 'attachment.ingress') throw new Error('Sign in to BuilderForce to attach shot.png');
      return { key: 'local-1', name: 'shot.png', type: 'image/png' };
    };
    const p = createHostPersistence();
    const saved = await p.upload(new File([new Uint8Array([137, 80, 78, 71, 0])], 'shot.png', { type: 'image/png' }));
    expect(saved.key).toBe('local-1');
    const refusal = p.signedUploadUrl!('local-1');
    await expect(refusal).rejects.toBeInstanceOf(AttachmentRefusedError);
    await expect(refusal).rejects.toThrow('Sign in to BuilderForce to attach shot.png');
  });

  it('signs an uploaded picture and inlines through the host', async () => {
    host.answer = (_type, payload) => {
      if (payload.op === 'upload') return { key: '7/u/s.png', name: 's.png', type: 'image/png', url: 'https://api/x' };
      if (payload.op === 'sign') return 'https://signed/s.png';
      if (payload.op === 'inline') return { text: 'BLOCK', keys: ['k1'] };
      return undefined;
    };
    const p = createHostPersistence();
    await p.upload(new File([new Uint8Array([137, 80, 78, 71, 0])], 's.png', { type: 'image/png' }));
    expect(await p.signedUploadUrl!('7/u/s.png')).toBe('https://signed/s.png');
    expect(await p.inlineAttachments!([{ key: 'k1', name: 'notes.md', type: 'text/markdown' }])).toEqual({ text: 'BLOCK', keys: ['k1'] });
    expect(host.calls.at(-1)!.payload).toEqual({ op: 'inline', attachments: [{ key: 'k1', name: 'notes.md' }] });
  });

  it('never sends a picture the model receives inline: it is recorded locally only', async () => {
    host.answer = (type) => (type === 'local.persistence' ? { key: 'local-2', name: 'shot.png', type: 'image/png' } : undefined);
    const p = createHostPersistence();
    const saved = await p.keepLocal!(new File([new Uint8Array([137, 80, 78, 71, 0])], 'shot.png', { type: 'image/png' }));
    expect(saved.key).toBe('local-2');
    expect(host.calls.map((c) => c.type)).toEqual(['local.persistence']);
  });

  it('does not encode or post a file the host refuses to admit (Local only, too large)', async () => {
    host.answer = (_type, payload) => {
      if (payload.op === 'admit') throw new Error('Local only is on, so a.pdf stays on this machine');
      return undefined;
    };
    const p = createHostPersistence();
    await expect(p.upload(new File([new Uint8Array([37, 80, 68, 70, 0])], 'a.pdf', { type: 'application/pdf' }))).rejects.toThrow('Local only is on');
    expect(ingressOps()).toEqual(['admit']);
    expect(host.calls.some((c) => 'data' in c.payload)).toBe(false);
  });

  it('names the MIME type `mime`, never the envelope field `type`', async () => {
    host.answer = () => ({ key: 'k', name: 'a.pdf', type: 'application/pdf', url: 'https://x' });
    await createHostPersistence().upload(new File([new Uint8Array([37, 80, 68, 70, 0])], 'a.pdf', { type: 'application/pdf' }));
    for (const c of host.calls) expect(c.payload).not.toHaveProperty('type');
  });
});

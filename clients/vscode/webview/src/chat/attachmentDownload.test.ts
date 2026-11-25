import { describe, expect, it, vi } from 'vitest';

// The real transport acquires the VS Code API at load; every request here goes through the injected `send`.
vi.mock('../bridgeTransport', () => ({ request: vi.fn() }));

import { ATTACHMENT_DOWNLOAD_MAX_BYTES } from '../../../src/attachments/attachmentLimits';
import { createHostAttachmentDownload } from './attachmentDownload';

const tooLarge = (name: string) => `${name} is too large`;

describe('the editor\'s attachment download port', () => {
  it('regression: hands an account URL to the host (which holds the credential) and reports the save', async () => {
    const send = vi.fn(async () => ({ saved: true })) as never;
    const download = createHostAttachmentDownload({ tooLarge, send });
    expect(await download({ name: 'spec.pdf', type: 'application/pdf', downloadUrl: 'https://api.example/api/brain/uploads/k1' })).toBe(true);
    expect(send).toHaveBeenCalledWith('attachment.download', { name: 'spec.pdf', mime: 'application/pdf', url: 'https://api.example/api/brain/uploads/k1' });
  });

  it('reads a blob: URL here (the host cannot) and sends its bytes', async () => {
    const send = vi.fn(async () => ({ saved: true })) as never;
    const readBlob = vi.fn(async () => new Blob(['hello']));
    const download = createHostAttachmentDownload({ tooLarge, send, readBlob });
    await download({ name: 'notes.txt', downloadUrl: 'blob:vscode-webview://x/1' });
    expect(readBlob).toHaveBeenCalledWith('blob:vscode-webview://x/1');
    expect(send).toHaveBeenCalledWith('attachment.download', { name: 'notes.txt', data: btoa('hello') });
  });

  it('regression: refuses a blob over the shared ceiling BEFORE encoding it or posting to the host', async () => {
    const send = vi.fn(async () => ({ saved: true }));
    const huge = { size: ATTACHMENT_DOWNLOAD_MAX_BYTES + 1 } as Blob;
    const readBlob = vi.fn(async () => huge);
    const download = createHostAttachmentDownload({ tooLarge, send: send as never, readBlob });
    await expect(download({ name: 'movie.mov', downloadUrl: 'blob:vscode-webview://x/2' })).rejects.toThrow('movie.mov is too large');
    // Declared too large: not even read.
    await expect(download({ name: 'movie.mov', size: ATTACHMENT_DOWNLOAD_MAX_BYTES + 1, downloadUrl: 'blob:vscode-webview://x/3' })).rejects.toThrow('movie.mov is too large');
    expect(readBlob).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('answers false when the person cancelled the save dialog, and passes the host\'s refusal through', async () => {
    const cancelled = createHostAttachmentDownload({ tooLarge, send: (async () => ({ saved: false })) as never });
    expect(await cancelled({ name: 'a.png', downloadUrl: 'data:image/png;base64,AA==' })).toBe(false);
    const refused = createHostAttachmentDownload({ tooLarge, send: (async () => { throw new Error('Sign in to BuilderForce to download a.png.'); }) as never });
    await expect(refused({ name: 'a.png', downloadUrl: 'https://api.example/x' })).rejects.toThrow('Sign in to BuilderForce to download a.png.');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

const media = vi.hoisted(() => ({ fetchCanvasMediaBlob: vi.fn<(url: string) => Promise<Blob>>() }));
vi.mock('@/lib/canvasMediaStore', () => media);

const ui = vi.hoisted(() => ({ saveBlobAs: vi.fn(), browserDownload: vi.fn(async () => true) }));
vi.mock('@seanhogg/builderforce-brain-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@seanhogg/builderforce-brain-ui')>()),
  saveBlobAs: ui.saveBlobAs,
  browserDownload: ui.browserDownload,
}));

import { webAttachmentDownload } from './webAttachmentDownload';

const UPLOAD = 'https://api.example/api/brain/uploads/t1/k1';

afterEach(() => { vi.clearAllMocks(); });

describe('the web attachment download port', () => {
  it('regression: reads an uploaded file through the authorized media fetch (bearer token), not a cookie fetch', async () => {
    const blob = new Blob(['pdf']);
    media.fetchCanvasMediaBlob.mockResolvedValueOnce(blob);
    expect(await webAttachmentDownload({ name: 'spec.pdf', downloadUrl: UPLOAD })).toBe(true);
    expect(media.fetchCanvasMediaBlob).toHaveBeenCalledWith(UPLOAD);
    expect(ui.saveBlobAs).toHaveBeenCalledWith(blob, 'spec.pdf');
    expect(ui.browserDownload).not.toHaveBeenCalled();
  });

  it('falls back to the picture\'s data: copy when the authorized read fails', async () => {
    media.fetchCanvasMediaBlob.mockRejectedValueOnce(new Error('media fetch failed: 401'));
    await webAttachmentDownload({ name: 'shot.png', downloadUrl: UPLOAD, previewUrl: 'data:image/png;base64,AA' });
    expect(ui.browserDownload).toHaveBeenCalledWith({ name: 'shot.png', downloadUrl: 'data:image/png;base64,AA', previewUrl: 'data:image/png;base64,AA' });
  });

  it('with no copy, fails with no English message (the preview shows its own "Download failed")', async () => {
    media.fetchCanvasMediaBlob.mockRejectedValueOnce(new Error('media fetch failed: 401'));
    await expect(webAttachmentDownload({ name: 'spec.pdf', downloadUrl: UPLOAD })).rejects.toThrow(/^$/);
  });

  it('leaves a file on this device (blob:/data:) to the browser\'s own download', async () => {
    await webAttachmentDownload({ name: 'a.txt', downloadUrl: 'blob:https://app/1' });
    expect(media.fetchCanvasMediaBlob).not.toHaveBeenCalled();
    expect(ui.browserDownload).toHaveBeenCalled();
  });
});

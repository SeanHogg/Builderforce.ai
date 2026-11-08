import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestMock = vi.fn();
const stream = vi.fn();
vi.mock('@/lib/builderforceApi', () => ({ request: (path: string, opts: unknown) => requestMock(path, opts) }));
vi.mock('@/lib/apiClient', () => ({ apiRequestStream: (path: string) => stream(path) }));
vi.mock('@/lib/auth', () => ({ AUTH_API_URL: 'https://api.example.com' }));
vi.mock('@seanhogg/builderforce-brain-embedded', () => ({ BRAIN_UPLOAD_PATH: '/api/brain/upload' }));

import { fetchCanvasMediaBlob, uploadCanvasFile } from './canvasMediaStore';

beforeEach(() => { requestMock.mockReset(); stream.mockReset(); });

describe('uploadCanvasFile', () => {
  it('sends the file with visibility=private', async () => {
    requestMock.mockResolvedValue({ key: '7/private/media/abc.png', private: true });
    await uploadCanvasFile(new File(['x'], 'a.png', { type: 'image/png' }));
    const [path, opts] = requestMock.mock.calls[0] as [string, { method: string; body: FormData }];
    expect(path).toBe('/api/brain/upload');
    expect(opts.method).toBe('POST');
    expect(opts.body.get('visibility')).toBe('private');
    expect(opts.body.get('file')).toBeInstanceOf(File);
  });

  it('returns the tenant-authenticated brain uploads URL, never the public assets URL', async () => {
    requestMock.mockResolvedValue({ key: '7/private/media/abc 1.png', private: true });
    const uploaded = await uploadCanvasFile(new File(['x'], 'a.png'));
    expect(uploaded).toEqual({
      url: 'https://api.example.com/api/brain/uploads/7/private/media/abc%201.png',
      storageKey: '7/private/media/abc 1.png',
    });
    expect(uploaded?.url).not.toContain('/api/assets/');
  });

  it('returns null when the upload fails', async () => {
    requestMock.mockRejectedValue(new Error('nope'));
    expect(await uploadCanvasFile(new File(['x'], 'a.png'))).toBeNull();
  });

  it('produces a URL fetchCanvasMediaBlob reads through the authenticated helper', async () => {
    requestMock.mockResolvedValue({ key: '7/private/media/abc.png', private: true });
    const uploaded = await uploadCanvasFile(new File(['x'], 'a.png'));
    const blob = new Blob(['x']);
    stream.mockResolvedValue({ ok: true, blob: async () => blob });
    expect(await fetchCanvasMediaBlob(uploaded!.url)).toBe(blob);
    expect(stream).toHaveBeenCalledWith('/api/brain/uploads/7/private/media/abc.png');
  });
});

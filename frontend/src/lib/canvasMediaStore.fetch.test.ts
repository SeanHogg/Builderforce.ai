import { beforeEach, describe, expect, it, vi } from 'vitest';

const stream = vi.fn();
vi.mock('@/lib/builderforceApi', () => ({ brain: {} }));
vi.mock('@/lib/apiClient', () => ({ apiRequestStream: (path: string) => stream(path) }));
vi.mock('@/lib/auth', () => ({ AUTH_API_URL: 'https://api.example.com' }));

import { fetchCanvasMediaBlob } from './canvasMediaStore';

beforeEach(() => { stream.mockReset(); vi.unstubAllGlobals(); });

describe('fetchCanvasMediaBlob', () => {
  it('reads a tenant-authenticated upload URL through the authenticated request helper', async () => {
    const blob = new Blob(['x']);
    stream.mockResolvedValue({ ok: true, blob: async () => blob });
    expect(await fetchCanvasMediaBlob('https://api.example.com/api/brain/uploads/7/u/a.png')).toBe(blob);
    expect(stream).toHaveBeenCalledWith('/api/brain/uploads/7/u/a.png');
  });

  it('reads any other URL with a credential-less CORS fetch', async () => {
    const blob = new Blob(['y']);
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => blob }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchCanvasMediaBlob('https://api.example.com/api/assets/7/u/a.png')).toBe(blob);
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/api/assets/7/u/a.png', { mode: 'cors', credentials: 'omit' });
    expect(stream).not.toHaveBeenCalled();
  });

  it('accepts a relative upload URL and re-encodes each key segment', async () => {
    stream.mockResolvedValue({ ok: true, blob: async () => new Blob(['z']) });
    await fetchCanvasMediaBlob('/api/brain/uploads/7/my file.png');
    expect(stream).toHaveBeenCalledWith('/api/brain/uploads/7/my%20file.png');
  });

  it.each([
    'https://api.example.com/api/brain/uploads/../x',
    'https://api.example.com/api/brain/uploads/%2e%2e/x',
    'https://api.example.com/api/brain/uploads/%2E%2E/x',
    'https://api.example.com/api/brain/uploads/a\\b',
    '/api/brain/uploads/../x',
  ])('rejects the traversal %s without sending the token', async (url) => {
    await expect(fetchCanvasMediaBlob(url)).rejects.toThrow('rejected');
    expect(stream).not.toHaveBeenCalled();
  });

  it('rejects an uploads path on a foreign origin', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchCanvasMediaBlob('https://evil.example.net/api/brain/uploads/k')).rejects.toThrow('rejected');
    expect(stream).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on a refused read', async () => {
    stream.mockResolvedValue({ ok: false, status: 401 });
    await expect(fetchCanvasMediaBlob('https://api.example.com/api/brain/uploads/k')).rejects.toThrow('401');
  });
});

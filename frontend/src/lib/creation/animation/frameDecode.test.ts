import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearFrameDecodeCache, decodeFrame } from './frameDecode';

const fetchBlob = vi.fn();
vi.mock('@/lib/canvasMediaStore', () => ({ fetchCanvasMediaBlob: (url: string) => fetchBlob(url) }));

const bitmap = { width: 4, height: 4, close: vi.fn() };

beforeEach(() => {
  clearFrameDecodeCache();
  vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('decodeFrame', () => {
  beforeEach(() => fetchBlob.mockReset());

  it('fetches an uploaded frame to a blob through the media fetch and decodes the blob (same-origin, untainted)', async () => {
    const blob = new Blob([new Uint8Array(4)], { type: 'image/png' });
    fetchBlob.mockResolvedValue(blob);
    const decoded = await decodeFrame('https://api.example.com/api/assets/7/u/1-a.png');
    expect(decoded).toBe(bitmap);
    expect(fetchBlob).toHaveBeenCalledWith('https://api.example.com/api/assets/7/u/1-a.png');
    expect(createImageBitmap).toHaveBeenCalledWith(blob);
  });

  it('decodes a frame once however many times it is asked for', async () => {
    fetchBlob.mockResolvedValue(new Blob([]));
    await Promise.all([decodeFrame('https://x.example/a.png'), decodeFrame('https://x.example/a.png')]);
    expect(fetchBlob).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed fetch', async () => {
    fetchBlob.mockRejectedValueOnce(new Error('404')).mockResolvedValue(new Blob([]));
    await expect(decodeFrame('https://x.example/b.png')).rejects.toThrow();
    await expect(decodeFrame('https://x.example/b.png')).resolves.toBe(bitmap);
  });
});

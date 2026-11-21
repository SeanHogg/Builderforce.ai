import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserDownload } from './browserDownload';

const clicks: Array<{ href: string; target: string; download: string }> = [];

function spyClicks() {
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ href: this.getAttribute('href') ?? '', target: this.target, download: this.download });
  });
}

afterEach(() => {
  clicks.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('browserDownload', () => {
  it('regression: refuses a javascript: link outright — never clicked, never fetched', async () => {
    spyClicks();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(browserDownload({ name: 'x.pdf', downloadUrl: 'javascript:alert(1)' })).rejects.toThrow();
    expect(clicks).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a refused read (401) saves the picture\'s data: copy instead of opening a tab that fails too', async () => {
    spyClicks();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 401 })));
    await browserDownload({ name: 'shot.png', downloadUrl: 'https://api.example/api/brain/uploads/k1', previewUrl: 'data:image/png;base64,AA' });
    expect(clicks).toEqual([{ href: 'data:image/png;base64,AA', target: '', download: 'shot.png' }]);
  });

  it('a refused read with no copy fails (the preview says Download failed)', async () => {
    spyClicks();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 401 })));
    await expect(browserDownload({ name: 'spec.pdf', downloadUrl: 'https://api.example/api/brain/uploads/k2' })).rejects.toThrow();
    expect(clicks).toEqual([]);
  });
});

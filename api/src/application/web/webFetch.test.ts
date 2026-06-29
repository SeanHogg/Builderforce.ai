import { describe, it, expect } from 'vitest';
import { normalizeFetchUrl, fetchWebDocument } from './webFetch';

describe('normalizeFetchUrl', () => {
  it('rewrites a GitHub blob URL to the raw file', () => {
    expect(normalizeFetchUrl('https://github.com/SeanHogg/Builderforce.ai/blob/main/ROADMAP.md'))
      .toBe('https://raw.githubusercontent.com/SeanHogg/Builderforce.ai/main/ROADMAP.md');
  });

  it('rewrites a GitLab blob URL to the raw file', () => {
    expect(normalizeFetchUrl('https://gitlab.com/group/repo/-/blob/main/docs/x.md'))
      .toBe('https://gitlab.com/group/repo/-/raw/main/docs/x.md');
  });

  it('leaves a non-blob URL untouched', () => {
    const u = 'https://example.com/docs/page.html';
    expect(normalizeFetchUrl(u)).toBe(u);
  });

  it('leaves a raw GitHub URL untouched', () => {
    const u = 'https://raw.githubusercontent.com/owner/repo/main/README.md';
    expect(normalizeFetchUrl(u)).toBe(u);
  });
});

describe('fetchWebDocument SSRF guard', () => {
  it('rejects loopback / private / metadata hosts before fetching', async () => {
    for (const url of [
      'http://localhost/x',
      'http://127.0.0.1/x',
      'http://169.254.169.254/latest/meta-data',
      'http://10.0.0.5/x',
      'https://192.168.1.1/x',
      'http://internal.service.local/x',
    ]) {
      await expect(fetchWebDocument(url), url).rejects.toThrow(/public host/);
    }
  });

  it('rejects an unsupported protocol', async () => {
    await expect(fetchWebDocument('ftp://example.com/x')).rejects.toThrow(/http/);
  });
});

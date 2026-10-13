import { describe, expect, it } from 'vitest';
import { releaseKeyFromAssets } from './release';

describe('releaseKeyFromAssets', () => {
  it('returns null when no URL carries a build hash', async () => {
    expect(await releaseKeyFromAssets([])).toBeNull();
    expect(await releaseKeyFromAssets(['https://cdn.example/favicon.ico', 'https://cdn.example/style.css'])).toBeNull();
    // A hash in the query string is not a build hash.
    expect(await releaseKeyFromAssets(['https://cdn.example/app.js?v=.abcdef12.'])).toBeNull();
  });

  it('returns 12 lowercase hex chars', async () => {
    const key = await releaseKeyFromAssets(['https://cdn.example/app.abcdef12.js']);
    expect(key).toMatch(/^[a-f0-9]{12}$/);
  });

  it('accepts dash-separated and 6-char hashes', async () => {
    expect(await releaseKeyFromAssets(['/assets/chunk-8d7e6f.css'])).toMatch(/^[a-f0-9]{12}$/);
  });

  it('is stable for the same assets in any order and ignores unhashed ones', async () => {
    const a = ['https://cdn.example/a.11111111.js', 'https://cdn.example/b.22222222.js'];
    const b = [...a].reverse().concat('https://cdn.example/favicon.ico');
    expect(await releaseKeyFromAssets(a)).toBe(await releaseKeyFromAssets(b));
  });

  it('changes when the hashed set changes', async () => {
    const a = await releaseKeyFromAssets(['https://cdn.example/app.aaaaaaaa.js']);
    const b = await releaseKeyFromAssets(['https://cdn.example/app.bbbbbbbb.js']);
    expect(a).not.toBe(b);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { releaseKeyFromAssets } from '@builderforce/interaction-contract';
import { resolveRelease } from './releaseKey';

function asset(tag: 'script' | 'link', url: string): void {
  const el = document.createElement(tag);
  if (tag === 'script') (el as HTMLScriptElement).src = url;
  else {
    (el as HTMLLinkElement).rel = 'stylesheet';
    (el as HTMLLinkElement).href = url;
  }
  document.head.appendChild(el);
}

afterEach(() => {
  document.head.innerHTML = '';
  delete window.BF_RELEASE;
});

describe('resolveRelease', () => {
  it('prefers data-release over window.BF_RELEASE and the fingerprint', async () => {
    window.BF_RELEASE = 'from-window';
    asset('script', 'https://cdn.example/app.abcdef12.js');
    expect(await resolveRelease('from-tag')).toBe('from-tag');
  });

  it('uses window.BF_RELEASE when the tag names none', async () => {
    window.BF_RELEASE = 'from-window';
    asset('script', 'https://cdn.example/app.abcdef12.js');
    expect(await resolveRelease(undefined)).toBe('from-window');
  });

  it('falls back to the hashed-asset fingerprint', async () => {
    asset('script', 'https://cdn.example/app.abcdef12.js');
    asset('link', 'https://cdn.example/style.0123456789.css');
    asset('script', 'https://cdn.example/analytics.js');
    const expected = await releaseKeyFromAssets([
      'https://cdn.example/app.abcdef12.js',
      'https://cdn.example/style.0123456789.css',
    ]);
    expect(expected).toMatch(/^[0-9a-f]{12}$/);
    expect(await resolveRelease(undefined)).toBe(expected);
  });

  it('is empty when nothing identifies the release', async () => {
    asset('script', 'https://cdn.example/analytics.js');
    expect(await resolveRelease(undefined)).toBe('');
  });
});

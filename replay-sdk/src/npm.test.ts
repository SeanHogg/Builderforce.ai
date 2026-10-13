import { afterEach, describe, expect, it } from 'vitest';
import { startReplay } from './npm';

afterEach(() => {
  document.head.innerHTML = '';
});

describe('startReplay', () => {
  it('injects the CDN loader tag with the site data attributes', () => {
    startReplay({ site: 'bfr_abc', release: 'v7', api: 'https://api.test', variant: 'B' });
    const tags = document.querySelectorAll<HTMLScriptElement>('script[data-bf-replay-loader]');
    expect(tags).toHaveLength(1);
    const tag = tags[0]!;
    expect(tag.src).toBe('https://cdn.builderforce.ai/replay/v1/loader.js');
    expect(tag.async).toBe(true);
    expect({ ...tag.dataset }).toMatchObject({ site: 'bfr_abc', release: 'v7', api: 'https://api.test', variant: 'B' });
  });

  it('injects once and ignores a missing site', () => {
    startReplay({ site: '' });
    expect(document.querySelectorAll('script')).toHaveLength(0);
    startReplay({ site: 'bfr_abc' });
    startReplay({ site: 'bfr_abc' });
    expect(document.querySelectorAll('script[data-bf-replay-loader]')).toHaveLength(1);
  });
});

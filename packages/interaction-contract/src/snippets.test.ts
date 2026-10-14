import { describe, expect, it } from 'vitest';
import { replayLoaderUrl, replaySnippets } from './snippets';

describe('replaySnippets', () => {
  it('builds the exact script tag', () => {
    expect(replaySnippets({ siteKey: 'bfr_abc123' }).scriptTag).toBe(
      '<script async src="https://cdn.builderforce.ai/replay/v1/loader.js" data-site="bfr_abc123"></script>',
    );
  });

  it('builds the npm snippet', () => {
    expect(replaySnippets({ siteKey: 'bfr_abc123' }).npm).toBe(
      "import { startReplay } from '@seanhogg/builderforce-replay';\nstartReplay({ site: 'bfr_abc123' });",
    );
  });

  it('builds a GTM custom HTML tag that injects the same loader', () => {
    const { gtm } = replaySnippets({ siteKey: 'bfr_abc123' });
    expect(gtm.startsWith('<script>')).toBe(true);
    expect(gtm.trimEnd().endsWith('</script>')).toBe(true);
    expect(gtm).toContain("s.src = 'https://cdn.builderforce.ai/replay/v1/loader.js';");
    expect(gtm).toContain("s.setAttribute('data-site', 'bfr_abc123');");
  });

  it('honours a CDN origin override and escapes the key', () => {
    const { scriptTag } = replaySnippets({ siteKey: 'a"b', cdnOrigin: 'https://cdn.test/' });
    expect(scriptTag).toBe('<script async src="https://cdn.test/replay/v1/loader.js" data-site="a&quot;b"></script>');
    expect(replayLoaderUrl()).toBe('https://cdn.builderforce.ai/replay/v1/loader.js');
  });
});

import { describe, expect, it } from 'vitest';
import { extractHtmlDocument } from './htmlExtraction';
import { evaluateRobots } from './robots';
import { makeSnippet, rankLexical, tokenize } from './textIndex';
import { isUrlAllowed, normalizeWebUrl } from './urlPolicy';

describe('web crawl URL policy', () => {
  it('normalizes identity and removes tracking without losing meaningful query values', () => {
    expect(normalizeWebUrl('HTTPS://Example.COM:443/a//b/?utm_source=x&b=2&a=1#part')).toBe('https://example.com/a/b?a=1&b=2');
  });
  it('applies subdomain-aware allow and block rules', () => {
    expect(isUrlAllowed('https://docs.example.com/a', { allowedDomains: ['example.com'] })).toBe(true);
    expect(isUrlAllowed('https://evil-example.com/a', { allowedDomains: ['example.com'] })).toBe(false);
    expect(isUrlAllowed('https://private.example.com/a', { allowedDomains: ['example.com'], blockedDomains: ['private.example.com'] })).toBe(false);
  });
});

describe('robots policy', () => {
  const body = `User-agent: *\nDisallow: /private\nAllow: /private/public\nCrawl-delay: 2\n\nUser-agent: BuilderforceSearchBot\nDisallow: /bot-only`;
  it('uses the specific agent group and longest rule', () => {
    expect(evaluateRobots(body, 'https://example.com/bot-only/x').allowed).toBe(false);
    expect(evaluateRobots(body, 'https://example.com/private/x').allowed).toBe(true);
  });
  it('uses wildcard rules when there is no specific group', () => {
    const decision = evaluateRobots(body, 'https://example.com/private/public/x', 'AnotherCrawler');
    expect(decision).toEqual({ allowed: true, crawlDelayMs: 2000 });
  });
});

describe('HTML extraction', () => {
  it('extracts citation metadata, main content, headings and normalized links without active content', () => {
    const html = `<html lang="en-US"><head><title>Battery &amp; News</title><link rel="canonical" href="/story/">
      <meta name="author" content="Ada"><meta property="article:published_time" content="2026-08-01T10:00:00Z"></head>
      <body><nav>menu</nav><article><h1>Solid State</h1><p>Useful research body.</p><script>steal()</script><a href="/more?utm_source=x">More</a></article></body></html>`;
    const result = extractHtmlDocument(html, 'https://example.com/story?ref=home');
    expect(result.canonicalUrl).toBe('https://example.com/story');
    expect(result.title).toBe('Battery & News');
    expect(result.text).toContain('Useful research body.');
    expect(result.text).not.toContain('steal');
    expect(result.headings).toEqual(['Solid State']);
    expect(result.outboundLinks).toEqual(['https://example.com/more']);
    expect(result.author).toBe('Ada');
  });
});

describe('inverted-index ranking', () => {
  it('tokenizes consistently and weights title matches above body-only matches', () => {
    expect(tokenize('Batteries, battery testing and tested cells')).toEqual(['battery', 'battery', 'test', 'test', 'cell']);
    const now = new Date('2026-08-11T00:00:00Z');
    const base = { text: 'solid state battery research', headings: [], wordCount: 100, publishedAt: now, crawledAt: now, domain: 'example.com', canonicalUrl: 'https://example.com', language: 'en' };
    const ranked = rankLexical('solid state battery', [
      { ...base, id: 'body', title: 'An article', terms: [{ term: 'battery', titleFrequency: 0, headingFrequency: 0, bodyFrequency: 1, documentFrequency: 2 }] },
      { ...base, id: 'title', title: 'Solid state battery', terms: [{ term: 'battery', titleFrequency: 1, headingFrequency: 0, bodyFrequency: 0, documentFrequency: 2 }] },
    ], 10, 100, now);
    expect(ranked[0]?.id).toBe('title');
    expect(ranked[0]?.scoring.bm25).toBeGreaterThan(ranked[1]?.scoring.bm25 ?? 0);
    expect(makeSnippet('prefix '.repeat(100) + 'solid battery result', 'solid battery')).toContain('solid battery');
  });
});

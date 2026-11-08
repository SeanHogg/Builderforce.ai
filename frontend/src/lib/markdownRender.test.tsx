import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderMarkdown, safeMarkdownUrl } from './markdownRender';
import { DocumentMarkdown } from '@/components/DocumentMarkdown';

describe('renderMarkdown (hook-free renderer)', () => {
  it('renders GFM and maths through the shared pipeline', () => {
    const html = renderToStaticMarkup(renderMarkdown('| a |\n| - |\n| $x$ |\n\n**bold**'));
    expect(html).toContain('<table>');
    expect(html).toContain('class="katex"');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('drops unsafe link protocols, keeps safe and relative ones', () => {
    expect(safeMarkdownUrl('javascript:alert(1)')).toBe('');
    expect(safeMarkdownUrl('https://example.com')).toBe('https://example.com');
    expect(safeMarkdownUrl('/about#team')).toBe('/about#team');
    const html = renderToStaticMarkup(renderMarkdown('[x](javascript:alert(1)) [y](https://ok.test)'));
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="https://ok.test"');
  });

  it('renders raw HTML as text, never as markup', () => {
    const html = renderToStaticMarkup(renderMarkdown('<script>alert(1)</script>'));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('applies element overrides', () => {
    const html = renderToStaticMarkup(renderMarkdown('[x](https://ok.test)', {
      components: { a: ({ node: _node, ...props }) => <a {...props} rel="nofollow" /> },
    }));
    expect(html).toContain('rel="nofollow"');
  });

  it('lets DocumentMarkdown render on the server (no hooks)', () => {
    const html = renderToStaticMarkup(<DocumentMarkdown content={'# Title\n\nBody'} />);
    expect(html).toContain('class="markdown-body"');
    expect(html).toContain('<h1>Title</h1>');
  });
});

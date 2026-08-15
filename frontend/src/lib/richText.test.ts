// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, markdownToHtml } from './richText';

/** The property the document editor depends on: opening markdown as HTML and
 * reading it back must return the same markdown. If this drifts, editing a
 * document silently rewrites the parts of it nobody touched. */
const roundTrip = (markdown: string) => htmlToMarkdown(markdownToHtml(markdown));

describe('markdownToHtml', () => {
  it('renders headings, emphasis, and links', () => {
    expect(markdownToHtml('# Title')).toBe('<h1>Title</h1>');
    expect(markdownToHtml('**bold** and *italic* and ~~gone~~')).toBe('<p><strong>bold</strong> and <em>italic</em> and <del>gone</del></p>');
    expect(markdownToHtml('[Builderforce](https://builderforce.ai)')).toBe('<p><a href="https://builderforce.ai">Builderforce</a></p>');
  });

  it('does not read emphasis inside a code span', () => {
    expect(markdownToHtml('use `a ** b` here')).toBe('<p>use <code>a ** b</code> here</p>');
  });

  it('leaves intra-word underscores alone', () => {
    expect(markdownToHtml('call read_local_session now')).toBe('<p>call read_local_session now</p>');
  });

  it('escapes markup in authored text', () => {
    expect(markdownToHtml('a <script>alert(1)</script> b')).toBe('<p>a &lt;script&gt;alert(1)&lt;/script&gt; b</p>');
  });

  it('nests lists by indentation', () => {
    expect(markdownToHtml('- one\n  - deep\n- two')).toBe('<ul><li>one<ul><li>deep</li></ul></li><li>two</li></ul>');
  });

  it('renders GFM tables', () => {
    expect(markdownToHtml('| A | B |\n| --- | --- |\n| 1 | 2 |'))
      .toBe('<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
  });

  it('keeps a fenced block verbatim', () => {
    expect(markdownToHtml('```ts\nconst a = 1 < 2;\n```')).toBe('<pre><code class="language-ts">const a = 1 &lt; 2;</code></pre>');
  });
});

describe('htmlToMarkdown', () => {
  it('reads back what a browser editing command produces', () => {
    expect(htmlToMarkdown('<div>plain <b>bold</b> text</div>')).toBe('plain **bold** text');
    expect(htmlToMarkdown('<p><span style="font-weight:bold">via style</span></p>')).toBe('**via style**');
    expect(htmlToMarkdown('<p><font face="Arial">unwrapped</font></p>')).toBe('unwrapped');
  });

  it('drops an emphasis wrapper left empty by an undone format', () => {
    expect(htmlToMarkdown('<p>text<b></b></p>')).toBe('text');
  });

  it('escapes characters that would otherwise become structure', () => {
    expect(htmlToMarkdown('<p>2 * 3 * 4</p>')).toBe('2 \\* 3 \\* 4');
  });
});

describe('round trip', () => {
  const documents: ReadonlyArray<[string, string]> = [
    ['headings and prose', '# Market analysis\n\nThe **first** quarter grew *fast*.'],
    ['bullet list', '- one\n- two\n- three'],
    ['numbered list', '1. first\n2. second'],
    ['nested list', '- one\n  - deep\n  - deeper\n- two'],
    ['blockquote', '> A quoted line.'],
    ['table', '| Region | Revenue |\n| --- | --- |\n| EMEA | 12 |\n| APAC | 9 |'],
    ['fenced code', '```ts\nconst a = 1;\n```'],
    ['rule', 'Before\n\n---\n\nAfter'],
    ['link and image', '[Site](https://example.com) and ![Logo](https://example.com/a.png)'],
    ['inline code', 'Run `pnpm build` first.'],
    ['strikethrough', 'This is ~~wrong~~ right.'],
    ['mixed document', '# Report\n\nIntro paragraph.\n\n## Findings\n\n- Point one\n- Point two\n\n> Caveat.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |'],
    // A document imported from Word or PDF carries the page breaks its author
    // declared. Editing must not flatten a twenty-page file into one page.
    ['declared page breaks', 'Page one.\n\n<!--page-break-->\n\nPage two.'],
  ];
  for (const [name, markdown] of documents) {
    it(`preserves ${name}`, () => expect(roundTrip(markdown)).toBe(markdown));
  }

  it('is stable on a second pass', () => {
    const once = roundTrip('# Title\n\nSome **bold** text.\n\n- a\n- b');
    expect(roundTrip(once)).toBe(once);
  });
});

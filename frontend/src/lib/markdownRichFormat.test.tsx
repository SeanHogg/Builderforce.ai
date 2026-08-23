// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import ReactMarkdown from 'react-markdown';
import { DOCUMENT_REMARK_PLUGINS, MARKDOWN_REHYPE_PLUGINS } from './markdownPipeline';

/** The document CARD's renderer, which is the reader that goes through
 * `react-markdown` rather than parsing the stored markdown itself. If this
 * drifts from `richText`, the same document reads two different ways depending
 * on whether it is being looked at or edited. */
function card(markdown: string): HTMLElement {
  const { container } = render(
    <ReactMarkdown remarkPlugins={DOCUMENT_REMARK_PLUGINS} rehypePlugins={MARKDOWN_REHYPE_PLUGINS}>{markdown}</ReactMarkdown>,
  );
  return container;
}

describe('remarkRichFormat', () => {
  it('renders an underlined run', () => {
    const span = card('A [stressed]{u} word.').querySelector('span');
    expect(span?.textContent).toBe('stressed');
    expect(span?.style.textDecoration).toBe('underline');
  });

  it('renders colour, font and size', () => {
    const span = card('[warn]{color=#c0392b font=Georgia size=18pt}').querySelector('span');
    expect(span?.style.color).toBe('rgb(192, 57, 43)');
    expect(span?.style.fontFamily).toContain('Georgia');
    expect(span?.style.fontSize).toBe('18pt');
  });

  it('marks a run whose label was parsed as emphasis', () => {
    const span = card('A [**loud**]{u} word.').querySelector('span');
    expect(span?.querySelector('strong')?.textContent).toBe('loud');
    expect(span?.style.textDecoration).toBe('underline');
  });

  it('keeps the text around a span, once', () => {
    expect(card('A [stressed]{u} word.').textContent).toBe('A stressed word.');
  });

  it('aligns a paragraph and a heading', () => {
    expect(card('Centred. {align=center}').querySelector('p')?.style.textAlign).toBe('center');
    expect(card('# Title {align=center}').querySelector('h1')?.style.textAlign).toBe('center');
  });

  it('leaves braces that are not this vocabulary exactly as typed', () => {
    const container = card('the payload is {ok: true} and [a note]{unknown=1}');
    expect(container.querySelector('span')).toBeNull();
    expect(container.textContent).toBe('the payload is {ok: true} and [a note]{unknown=1}');
  });

  it('does not touch a code span', () => {
    const container = card('run `[x]{u}` first');
    expect(container.querySelector('span')).toBeNull();
    expect(container.querySelector('code')?.textContent).toBe('[x]{u}');
  });

  it('renders two spans in one paragraph', () => {
    const spans = card('[one]{u} and [two]{color=#0000ff}').querySelectorAll('span');
    expect([...spans].map((span) => span.textContent)).toEqual(['one', 'two']);
  });

  it('leaves a plain document untouched', () => {
    const container = card('# Report\n\nA **bold** claim.');
    expect(container.querySelector('h1')?.textContent).toBe('Report');
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('span')).toBeNull();
  });
});

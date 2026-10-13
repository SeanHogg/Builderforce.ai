import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SerpPreview } from './SerpPreview';

/** An SEO fix as a search result before and after, plus the JSON-LD diff — text only, from the fix (PRD 33 §5.2). */

const SERP = {
  before: { title: 'Pricing', url: 'https://shop.example.com/pricing', description: '' },
  after: { title: 'Pricing — plans from $9 a month | Shop', url: 'https://shop.example.com/pricing', description: 'Compare plans and start free.' },
};

describe('SerpPreview', () => {
  it('shows the result before and after: title, url, description', () => {
    render(<SerpPreview visual={{ serp: SERP }} />);
    const [before, after] = screen.getAllByTestId('serp-snippet');
    expect(before).toHaveTextContent('replay.page.serp.before');
    expect(before!.querySelector('[data-part="title"]')).toHaveTextContent('Pricing');
    expect(after).toHaveTextContent('replay.page.serp.after');
    expect(after!.querySelector('[data-part="title"]')).toHaveTextContent('Pricing — plans from $9 a month | Shop');
    expect(after!.querySelector('[data-part="url"]')).toHaveTextContent('https://shop.example.com/pricing');
    expect(after!.querySelector('[data-part="description"]')).toHaveTextContent('Compare plans and start free.');
    expect(screen.queryByTestId('jsonld-diff')).toBeNull();
  });

  it('shows the JSON-LD diff in a pre', () => {
    const diff = '+ {\n+   "@type": "Product"\n+ }';
    render(<SerpPreview visual={{ jsonLdDiff: diff }} />);
    const pre = screen.getByTestId('jsonld-diff');
    expect(pre.tagName).toBe('PRE');
    expect(pre.textContent).toBe(diff);
    expect(screen.queryByTestId('serp-snippet')).toBeNull();
  });

  it('renders nothing for a fix with neither', () => {
    const { container } = render(<SerpPreview visual={{}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

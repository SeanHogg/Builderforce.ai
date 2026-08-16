import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CreationNodeData } from './types';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

const { WebsiteBody } = await import('./WebsiteCanvas');

const page = (sections: Array<Record<string, unknown>>) => [{ id: 'home', name: 'Home', path: '/', sections }];

function renderSite(sections: Array<Record<string, unknown>>) {
  const data = { kind: 'website', title: 'GreenEdge', pages: page(sections) } as unknown as CreationNodeData;
  return render(<WebsiteBody data={data} />);
}

describe('a content section carrying real markup', () => {
  it('renders the form in a sandboxed frame instead of printing it as escaped text', () => {
    renderSite([
      { id: 'hero', kind: 'hero', heading: 'GreenEdge Yard Care', body: 'A proof of concept', cta: 'Learn more' },
      { id: 'quote', kind: 'content', heading: 'Request a quote', body: '<form><input name="email"><script>track()</script></form>' },
    ]);
    // Never printed as literal source on the page — that is the bug being fixed.
    expect(screen.queryByText(/<form>/)).toBeNull();
    const frame = document.querySelector('iframe')!;
    expect(frame).not.toBeNull();
    expect(frame.getAttribute('srcdoc')).toContain('<form>');
  });

  it('sandboxes the frame with scripts and forms allowed but never same-origin', () => {
    renderSite([
      { id: 'hero', kind: 'hero', heading: 'GreenEdge Yard Care', body: 'A proof of concept', cta: 'Learn more' },
      { id: 'quote', kind: 'content', heading: 'Request a quote', body: '<form><input name="email"></form>' },
    ]);
    const frame = document.querySelector('iframe')!;
    const sandbox = frame.getAttribute('sandbox') ?? '';
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).toContain('allow-forms');
    expect(sandbox).not.toContain('allow-same-origin');
  });

  it('still renders plain prose content through markdown, not a frame', () => {
    renderSite([
      { id: 'hero', kind: 'hero', heading: 'GreenEdge Yard Care', body: 'A proof of concept', cta: 'Learn more' },
      { id: 'about', kind: 'content', heading: 'Our story', body: 'We started mowing lawns in 2019.' },
    ]);
    expect(screen.getByText('We started mowing lawns in 2019.')).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull();
  });
});

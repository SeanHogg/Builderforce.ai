// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DocumentMarkdown } from '@/components/DocumentMarkdown';
import { ChatMessageContent } from '@/components/ChatMessageContent';

/**
 * Mathematics has to render the same on EVERY surface, which is the whole point
 * of there being one pipeline. Both readers are asserted here so that adding a
 * plugin to one and not the other fails a test rather than shipping a document
 * that reads two different ways depending on which panel opened it.
 *
 * `String.raw` throughout: a LaTeX command is backslashes, and `'\frac'` in a
 * TypeScript string is a form feed followed by `rac`.
 */
describe('mathematics renders wherever markdown does', () => {
  it('renders an inline formula as maths, not as dollar-signed source', () => {
    const { container } = render(<DocumentMarkdown content={String.raw`The area of a circle is $\pi r^2$.`} />);
    expect(container.querySelector('.katex')).not.toBeNull();
    expect(container.querySelector('annotation')?.textContent).toBe(String.raw`\pi r^2`);
    expect(container.textContent).not.toContain('$');
  });

  it('renders a fenced block as display maths', () => {
    const content = ['Einstein wrote:', '', '$$', 'E = mc^2', '$$', ''].join('\n');
    const { container } = render(<DocumentMarkdown content={content} />);
    expect(container.querySelector('.katex-display')).not.toBeNull();
  });

  it('renders the commands a student actually types', () => {
    const { container } = render(<DocumentMarkdown content={String.raw`$\frac{-b \pm \sqrt{b^2-4ac}}{2a}$`} />);
    expect(container.querySelector('.katex')).not.toBeNull();
    expect(container.querySelector('.katex-error')).toBeNull();
  });

  it('renders maths in chat too', () => {
    const { container } = render(<ChatMessageContent content={String.raw`Solve $x^2 + 1 = 0$.`} />);
    expect(container.querySelector('.katex')).not.toBeNull();
  });

  it('keeps GFM tables working alongside it', () => {
    render(<DocumentMarkdown content={'| Symbol | Meaning |\n| --- | --- |\n| $c$ | speed of light |'} />);
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('shows a half-typed formula instead of throwing inside the render', () => {
    const { container } = render(<DocumentMarkdown content={String.raw`Half written: $\frac{1}{$`} />);
    expect(container.textContent).toContain('Half written:');
  });
});

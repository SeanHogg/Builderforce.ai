import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MathAwareText } from './MathAwareText';

/** Course and knowledge prose: plain unless it carries TeX, and then drawn as maths. */
describe('MathAwareText', () => {
  it('renders ordinary prose as the paragraph it always was', () => {
    const { container } = render(<MathAwareText className="body" text="Read chapter three." />);
    const paragraph = container.querySelector('p.body');
    expect(paragraph?.textContent).toBe('Read chapter three.');
    expect(container.querySelector('[data-math]')).toBeNull();
  });

  it('keeps a lead (a field label) inside the same block', () => {
    const { container } = render(<MathAwareText text="Plain" lead={<small>Brief</small>} />);
    expect(container.querySelector('p small')?.textContent).toBe('Brief');
  });

  it('draws a bare expression as MathML a screen reader can speak', () => {
    // Queried by attribute: jsdom's getComputedStyle cannot walk a MathML subtree, so
    // `getByRole` crashes on it — a harness limit, not what a browser does.
    const { container } = render(<MathAwareText text="\frac{dQ}{dt} = -kA\frac{dT}{dx}" />);
    const math = container.querySelector('[role="math"]')!;
    expect(math.getAttribute('aria-label')).toContain('the fraction');
    expect(math.querySelector('mfrac')).not.toBeNull();
    expect(screen.queryByText('\\frac{dQ}{dt} = -kA\\frac{dT}{dx}')).toBeNull();
  });

  it('sends delimited maths in prose through the one markdown pipeline', () => {
    const { container } = render(<MathAwareText text="Show that \(\frac{a}{b}\) is rational." />);
    expect(container.querySelector('[data-math="markdown"]')).not.toBeNull();
    expect(container.querySelector('.katex')).not.toBeNull();
    expect(container.textContent).toContain('is rational');
  });
});

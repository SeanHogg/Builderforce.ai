import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DependencyGraphChart } from './DependencyGraph';

/**
 * The chart is presentation, so these assert the two things a broken graph render
 * fails silently on: that every node actually reaches the DOM (a node the layout
 * could not place is dropped, not drawn at 0,0 on top of another), and that a cycle
 * renders at all rather than hanging the component.
 */
describe('DependencyGraphChart', () => {
  const nodes = [
    { id: 'sys', label: 'Payments', kind: 'system' as const },
    { id: 'inc', label: 'Checkout 500s', kind: 'incident' as const, status: 'sev1', focus: true },
  ];

  it('renders one accessible image with a caller-supplied label', () => {
    const { getByRole } = render(
      <DependencyGraphChart nodes={nodes} edges={[{ from: 'sys', to: 'inc', label: 'affects' }]} ariaLabel="Topology" />,
    );
    expect(getByRole('img').getAttribute('aria-label')).toBe('Topology');
  });

  it('draws every node label and the edge label', () => {
    const { container } = render(
      <DependencyGraphChart nodes={nodes} edges={[{ from: 'sys', to: 'inc', label: 'affects' }]} ariaLabel="Topology" />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Payments');
    expect(text).toContain('Checkout 500s');
    expect(text).toContain('affects');
    expect(text).toContain('sev1');
  });

  it('renders a cyclic graph, marking the closing edge distinctly', () => {
    const { container } = render(
      <DependencyGraphChart
        nodes={nodes}
        edges={[{ from: 'sys', to: 'inc' }, { from: 'inc', to: 'sys' }]}
        ariaLabel="Topology"
        backEdgeLabel="cycle"
      />,
    );
    const dashed = container.querySelectorAll('path[stroke-dasharray]');
    expect(dashed.length).toBe(1);
    expect(container.textContent).toContain('cycle');
  });

  it('never paints a bare hex — every colour is a theme token', () => {
    const { container } = render(
      <DependencyGraphChart nodes={nodes} edges={[{ from: 'sys', to: 'inc' }]} ariaLabel="Topology" />,
    );
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('survives an edge naming a node that is not in the graph', () => {
    const { getByRole } = render(
      <DependencyGraphChart nodes={nodes} edges={[{ from: 'sys', to: 'ghost' }]} ariaLabel="Topology" />,
    );
    expect(getByRole('img')).toBeTruthy();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { WorkflowDagView } from './WorkflowDagView';
import type { WorkflowGraphNode, WorkflowGraphEdge } from '@/lib/builderforceApi';

const nodes: WorkflowGraphNode[] = [
  { id: 'a', label: 'Plan the change', role: 'planner', status: 'completed' },
  { id: 'b', label: 'Write the code', role: 'developer', status: 'running' },
];
const edges: WorkflowGraphEdge[] = [{ from: 'a', to: 'b' }];

describe('WorkflowDagView', () => {
  it('shows the empty copy when there are no nodes', () => {
    const { getByText } = render(<WorkflowDagView nodes={[]} edges={[]} />);
    expect(getByText('workflowDag.empty')).toBeTruthy();
  });

  it('draws every node label and role', () => {
    const { container } = render(<WorkflowDagView nodes={nodes} edges={edges} />);
    const text = container.textContent ?? '';
    expect(text).toContain('Plan the change');
    expect(text).toContain('Write the code');
    expect(text).toContain('planner');
    expect(text).toContain('developer');
  });

  it('marks the running node with a thicker stroke', () => {
    const { container } = render(<WorkflowDagView nodes={nodes} edges={edges} />);
    const runningCard = [...container.querySelectorAll('rect')].find(
      (r) => r.getAttribute('stroke-width') === '1.5',
    );
    expect(runningCard).toBeTruthy();
  });

  it('renders a cyclic graph without hanging', () => {
    const { container } = render(
      <WorkflowDagView
        nodes={nodes}
        edges={[{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]}
      />,
    );
    expect(container.querySelectorAll('path').length).toBeGreaterThan(0);
  });

  it('never paints a bare hex', () => {
    const { container } = render(<WorkflowDagView nodes={nodes} edges={edges} />);
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('forwards a node click', () => {
    const onNodeClick = vi.fn();
    const { container } = render(
      <WorkflowDagView nodes={nodes} edges={edges} onNodeClick={onNodeClick} />,
    );
    const g = container.querySelector('g');
    expect(g).toBeTruthy();
    fireEvent.click(g!);
    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(onNodeClick.mock.calls[0][0].id).toBe('a');
  });
});

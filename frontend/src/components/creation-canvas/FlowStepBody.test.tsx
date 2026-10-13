import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FlowStepBody } from './FlowStepBody';
import type { CreationNodeData } from './types';

const node = (data: Partial<CreationNodeData>): CreationNodeData =>
  ({ kind: 'flowStep', title: 'Research', stepKind: 'agent', ...data } as CreationNodeData);

describe('FlowStepBody live run status', () => {
  it('paints a running graph node as live status on the canvas step', () => {
    render(<FlowStepBody data={node({ workflowRunStatus: 'running' })} />);
    const row = screen.getByTestId('flow-step-run-status');
    expect(row).toHaveAttribute('data-status', 'running');
  });

  it('paints completed and failed the same way', () => {
    const { rerender } = render(<FlowStepBody data={node({ workflowRunStatus: 'completed' })} />);
    expect(screen.getByTestId('flow-step-run-status')).toHaveAttribute('data-status', 'completed');
    rerender(<FlowStepBody data={node({ workflowRunStatus: 'failed' })} />);
    expect(screen.getByTestId('flow-step-run-status')).toHaveAttribute('data-status', 'failed');
  });

  it('hides the live-status row when the step has never run', () => {
    render(<FlowStepBody data={node({})} />);
    expect(screen.queryByTestId('flow-step-run-status')).not.toBeInTheDocument();
  });
});

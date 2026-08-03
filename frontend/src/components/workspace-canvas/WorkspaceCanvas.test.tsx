import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceCanvas } from './WorkspaceCanvas';

describe('WorkspaceCanvas', () => {
  it('renders reusable application components as canvas panels', () => {
    render(<WorkspaceCanvas panels={[
      { id: 'project-1', title: 'BuilderForce', content: <button type="button">Open project</button> },
      { id: 'tasks-1', title: 'BuilderForce tasks', content: <div>Task board component</div> },
    ]} />);

    expect(screen.getByTestId('workspace-canvas')).toBeInTheDocument();
    expect(screen.getByLabelText('BuilderForce canvas panel')).toBeInTheDocument();
    expect(screen.getByText('Open project')).toBeInTheDocument();
    expect(screen.getByText('Task board component')).toBeInTheDocument();
  });

  it('can remove a reusable panel without affecting its siblings', () => {
    const onRemove = vi.fn();
    render(<WorkspaceCanvas
      panels={[
        { id: 'tasks-1', title: 'Alpha tasks', content: <div>Alpha</div>, removable: true },
        { id: 'tasks-2', title: 'Beta tasks', content: <div>Beta</div> },
      ]}
      onRemovePanel={onRemove}
    />);

    fireEvent.click(screen.getByLabelText('Remove Alpha tasks from canvas'));
    expect(onRemove).toHaveBeenCalledWith('tasks-1');
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });
});

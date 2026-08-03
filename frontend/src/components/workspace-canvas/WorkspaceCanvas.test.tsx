import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceCanvas } from './WorkspaceCanvas';

describe('WorkspaceCanvas', () => {
  it('keeps the mini map closed until it is opened from the canvas controls', () => {
    render(<WorkspaceCanvas panels={[
      { id: 'overview', title: 'Overview', content: <div>Overview panel</div> },
    ]} />);

    expect(screen.queryByRole('button', { name: 'Close mini map' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open mini map' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close mini map' }));
    expect(screen.getByRole('button', { name: 'Open mini map' })).toBeInTheDocument();
  });

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

  it('renders panels as full-width individual widgets on mobile', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true,
      media: '(max-width: 760px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    render(<WorkspaceCanvas panels={[
      { id: 'quality', title: 'Quality', content: <div>Quality score</div> },
      { id: 'recommendations', title: 'Recommendations', content: <div>Fix CI first</div> },
    ]} />);

    await waitFor(() => expect(screen.getByTestId('workspace-canvas')).toHaveAttribute('data-layout', 'widgets'));
    expect(screen.getByLabelText('Quality canvas panel')).toBeInTheDocument();
    expect(screen.getByLabelText('Recommendations canvas panel')).toBeInTheDocument();
    expect(screen.getByText('Quality score')).toBeVisible();
    expect(screen.getByText('Fix CI first')).toBeVisible();
    vi.unstubAllGlobals();
  });
});
